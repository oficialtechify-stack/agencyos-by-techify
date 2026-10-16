import crypto from "node:crypto";

import { requireTeamUser, sendApiError } from "./_lib/auth.js";
export const config={api:{bodyParser:false}};
function collect(req,maxBytes){return new Promise((resolve,reject)=>{const chunks=[];let total=0;req.on("data",chunk=>{total+=chunk.length;if(total>maxBytes){reject(Object.assign(new Error("Arquivo muito grande."),{status:413}));req.destroy();return}chunks.push(chunk)});req.on("end",()=>resolve(Buffer.concat(chunks)));req.on("error",reject)})}
function safeName(name){return String(name||"arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)||"arquivo"}
function mediaSig(pathname){const secret=process.env.MEDIA_SIGNING_SECRET||process.env.META_INSTAGRAM_APP_SECRET||"";return crypto.createHmac("sha256",secret).update(pathname).digest("hex")}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método não permitido."});
  try{
    const user=await requireTeamUser(req,["admin","designer"]);
    const mode=String(req.query?.mode||"chat");
    const max=mode==="content"?10*1024*1024:4*1024*1024;
    const body=await collect(req,max);if(!body.length)return res.status(400).json({ok:false,error:"Arquivo vazio."});
    const original=String(req.query?.name||"arquivo").slice(0,180),name=safeName(original),contentType=String(req.headers["content-type"]||"application/octet-stream").slice(0,120);
    if(mode==="content"&&!contentType.startsWith("image/"))return res.status(400).json({ok:false,error:"Por enquanto, envie imagens para os conteúdos do Instagram e do site."});
    const folder=mode==="content"?"content/files/":"chat/files/";
    const pathname=folder+Date.now()+"-"+crypto.randomBytes(6).toString("hex")+"-"+name;

    const cloud=process.env.CLOUDINARY_CLOUD_NAME, key=process.env.CLOUDINARY_API_KEY, secret=process.env.CLOUDINARY_API_SECRET;
    if(!cloud||!key||!secret)throw Object.assign(new Error("O armazenamento gratuito de imagens ainda precisa ser conectado. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET na Vercel."),{status:503});
    if(!contentType.startsWith("image/")&&!contentType.startsWith("application/pdf"))throw Object.assign(new Error("Envie imagens ou PDF."),{status:400});
    const form=new FormData();
    form.append("file",new Blob([body],{type:contentType}),name);
    form.append("folder",folder==="content/files/"?"leadspay-connect/content":"leadspay-connect/chat");
    const result=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloud)+"/"+(contentType==="application/pdf"?"raw":"image")+"/upload",{
      method:"POST",headers:{"Authorization":"Basic "+Buffer.from(key+":"+secret).toString("base64")},body:form
    });
    const uploaded=await result.json().catch(()=>({}));
    if(!result.ok||!uploaded.secure_url)throw Object.assign(new Error("Cloudinary recusou o envio: "+String(uploaded.error?.message||result.status)),{status:502});
    const url=uploaded.secure_url;
    const publicPath=uploaded.public_id;

    if(mode==="content"){
      const base=process.env.META_APP_URL||("https://"+req.headers.host);
      // A imagem publica Cloudinary fornece URL HTTPS para exibicao e API Meta.
      return res.status(200).json({ok:true,asset:{id:"asset_"+crypto.randomBytes(8).toString("hex"),name:original,type:contentType,size:body.length,blobPath:"",path:publicPath,url,uploadedBy:user.email}});
    }
    res.status(200).json({ok:true,attachment:{pathname:"cloudinary:"+publicPath,name:original,type:contentType,size:body.length,url,uploadedBy:user.email}});
  }catch(e){sendApiError(res,e)}
}
