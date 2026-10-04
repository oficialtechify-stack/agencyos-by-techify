import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approvalPath, publicationPath, schedulePath } from "../_lib/workflow.js";
import { readJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  try{
    await requireTeamUser(req,["admin","designer"]);
    const id=String(req.query?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    const [approval,schedule,publication]=await Promise.all([
      readJson(approvalPath(id)),readJson(schedulePath(id)),readJson(publicationPath(id))
    ]);
    res.status(200).json({ok:true,approval,schedule,publication});
  }catch(e){sendApiError(res,e)}
}
