import crypto from "node:crypto";
import { get } from "@vercel/blob";
import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { assertApproved, publicationPath, schedulePath } from "../_lib/workflow.js";
import { readJson, removeJson, writeJson } from "../_lib/blob-store.js";
import { publishInstagram } from "../_lib/meta.js";

function expectedSig(pathname){const secret=process.env.MEDIA_SIGNING_SECRET||process.env.META_INSTAGRAM_APP_SECRET||"";return crypto.createHmac("sha256",secret).update(pathname).digest("hex")}
function safeEqual(a,b){try{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}catch{return false}}

export default async function handler(req,res){
  if(req.method==="GET"&&req.query?.media){
    try{
      const pathname=String(req.query.media||""),sig=String(req.query.sig||"");
      if(!pathname.startsWith("content/files/")||!safeEqual(sig,expectedSig(pathname)))return res.status(403).end("Forbidden");
      const result=await get(pathname,{access:"private"});
      if(!result||result.statusCode!==200)return res.status(404).end("Not found");
      res.setHeader("Content-Type",result.blob.contentType||"application/octet-stream");
      res.setHeader("Cache-Control","public, max-age=3600");
      const reader=result.stream.getReader();
      while(true){const part=await reader.read();if(part.done)break;res.write(Buffer.from(part.value))}
      return res.end();
    }catch(e){console.error("media proxy",e);return res.status(500).end("Media error")}
  }
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
    const workspace=await readJson("workspace/projects/"+encodeURIComponent(clean.id)+".json");
    if(workspace)await writeJson("workspace/projects/"+encodeURIComponent(clean.id)+".json",{...workspace,status:"published",publishedAt:publication.publishedAt,metaMediaId:publication.mediaId,scheduledAt:null,updatedAt:new Date().toISOString()});
    res.status(200).json({ok:true,publication});
  }catch(e){sendApiError(res,e)}
}
