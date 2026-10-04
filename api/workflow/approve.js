import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approveProject } from "../_lib/workflow.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin"]);
    const record=await approveProject(req.body?.project,user);
    res.status(200).json({ok:true,approval:record});
  }catch(e){sendApiError(res,e)}
}
