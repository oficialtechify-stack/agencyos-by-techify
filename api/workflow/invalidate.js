import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { invalidateApproval } from "../_lib/workflow.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    await requireTeamUser(req,["admin","designer"]);
    const id=String(req.body?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    await invalidateApproval(id);
    res.status(200).json({ok:true});
  }catch(e){sendApiError(res,e)}
}
