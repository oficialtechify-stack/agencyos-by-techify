import crypto from "node:crypto";
import { requireTeamUser, sendApiError } from "../_lib/auth.js";
import { listJson, readJson, writeJson } from "../_lib/blob-store.js";
import { sendTeamPush } from "../_lib/push.js";

function cleanAttachment(a){
  if(!a||typeof a!=="object")return null;
  const pathname=String(a.pathname||"");
  if(!pathname.startsWith("chat/files/"))return null;
  return {pathname,name:String(a.name||"arquivo").slice(0,180),type:String(a.type||"application/octet-stream").slice(0,120),size:Math.max(0,Number(a.size||0))};
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    if(req.method==="GET"){
      const blobs=await listJson("chat/messages/");
      const recent=blobs.sort((a,b)=>a.pathname.localeCompare(b.pathname)).slice(-100);
      const messages=(await Promise.all(recent.map(b=>readJson(b.pathname)))).filter(Boolean);
      messages.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      return res.status(200).json({ok:true,messages});
    }
    if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
    const messageText=String(req.body?.text||"").trim().slice(0,5000);
    const type=req.body?.type==="notice"?"notice":"message";
    const attachments=Array.isArray(req.body?.attachments)?req.body.attachments.map(cleanAttachment).filter(Boolean).slice(0,8):[];
    if(!messageText&&!attachments.length)return res.status(400).json({ok:false,error:"Escreva uma mensagem ou envie um arquivo."});
    const now=Date.now(),id=now.toString().padStart(13,"0")+"-"+crypto.randomBytes(6).toString("hex");
    const message={id,text:messageText,type,attachments,sender:{email:user.email,role:user.role,name:user.name},at:new Date(now).toISOString()};
    await writeJson("chat/messages/"+id+".json",message);
    const preview=messageText||(attachments.length===1?"Enviou um arquivo":"Enviou "+attachments.length+" arquivos");
    await sendTeamPush(user,{title:user.name+" · LeadsPay Connect",body:type==="notice"?"📌 Aviso: "+preview:preview,url:"/?open=chat",tag:"leadspay-chat-"+id});
    return res.status(200).json({ok:true,message});
  }catch(error){sendApiError(res,error)}
}
