import crypto from "node:crypto";

export default function handler(req, res) {
  const clientId = process.env.META_INSTAGRAM_APP_ID;
  const redirectUri = process.env.META_INSTAGRAM_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Meta não configurada</title><body style="font-family:Inter,system-ui;background:#07070a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><main style="max-width:620px;padding:28px;border:1px solid #2b2636;border-radius:18px;background:#0f0d12"><h1 style="margin-top:0">Falta configurar a Meta</h1><p style="color:#aaa4b5;line-height:1.6">Adicione <b>META_INSTAGRAM_APP_ID</b> e <b>META_INSTAGRAM_REDIRECT_URI</b> nas variáveis de ambiente da Vercel. Depois tente conectar novamente.</p><a href="/" style="color:#c4b5fd">Voltar ao LeadsPay Connect</a></main></body></html>');
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  res.setHeader("Set-Cookie", `lp_meta_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("state", state);

  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.end();
}
