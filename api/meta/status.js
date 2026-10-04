import { getMetaConnection, saveMetaConnection, validateMetaToken } from "../_lib/meta.js";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf("=");return [p.slice(0,i),decodeURIComponent(p.slice(i+1))]}));
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const configured=Boolean(process.env.META_INSTAGRAM_APP_ID&&process.env.META_INSTAGRAM_APP_SECRET&&process.env.META_INSTAGRAM_REDIRECT_URI);
  try{
    let connection=await getMetaConnection();
    if(!connection){
      const legacy=parseCookies(req.headers.cookie||"").lp_meta_token;
      if(legacy){
        const profile=await validateMetaToken(legacy);
        if(profile) connection=await saveMetaConnection(legacy,5184000);
      }
    }
    if(!connection||!connection.accessToken) return res.status(200).json({configured,connected:false});
    const profile=await validateMetaToken(connection.accessToken);
    if(!profile) return res.status(200).json({configured,connected:false});
    res.status(200).json({configured,connected:true,profile,connectedAt:connection.connectedAt,expiresAt:connection.expiresAt});
  }catch(e){console.error("Meta status error",e);res.status(200).json({configured,connected:false,error:"status_failed"})}
}
