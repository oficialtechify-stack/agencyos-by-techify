import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approvalPath, fingerprintProject, schedulePath } from "../_lib/workflow.js";
import { readRecord as readJson, removeRecord as removeJson, writeRecord as writeJson } from "../_lib/record-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin"]);
    const token=String(req.headers.authorization||"");
    const id=String(req.body?.project?.id||req.body?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    const existing=await readJson("workspace/projects/"+encodeURIComponent(id)+".json",token);
    if(!existing) return res.status(404).json({ok:false,error:"Conteúdo não encontrado."});
    const now=new Date().toISOString();
    const approval={
      projectId:id,
      fingerprint:fingerprintProject(existing),
      approvedAt:now,
      approvedBy:user.email,
      approvedByName:user.name
    };
    const project={
      ...existing,
      status:"approved",
      approvedAt:now,
      approvedBy:user.email,
      scheduledAt:null,
      updatedAt:now
    };
    await Promise.all([
      writeJson(approvalPath(id),approval,token,{uid:user.uid,role:user.role}),
      writeJson("workspace/projects/"+encodeURIComponent(id)+".json",project,token,{uid:user.uid,role:user.role}),
      removeJson(schedulePath(id),token)
    ]);
    res.status(200).json({ok:true,approval,project});
  }catch(e){sendApiError(res,e)}
}
