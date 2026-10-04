import { listJson, readJson, removeJson, writeJson } from "../_lib/blob-store.js";
import { approvalPath, fingerprintProject, publicationPath } from "../_lib/workflow.js";
import { publishInstagram } from "../_lib/meta.js";

export default async function handler(req,res){
  if(req.headers.authorization!=="Bearer "+process.env.CRON_SECRET) return res.status(401).json({ok:false});
  const now=Date.now(), results=[];
  try{
    const blobs=await listJson("workflow/schedules/");
    for(const blob of blobs){
      const job=await readJson(blob.pathname);
      if(!job||new Date(job.scheduledAt).getTime()>now) continue;
      const existing=await readJson(publicationPath(job.projectId));
      if(existing){await removeJson(blob.pathname);results.push({id:job.projectId,status:"already-published"});continue}
      const approval=await readJson(approvalPath(job.projectId));
      if(!approval||approval.fingerprint!==fingerprintProject(job.project)){await removeJson(blob.pathname);results.push({id:job.projectId,status:"approval-invalid"});continue}
      try{
        const result=await publishInstagram(job.project);
        const publication={projectId:job.projectId,fingerprint:job.fingerprint,...result,publishedBy:"scheduler",publishedByName:"Agendamento automático"};
        await writeJson(publicationPath(job.projectId),publication);
        await removeJson(blob.pathname);
        results.push({id:job.projectId,status:"published",mediaId:result.mediaId});
      }catch(e){results.push({id:job.projectId,status:"error",error:e.message})}
    }
    res.status(200).json({ok:true,results});
  }catch(e){console.error(e);res.status(500).json({ok:false,error:e.message})}
}
