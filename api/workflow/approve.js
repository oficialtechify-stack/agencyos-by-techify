import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approvalPath, fingerprintProject, schedulePath } from "../_lib/workflow.js";
import { removeJson, writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin"]);
    const source=req.body?.project||{};
    const id=String(source.id||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    const now=new Date().toISOString();
    const approval={
      projectId:id,
      fingerprint:fingerprintProject(source),
      approvedAt:now,
      approvedBy:user.email,
      approvedByName:user.name
    };
    const project={
      ...JSON.parse(JSON.stringify(source)),
      status:"approved",
      approvedAt:now,
      approvedBy:user.email,
      scheduledAt:null,
      updatedAt:now
    };
    await Promise.all([
      writeJson(approvalPath(id),approval),
      writeJson("workspace/projects/"+encodeURIComponent(id)+".json",project),
      removeJson(schedulePath(id))
    ]);
    res.status(200).json({ok:true,approval,project});
  }catch(e){sendApiError(res,e)}
}
