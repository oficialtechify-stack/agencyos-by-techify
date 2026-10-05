import crypto from "node:crypto";
import { get } from "@vercel/blob";
import { requireTeamUser, sendApiError } from "./_lib/auth.js";
import { listJson, readJson, writeJson } from "./_lib/blob-store.js";
import { savePushSubscription, sendTeamPush } from "./_lib/push.js";

function status(record){if(!record)return {online:false,lastSeen:null,visible:false};const age=Date.now()-new Date(record.lastSeen||0).getTime();return {...record,online:age<55000&&record.visible!==false}}
function cleanAttachment(a){if(!a||typeof a!=="object")return null;const pathname=String(a.pathname||"");if(!pathname.startsWith("chat/files/"))return null;return {pathname,name:String(a.name||"arquivo").slice(0,180),type:String(a.type||"application/octet-stream").slice(0,120),size:Math.max(0,Number(a.size||0))}}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const action=String(req.query?.action||"");
  if(action==="push-key"){
    res.setHeader("Cache-Control","public, max-age=3600");
    return res.status(200).json({ok:true,publicKey:process.env.PUSH_VAPID_PUBLIC_KEY||""});
  }
  try{
    const user=await requireTeamUser(req,["admin","designer"]);

    if(action==="presence"){
      if(req.method==="POST"){
        const record={email:user.email,role:user.role,name:user.name,visible:req.body?.visible!==false,lastSeen:new Date().toISOString()};
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
      const message={id,text:messageText,type,attachments,sender:{email:user.email,role:user.role,name:user.name},at:new Date(now).toISOString()};
      await writeJson("chat/messages/"+id+".json",message);
      const preview=messageText||(attachments.length===1?"Enviou um arquivo":"Enviou "+attachments.length+" arquivos");
      await sendTeamPush(user,{title:user.name+" · LeadsPay Connect",body:type==="notice"?"📌 Aviso: "+preview:preview,url:"/?open=chat",tag:"leadspay-chat-"+id});
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
