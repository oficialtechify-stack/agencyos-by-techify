import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approveProject } from "../_lib/workflow.js";
import { readJson, writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin"]);
    const project=req.body?.project;
    const record=await approveProject(project,user);
    const path="workspace/projects/"+encodeURIComponent(record.projectId)+".json";
    const existing=await readJson(path);
    if(existing) await writeJson(path,{...existing,status:"approved",approvedAt:record.approvedAt,approvedBy:record.approvedBy,scheduledAt:null,updatedAt:new Date().toISOString()});
    res.status(200).json({ok:true,approval:record});
  }catch(e){sendApiError(res,e)}
}
