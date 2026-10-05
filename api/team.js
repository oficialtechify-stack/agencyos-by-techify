import crypto from "node:crypto";
import { get } from "@vercel/blob";
import { requireTeamUser, sendApiError } from "./_lib/auth.js";
import { listJson, readJson, removeJson, writeJson } from "./_lib/blob-store.js";
import { savePushSubscription, sendTeamPush } from "./_lib/push.js";

const projectPath=id=>"workspace/projects/"+encodeURIComponent(id)+".json";
const activityPath=id=>"workspace/activity/"+encodeURIComponent(id)+".json";
const settingsPath="workspace/settings.json";
const profilePath=role=>"workspace/profiles/"+role+".json";

function status(record){if(!record)return {online:false,lastSeen:null,visible:false};const age=Date.now()-new Date(record.lastSeen||0).getTime();return {...record,online:age<55000&&record.visible!==false}}
function cleanAttachment(a){if(!a||typeof a!=="object")return null;const pathname=String(a.pathname||"");if(!pathname.startsWith("chat/files/"))return null;return {pathname,name:String(a.name||"arquivo").slice(0,180),type:String(a.type||"application/octet-stream").slice(0,120),size:Math.max(0,Number(a.size||0))}}
function cleanProject(input){
  const p=input||{};
  return {
    id:String(p.id||"").slice(0,160),
    title:String(p.title||"").slice(0,240),
    platform:p.platform==="site"?"site":"instagram",
    format:String(p.format||"Outro").slice(0,80),
    campaign:String(p.campaign||"").slice(0,180),
    tags:Array.isArray(p.tags)?p.tags.map(x=>String(x).slice(0,60)).slice(0,20):[],
    caption:String(p.caption||"").slice(0,12000),
    assets:Array.isArray(p.assets)?p.assets.map((a,i)=>({
      id:String(a?.id||"").slice(0,180),
      name:String(a?.name||"arquivo").slice(0,180),
      type:String(a?.type||"").slice(0,120),
      size:Math.max(0,Number(a?.size||0)),
      order:Number.isFinite(Number(a?.order))?Number(a.order):i,
      url:a?.url?String(a.url).slice(0,2000):"",
      blobPath:a?.blobPath?String(a.blobPath).slice(0,500):"",
      path:a?.path?String(a.path).slice(0,500):"",
      localOnly:Boolean(a?.localOnly)
    })).slice(0,20):[],
    status:["draft","review","changes","approved","scheduled","published","failed"].includes(p.status)?p.status:"draft",
    scheduledAt:p.scheduledAt?String(p.scheduledAt):null,
    comments:Array.isArray(p.comments)?p.comments.map(c=>({id:String(c?.id||"").slice(0,160),text:String(c?.text||"").slice(0,4000),by:String(c?.by||"Equipe").slice(0,120),at:String(c?.at||new Date().toISOString())})).slice(-200):[],
    createdAt:String(p.createdAt||new Date().toISOString()),
    updatedAt:String(p.updatedAt||new Date().toISOString()),
    createdBy:String(p.createdBy||"").slice(0,120),
    createdByUid:p.createdByUid?String(p.createdByUid).slice(0,180):null,
    approvedAt:p.approvedAt?String(p.approvedAt):null,
    approvedBy:p.approvedBy?String(p.approvedBy).slice(0,180):null,
    publishedAt:p.publishedAt?String(p.publishedAt):null,
    metaMediaId:p.metaMediaId?String(p.metaMediaId).slice(0,240):null
  };
}
async function readAll(prefix,limit=300){
  const blobs=await listJson(prefix);
  const selected=blobs.sort((a,b)=>a.pathname.localeCompare(b.pathname)).slice(-limit);
  return (await Promise.all(selected.map(b=>readJson(b.pathname)))).filter(Boolean);
}
async function workspaceSnapshot(){
  const [projects,activity,settings,adminProfile,designerProfile]=await Promise.all([
    readAll("workspace/projects/",500),
    readAll("workspace/activity/",300),
    readJson(settingsPath),
    readJson(profilePath("admin")),
    readJson(profilePath("designer"))
  ]);
  projects.sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  activity.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
  return {projects,activity,settings:settings||{},profiles:{admin:adminProfile,designer:designerProfile}};
}
function statusAllowed(user,existing,next){
  if(user.role==="admin")return true;
  if(!existing)return next==="draft"||next==="review";
  if(["approved","scheduled","published"].includes(existing.status))return next===existing.status;
  return ["draft","review","changes"].includes(next);
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const action=String(req.query?.action||"");
  if(action==="push-key"){
    res.setHeader("Cache-Control","public, max-age=3600");
    return res.status(200).json({ok:true,publicKey:process.env.PUSH_VAPID_PUBLIC_KEY||""});
  }
  try{
    const user=await requireTeamUser(req,["admin","designer"]);

    if(action==="workspace"){
      if(req.method!=="GET")return res.status(405).json({ok:false,error:"Método não permitido."});
      return res.status(200).json({ok:true,...await workspaceSnapshot()});
    }
    if(action==="project-save"){
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      const project=cleanProject(req.body?.project);
      if(!project.id||!project.title)return res.status(400).json({ok:false,error:"Conteúdo inválido."});
      const existing=await readJson(projectPath(project.id));
      if(!statusAllowed(user,existing,project.status))return res.status(403).json({ok:false,error:"Você não pode alterar este conteúdo para esse status."});
      if(existing?.createdByUid&&user.role==="designer"&&existing.createdByUid!==user.uid)return res.status(403).json({ok:false,error:"Conteúdo não pertence à sua conta."});
      const record={...project,updatedAt:new Date().toISOString()};
      await writeJson(projectPath(project.id),record);
      return res.status(200).json({ok:true,project:record});
    }
    if(action==="project-delete"){
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      const id=String(req.body?.projectId||"");
      if(!id)return res.status(400).json({ok:false,error:"Conteúdo inválido."});
      const existing=await readJson(projectPath(id));
      if(existing&&user.role==="designer"&&!["draft","changes"].includes(existing.status))return res.status(403).json({ok:false,error:"Esse conteúdo não pode mais ser excluído."});
      await removeJson(projectPath(id));
      return res.status(200).json({ok:true});
    }
    if(action==="activity-add"){
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      const item=req.body?.activity||{};
      const id=String(item.id||Date.now()+"-"+crypto.randomBytes(4).toString("hex"));
      const record={id,action:String(item.action||"Atividade").slice(0,240),projectId:item.projectId?String(item.projectId).slice(0,180):null,detail:String(item.detail||"").slice(0,1000),by:user.name,at:String(item.at||new Date().toISOString())};
      await writeJson(activityPath(id),record);
      return res.status(200).json({ok:true,activity:record});
    }
    if(action==="settings-save"){
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      if(user.role!=="admin")return res.status(403).json({ok:false,error:"Somente o administrador pode alterar as configurações."});
      const s=req.body?.settings||{};
      const record={adminName:String(s.adminName||"Rick").slice(0,100),designerName:String(s.designerName||"Designer").slice(0,100),company:String(s.company||"LeadsPay").slice(0,120),calendarStart:Number(s.calendarStart||1),updatedAt:new Date().toISOString()};
      await writeJson(settingsPath,record);
      return res.status(200).json({ok:true,settings:record});
    }
    if(action==="profile"){
      if(req.method==="GET"){
        const profile=await readJson(profilePath(user.role));
        return res.status(200).json({ok:true,profile});
      }
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      const p=req.body?.profile||{};
      const existing=await readJson(profilePath(user.role));
      const record={...(existing||{}),name:String(p.name||user.name).trim().slice(0,100)||user.name,jobTitle:String(p.jobTitle||user.role==="admin"?"Administrador":"Designer").slice(0,100),phone:String(p.phone||"").slice(0,40),instagram:String(p.instagram||"").slice(0,100),bio:String(p.bio||"").slice(0,500),role:user.role,email:user.email,updatedAt:new Date().toISOString(),createdAt:existing?.createdAt||new Date().toISOString()};
      await writeJson(profilePath(user.role),record);
      return res.status(200).json({ok:true,profile:record});
    }

    if(action==="presence"){
      if(req.method==="POST"){
        const profile=await readJson(profilePath(user.role));
        const record={email:user.email,role:user.role,name:profile?.name||user.name,visible:req.body?.visible!==false,lastSeen:new Date().toISOString()};
        await writeJson("chat/presence/"+user.role+".json",record);
        return res.status(200).json({ok:true,presence:status(record)});
      }
      if(req.method!=="GET")return res.status(405).json({ok:false,error:"Método não permitido."});
      const values=await Promise.all([readJson("chat/presence/admin.json"),readJson("chat/presence/designer.json")]);
      const other=user.role==="admin"?status(values[1]):status(values[0]);
      return res.status(200).json({ok:true,self:user.role,other});
    }

    if(action==="messages"){
      if(req.method==="GET"){
        const blobs=await listJson("chat/messages/");
        const recent=blobs.sort((a,b)=>a.pathname.localeCompare(b.pathname)).slice(-100);
        const messages=(await Promise.all(recent.map(b=>readJson(b.pathname)))).filter(Boolean);
        messages.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
        return res.status(200).json({ok:true,messages});
      }
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      const messageText=String(req.body?.text||"").trim().slice(0,5000),type=req.body?.type==="notice"?"notice":"message";
      const attachments=Array.isArray(req.body?.attachments)?req.body.attachments.map(cleanAttachment).filter(Boolean).slice(0,8):[];
      if(!messageText&&!attachments.length)return res.status(400).json({ok:false,error:"Escreva uma mensagem ou envie um arquivo."});
      const now=Date.now(),id=now.toString().padStart(13,"0")+"-"+crypto.randomBytes(6).toString("hex");
      const profile=await readJson(profilePath(user.role));
      const senderName=profile?.name||user.name;
      const message={id,text:messageText,type,attachments,sender:{email:user.email,role:user.role,name:senderName},at:new Date(now).toISOString()};
      await writeJson("chat/messages/"+id+".json",message);
      const preview=messageText||(attachments.length===1?"Enviou um arquivo":"Enviou "+attachments.length+" arquivos");
      await sendTeamPush({...user,name:senderName},{title:senderName+" · LeadsPay Connect",body:type==="notice"?"📌 Aviso: "+preview:preview,url:"/?open=chat",tag:"leadspay-chat-"+id});
      return res.status(200).json({ok:true,message});
    }

    if(action==="file"){
      if(req.method!=="GET")return res.status(405).json({ok:false,error:"Método não permitido."});
      const pathname=String(req.query?.path||"");
      if(!pathname.startsWith("chat/files/"))return res.status(400).json({ok:false,error:"Arquivo inválido."});
      const result=await get(pathname,{access:"private"});
      if(!result||result.statusCode!==200)return res.status(404).end("Arquivo não encontrado.");
      res.setHeader("Content-Type",result.blob.contentType||"application/octet-stream");
      res.setHeader("Cache-Control","private, max-age=300");
      const reader=result.stream.getReader();
      while(true){const part=await reader.read();if(part.done)break;res.write(Buffer.from(part.value))}
      return res.end();
    }

    if(action==="push-subscribe"){
      if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
      await savePushSubscription(user,req.body?.subscription);
      return res.status(200).json({ok:true});
    }

    return res.status(404).json({ok:false,error:"Ação não encontrada."});
  }catch(e){sendApiError(res,e)}
}
