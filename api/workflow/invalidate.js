import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { invalidateApproval } from "../_lib/workflow.js";
import { readJson, writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    const id=String(req.body?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    await invalidateApproval(id);
    const requested=String(req.body?.status||"");
    const allowed=user.role==="admin"?["changes","draft"]:["draft","review","changes"];
    if(requested&&allowed.includes(requested)){
      const path="workspace/projects/"+encodeURIComponent(id)+".json";
      const existing=await readJson(path);
      if(existing) await writeJson(path,{...existing,status:requested,scheduledAt:null,updatedAt:new Date().toISOString()});
    }
    res.status(200).json({ok:true});
  }catch(e){sendApiError(res,e)}
}
