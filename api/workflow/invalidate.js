import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { invalidateApproval } from "../_lib/workflow.js";
import { readJson, writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    const id=String(req.body?.projectId||"");
    if(!id) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    const existing=await readJson("workspace/projects/"+encodeURIComponent(id)+".json");
    if(!existing) return res.status(404).json({ok:false,error:"Conteúdo não encontrado."});
    if(user.role==="designer" && existing.createdByUid && existing.createdByUid!==user.uid)
      return res.status(403).json({ok:false,error:"Conteúdo não pertence à sua conta."});
    if(user.role==="designer" && ["approved","scheduled","published"].includes(existing.status))
      return res.status(403).json({ok:false,error:"Esse conteúdo já foi aprovado e não pode ser invalidado por você."});
    await invalidateApproval(id);
    const requested=String(req.body?.status||"");
    const allowed=user.role==="admin"?["changes","draft"]:["draft","review","changes"];
    if(requested&&allowed.includes(requested)){
      const path="workspace/projects/"+encodeURIComponent(id)+".json";
      await writeJson(path,{...existing,status:requested,scheduledAt:null,updatedAt:new Date().toISOString()});
    }
    res.status(200).json({ok:true});
  }catch(e){sendApiError(res,e)}
}
