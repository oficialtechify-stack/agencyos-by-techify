import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { requireTeamUser, sendApiError } from "../_lib/auth.js";
export const config={api:{bodyParser:false}};
function collect(req,maxBytes){return new Promise((resolve,reject)=>{const chunks=[];let total=0;req.on("data",chunk=>{total+=chunk.length;if(total>maxBytes){reject(Object.assign(new Error("Arquivo muito grande. Limite de 4 MB por arquivo."),{status:413}));req.destroy();return}chunks.push(chunk)});req.on("end",()=>resolve(Buffer.concat(chunks)));req.on("error",reject)})}
function safeName(name){return String(name||"arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)||"arquivo"}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    const body=await collect(req,4*1024*1024);
    if(!body.length)return res.status(400).json({ok:false,error:"Arquivo vazio."});
    const original=String(req.query?.name||"arquivo").slice(0,180),name=safeName(original),contentType=String(req.headers["content-type"]||"application/octet-stream").slice(0,120);
    const pathname="chat/files/"+Date.now()+"-"+crypto.randomBytes(6).toString("hex")+"-"+name;
    await put(pathname,body,{access:"private",contentType,addRandomSuffix:false});
    res.status(200).json({ok:true,attachment:{pathname,name:original,type:contentType,size:body.length,uploadedBy:user.email}});
  }catch(e){sendApiError(res,e)}
}
