import { get } from "@vercel/blob";
import { requireTeamUser, sendApiError } from "../_lib/auth.js";
export default async function handler(req,res){
  try{
    await requireTeamUser(req,["admin","designer"]);
    const pathname=String(req.query?.path||"");
    if(!pathname.startsWith("chat/files/"))return res.status(400).json({ok:false,error:"Arquivo inválido."});
    const result=await get(pathname,{access:"private"});
    if(!result||result.statusCode!==200)return res.status(404).end("Arquivo não encontrado.");
    res.setHeader("Content-Type",result.blob.contentType||"application/octet-stream");
    res.setHeader("Cache-Control","private, max-age=300");
    const reader=result.stream.getReader();
    while(true){const part=await reader.read();if(part.done)break;res.write(Buffer.from(part.value))}
    res.end();
  }catch(e){sendApiError(res,e)}
}
