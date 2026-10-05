import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { readJson, writeJson } from "../_lib/blob-store.js";
function status(record){if(!record)return {online:false,lastSeen:null,visible:false};const age=Date.now()-new Date(record.lastSeen||0).getTime();return {...record,online:age<55000&&record.visible!==false}}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    if(req.method==="POST"){
      const record={email:user.email,role:user.role,name:user.name,visible:req.body?.visible!==false,lastSeen:new Date().toISOString()};
      await writeJson("chat/presence/"+user.role+".json",record);
      return res.status(200).json({ok:true,presence:status(record)});
    }
    if(req.method!=="GET")return res.status(405).json({ok:false,error:"Método não permitido."});
    const values=await Promise.all([readJson("chat/presence/admin.json"),readJson("chat/presence/designer.json")]);
    const other=user.role==="admin"?status(values[1]):status(values[0]);
    return res.status(200).json({ok:true,self:user.role,other});
  }catch(e){sendApiError(res,e)}
}
