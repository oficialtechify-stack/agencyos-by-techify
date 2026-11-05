import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { assertApproved, publicProject, schedulePath } from "../_lib/workflow.js";
import { readRecord as readJson, writeRecord as writeJson } from "../_lib/record-store.js";
import { enqueueScheduledPublish } from "../_lib/scheduled-publish.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["designer"]);
    const token=String(req.headers.authorization||"");
    const when=new Date(req.body?.scheduledAt||"");
    if(!Number.isFinite(when.getTime())||when.getTime()<=Date.now()) {
      return res.status(400).json({ok:false,error:"Escolha uma data futura."});
    }

    const id=String(req.body?.project?.id||req.body?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    const existing=await readJson("workspace/projects/"+encodeURIComponent(id)+".json",token);
    if(!existing) return res.status(404).json({ok:false,error:"Conteúdo não encontrado."});
    if(existing.createdByUid && existing.createdByUid!==user.uid)
      return res.status(403).json({ok:false,error:"Conteúdo não pertence à sua conta."});
    const {clean,fingerprint}=await assertApproved(existing,token);
    const record={
      projectId:clean.id,
      project:publicProject(clean),
      fingerprint,
      scheduledAt:when.toISOString(),
      scheduledBy:user.email,
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };

    // Persist first; if the queue call fails the schedule remains visible and can be repaired.
    await writeJson(schedulePath(clean.id),record,token,{uid:user.uid,role:user.role});

    let queue;
    try{
      queue=await enqueueScheduledPublish(record,0);
      await writeJson(schedulePath(clean.id),{...record,queue,updatedAt:new Date().toISOString()},token,{uid:user.uid,role:user.role});
    }catch(queueError){
      console.error("schedule_queue_error",queueError);
      const err=new Error("O agendamento foi salvo, mas o serviço automático não conseguiu entrar na fila. Tente agendar novamente.");
      err.status=503;
      throw err;
    }

    const path="workspace/projects/"+encodeURIComponent(clean.id)+".json";
    await writeJson(path,{
      ...existing,
      status:"scheduled",
      scheduledAt:record.scheduledAt,
      scheduleError:null,
      scheduleQueue:"active",
      updatedAt:new Date().toISOString()
    },token,{uid:user.uid,role:user.role});

    res.status(200).json({ok:true,schedule:{...record,queue}});
  }catch(e){sendApiError(res,e)}
}
