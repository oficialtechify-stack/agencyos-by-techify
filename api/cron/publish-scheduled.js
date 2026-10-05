import { createRemoteJWKSet, jwtVerify } from "jose";
import { listJson, readJson, writeJson } from "../_lib/blob-store.js";
import { approvalPath, fingerprintProject, publicProject, schedulePath } from "../_lib/workflow.js";
import { enqueueScheduledPublish, processScheduledPublish, SCHEDULE_TOPIC } from "../_lib/scheduled-publish.js";
import { send } from "@vercel/queue";

const jwks=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

async function authorized(req){
  const header=req.headers.authorization||"";
  if(process.env.CRON_SECRET&&header==="Bearer "+process.env.CRON_SECRET) return true;
  if(!header.startsWith("Bearer ")) return false;
  try{
    const token=header.slice(7);
    const {payload}=await jwtVerify(token,jwks,{issuer:"https://token.actions.githubusercontent.com",audience:"leadspay-connect"});
    return payload.repository==="oficialtechify-stack/agencyos-by-techify"&&payload.ref==="refs/heads/main";
  }catch(e){
    console.warn("Scheduler auth failed",e.message);
    return false;
  }
}

async function allJson(prefix){
  const blobs=await listJson(prefix);
  return (await Promise.all(blobs.map(async b=>({pathname:b.pathname,data:await readJson(b.pathname)})))).filter(x=>x.data);
}

export default async function handler(req,res){
  if(!(await authorized(req))) return res.status(401).json({ok:false});

  const now=Date.now();
  const results=[];
  const repaired=[];

  try{
    if(String(req.query?.testQueue||"")==="1"){
      const test=await send(SCHEDULE_TOPIC,{
        projectId:"__queue_test__",
        scheduledAt:new Date(now).toISOString(),
        fingerprint:"queue-test",
        hop:0
      },{
        retentionSeconds:300,
        idempotencyKey:"leadspay-queue-test-"+Math.floor(now/60000)
      });
      console.log("queue_test_sent",test.messageId);
      return res.status(200).json({ok:true,testQueue:true,messageId:test.messageId});
    }
    // Recover old schedules that were only marked in the workspace but never made it
    // into the scheduler queue (this is what happened with the missed post).
    const [scheduleEntries,workspaceEntries,activityEntries]=await Promise.all([
      allJson("workflow/schedules/"),
      allJson("workspace/projects/"),
      allJson("workspace/activity/")
    ]);

    const scheduleById=new Map(scheduleEntries.map(x=>[String(x.data.projectId||""),x.data]));
    const scheduledProjects=workspaceEntries
      .map(x=>x.data)
      .filter(p=>p&&p.status==="scheduled"&&p.scheduledAt);

    for(const project of scheduledProjects){
      const projectId=String(project.id||"");
      if(!projectId) continue;

      let job=scheduleById.get(projectId);
      if(!job){
        const approval=await readJson(approvalPath(projectId));
        const fingerprint=fingerprintProject(project);
        if(!approval||approval.fingerprint!==fingerprint){
          results.push({id:projectId,status:"cannot-repair-approval-invalid"});
          continue;
        }
        job={
          projectId,
          project:publicProject(project),
          fingerprint,
          scheduledAt:String(project.scheduledAt),
          scheduledBy:"recovery",
          createdAt:new Date().toISOString(),
          updatedAt:new Date().toISOString()
        };
        await writeJson(schedulePath(projectId),job);
        scheduleById.set(projectId,job);
        repaired.push({id:projectId,status:"schedule-record-recreated"});
      }

      const dueMs=new Date(job.scheduledAt).getTime();
      if(!Number.isFinite(dueMs)){
        results.push({id:projectId,status:"invalid-date"});
        continue;
      }

      if(dueMs<=now+15_000){
        try{
          const result=await processScheduledPublish({
            projectId,
            scheduledAt:job.scheduledAt,
            fingerprint:job.fingerprint,
            hop:Number(job.queue?.hop||0)
          });
          results.push({id:projectId,...result});
        }catch(error){
          results.push({id:projectId,status:"error",error:error?.message||String(error)});
        }
      }else if(!job.queue?.messageId){
        try{
          const queue=await enqueueScheduledPublish(job,0);
          job={...job,queue,updatedAt:new Date().toISOString()};
          await writeJson(schedulePath(projectId),job);
          repaired.push({id:projectId,status:"queued",scheduledAt:job.scheduledAt,messageId:queue.messageId});
        }catch(error){
          results.push({id:projectId,status:"queue-error",error:error?.message||String(error)});
        }
      }
    }

    const pending=[...scheduleById.values()]
      .filter(job=>Number.isFinite(new Date(job.scheduledAt).getTime())&&new Date(job.scheduledAt).getTime()>now)
      .map(job=>({
        id:job.projectId,
        title:job.project?.title||"",
        scheduledAt:job.scheduledAt,
        queueMessageId:job.queue?.messageId||null,
        minutesUntil:Math.round((new Date(job.scheduledAt).getTime()-now)/60000)
      }));

    const rawScheduleActivities=activityEntries
      .map(x=>x.data)
      .filter(a=>String(a?.action||"").toLowerCase().includes("agendou"))
      .sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")))
      .slice(0,20);

    const recentScheduleActivities=await Promise.all(rawScheduleActivities.map(async a=>{
      const project=workspaceEntries.map(x=>x.data).find(p=>String(p?.id||"")===String(a.projectId||""));
      const publication=a.projectId?await readJson("workflow/publications/"+encodeURIComponent(a.projectId)+".json"):null;
      return {
        id:a.id,
        projectId:a.projectId||null,
        action:a.action,
        detail:a.detail||"",
        at:a.at||null,
        by:a.by||"",
        currentProjectStatus:project?.status||null,
        currentProjectTitle:project?.title||null,
        currentScheduledAt:project?.scheduledAt||null,
        publication:publication?{
          mediaId:publication.mediaId||null,
          publishedAt:publication.publishedAt||null,
          publishedBy:publication.publishedBy||null,
          publishedByName:publication.publishedByName||null
        }:null
      };
    }));

    console.log("scheduler_recovery",JSON.stringify({
      at:new Date(now).toISOString(),
      scheduledProjects:scheduledProjects.length,
      scheduleRecords:scheduleEntries.length,
      repaired,
      pending,
      recentScheduleActivities,
      results
    }));

    res.status(200).json({
      ok:true,
      at:new Date(now).toISOString(),
      scheduledProjects:scheduledProjects.length,
      scheduleRecords:scheduleEntries.length,
      repaired,
      pending,
      recentScheduleActivities,
      results
    });
  }catch(e){
    console.error("scheduler_recovery_error",e);
    res.status(500).json({ok:false,error:e?.message||String(e)});
  }
}
