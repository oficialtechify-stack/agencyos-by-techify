import { saveMetaConnection } from "../_lib/meta.js";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf("=");return [p.slice(0,i),decodeURIComponent(p.slice(i+1))]}));
}
function redirectHome(req,res,result){
  const base=process.env.META_APP_URL||("https://"+req.headers.host);
  res.statusCode=302;res.setHeader("Location",base+"/?meta="+encodeURIComponent(result));res.end();
}
export default async function handler(req,res){
  const clientId=process.env.META_INSTAGRAM_APP_ID,clientSecret=process.env.META_INSTAGRAM_APP_SECRET,redirectUri=process.env.META_INSTAGRAM_REDIRECT_URI;
  if(!clientId||!clientSecret||!redirectUri){redirectHome(req,res,"config_missing");return}
  const cookies=parseCookies(req.headers.cookie||"");const {code,state,error}=req.query||{};
  if(error){redirectHome(req,res,"denied");return}
  if(!code||!state||!cookies.lp_meta_state||state!==cookies.lp_meta_state){redirectHome(req,res,"invalid_state");return}
  try{
    const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"authorization_code",redirect_uri:redirectUri,code:String(code)});
    const shortRes=await fetch("https://api.instagram.com/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const shortData=await shortRes.json();
    if(!shortRes.ok||!shortData.access_token){console.error("Meta short token error",shortData);redirectHome(req,res,"token_error");return}
    const longUrl=new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type","ig_exchange_token");longUrl.searchParams.set("client_secret",clientSecret);longUrl.searchParams.set("access_token",shortData.access_token);
    const longRes=await fetch(longUrl);const longData=await longRes.json();
    if(!longRes.ok||!longData.access_token){console.error("Meta long token error",longData);redirectHome(req,res,"token_error");return}
    await saveMetaConnection(longData.access_token,longData.expires_in);
    res.setHeader("Set-Cookie",["lp_meta_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0","lp_meta_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);
    redirectHome(req,res,"connected");
  }catch(e){console.error("Meta callback error",e);redirectHome(req,res,"server_error")}
}
