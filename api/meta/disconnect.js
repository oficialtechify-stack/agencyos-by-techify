import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { disconnectMeta } from "../_lib/meta.js";
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{await requireTeamUser(req,["admin"]);await disconnectMeta();res.status(200).json({ok:true})}catch(e){sendApiError(res,e)}
}
