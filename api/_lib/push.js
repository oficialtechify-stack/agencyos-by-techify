import crypto from "node:crypto";
import webpush from "web-push";
import { listRecords as listJson, readRecord as readJson, removeRecord as removeJson, writeRecord as writeJson } from "./record-store.js";

function configured(){return Boolean(process.env.PUSH_VAPID_PUBLIC_KEY&&process.env.PUSH_VAPID_PRIVATE_KEY)}
function configure(){
  if(!configured())return false;
  webpush.setVapidDetails(process.env.PUSH_VAPID_SUBJECT||"https://leadspay-connect.vercel.app",process.env.PUSH_VAPID_PUBLIC_KEY,process.env.PUSH_VAPID_PRIVATE_KEY);
  return true;
}
function subscriptionPath(email,endpoint){
  const key=crypto.createHash("sha256").update(String(email)+"|"+String(endpoint)).digest("hex");
  return "push/subscriptions/"+key+".json";
}
export async function savePushSubscription(user,subscription,token){
  if(!subscription||!subscription.endpoint||!subscription.keys?.p256dh||!subscription.keys?.auth)throw Object.assign(new Error("Assinatura de notificação inválida."),{status:400});
  const record={email:user.email,role:user.role,name:user.name,subscription,updatedAt:new Date().toISOString()};
  await writeJson(subscriptionPath(user.email,subscription.endpoint),record,token,{uid:user.uid,role:user.role});
  return record;
}
export async function sendTeamPush(sender,payload,token){
  if(!configure())return {sent:0,configured:false};
  const blobs=await listJson("push/subscriptions/",token);
  const records=(await Promise.all(blobs.map(b=>readJson(b.pathname,token)))).filter(Boolean);
  let sent=0;
  for(const record of records){
    if(!record.subscription||record.email===sender.email)continue;
    try{await webpush.sendNotification(record.subscription,JSON.stringify(payload),{TTL:3600});sent++}
    catch(error){
      const code=Number(error?.statusCode||0);
      if(code===404||code===410)await removeJson(subscriptionPath(record.email,record.subscription.endpoint),token);
      else console.warn("Push send failed",code,error?.message);
    }
  }
  return {sent,configured:true};
}
