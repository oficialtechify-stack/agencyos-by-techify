import { createRemoteJWKSet, jwtVerify } from "jose";
import { listJson, readJson, removeJson, writeJson } from "../_lib/blob-store.js";
import { approvalPath, fingerprintProject, publicationPath } from "../_lib/workflow.js";
import { publishInstagram } from "../_lib/meta.js";

const jwks=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
async function authorized(req){
  const header=req.headers.authorization||"";
  if(process.env.CRON_SECRET&&header==="Bearer "+process.env.CRON_SECRET) return true;
  if(!header.startsWith("Bearer ")) return false;
  try{
    const token=header.slice(7);
    const {payload}=await jwtVerify(token,jwks,{issuer:"https://token.actions.githubusercontent.com",audience:"leadspay-connect"});
    return payload.repository==="oficialtechify-stack/agencyos-by-techify"&&payload.ref==="refs/heads/main";
  }catch(e){console.warn("Scheduler auth failed",e.message);return false}
}
async function updateWorkspace(id,patch){
  const path="workspace/projects/"+encodeURIComponent(id)+".json";
  const existing=await readJson(path);
  if(existing) await writeJson(path,{...existing,...patch,updatedAt:new Date().toISOString()});
}
export default async function handler(req,res){
  if(!(await authorized(req))) return res.status(401).json({ok:false});
  const now=Date.now(),results=[];
  try{
    const blobs=await listJson("workflow/schedules/");
    for(const blob of blobs){
      const job=await readJson(blob.pathname);
      if(!job||new Date(job.scheduledAt).getTime()>now) continue;
      const existing=await readJson(publicationPath(job.projectId));
      if(existing){await removeJson(blob.pathname);await updateWorkspace(job.projectId,{status:"published",publishedAt:existing.publishedAt,metaMediaId:existing.mediaId,scheduledAt:null});results.push({id:job.projectId,status:"already-published"});continue}
      const approval=await readJson(approvalPath(job.projectId));
      if(!approval||approval.fingerprint!==fingerprintProject(job.project)){await removeJson(blob.pathname);await updateWorkspace(job.projectId,{status:"changes",scheduledAt:null});results.push({id:job.projectId,status:"approval-invalid"});continue}
      try{
        const result=await publishInstagram(job.project);
        const publication={projectId:job.projectId,fingerprint:job.fingerprint,...result,publishedBy:"scheduler",publishedByName:"Agendamento automático"};
        await writeJson(publicationPath(job.projectId),publication);
        await removeJson(blob.pathname);
        await updateWorkspace(job.projectId,{status:"published",publishedAt:publication.publishedAt,metaMediaId:publication.mediaId,scheduledAt:null});
        results.push({id:job.projectId,status:"published",mediaId:result.mediaId});
      }catch(e){
        await updateWorkspace(job.projectId,{status:"failed"});
        results.push({id:job.projectId,status:"error",error:e.message})
      }
    }
    res.status(200).json({ok:true,results});
  }catch(e){console.error(e);res.status(500).json({ok:false,error:e.message})}
}
