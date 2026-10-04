export default function handler(req, res) {
  res.setHeader("Set-Cookie", "lp_meta_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.status(200).json({ ok: true });
}
