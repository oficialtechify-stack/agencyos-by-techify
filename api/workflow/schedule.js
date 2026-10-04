import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { assertApproved, publicProject, schedulePath } from "../_lib/workflow.js";
import { writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["designer"]);
    const when=new Date(req.body?.scheduledAt||"");
    if(!Number.isFinite(when.getTime())||when.getTime()<=Date.now()) return res.status(400).json({ok:false,error:"Escolha uma data futura."});
    const {clean,fingerprint}=await assertApproved(req.body?.project);
    const record={projectId:clean.id,project:publicProject(clean),fingerprint,scheduledAt:when.toISOString(),scheduledBy:user.email,createdAt:new Date().toISOString()};
    await writeJson(schedulePath(clean.id),record);
    res.status(200).json({ok:true,schedule:record});
  }catch(e){sendApiError(res,e)}
}
