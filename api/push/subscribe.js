import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { savePushSubscription } from "../_lib/push.js";
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
  try{const user=await requireTeamUser(req,["admin","designer"]);await savePushSubscription(user,req.body?.subscription);res.status(200).json({ok:true})}catch(e){sendApiError(res,e)}
}
