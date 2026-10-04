import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { assertApproved, publicationPath, schedulePath } from "../_lib/workflow.js";
import { readJson, removeJson, writeJson } from "../_lib/blob-store.js";
import { publishInstagram } from "../_lib/meta.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["designer"]);
    const {clean,fingerprint}=await assertApproved(req.body?.project);
    const existing=await readJson(publicationPath(clean.id));
    if(existing) return res.status(200).json({ok:true,publication:existing,alreadyPublished:true});
    const result=await publishInstagram(clean);
    const publication={projectId:clean.id,fingerprint,...result,publishedBy:user.email,publishedByName:user.name};
    await writeJson(publicationPath(clean.id),publication);
    await removeJson(schedulePath(clean.id));
    res.status(200).json({ok:true,publication});
  }catch(e){sendApiError(res,e)}
}
