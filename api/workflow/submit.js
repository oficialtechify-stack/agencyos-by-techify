import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { approvalPath, schedulePath } from "../_lib/workflow.js";
import { removeJson, writeJson } from "../_lib/blob-store.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["designer"]);
    const source=req.body?.project||{};
    const id=String(source.id||"");
    const title=String(source.title||"").trim();
    if(!id||!title) return res.status(400).json({ok:false,error:"Conteúdo inválido."});
    if(source.createdByUid&&String(source.createdByUid)!==String(user.uid)) {
      return res.status(403).json({ok:false,error:"Este conteúdo não pertence à sua conta."});
    }
    const record={
      ...JSON.parse(JSON.stringify(source)),
      status:"review",
      scheduledAt:null,
      approvedAt:null,
      approvedBy:null,
      updatedAt:new Date().toISOString()
    };
    await Promise.all([
      writeJson("workspace/projects/"+encodeURIComponent(id)+".json",record),
      removeJson(approvalPath(id)),
      removeJson(schedulePath(id))
    ]);
    res.status(200).json({ok:true,project:record});
  }catch(e){sendApiError(res,e)}
}
