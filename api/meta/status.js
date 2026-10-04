function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const configured = Boolean(
    process.env.META_INSTAGRAM_APP_ID &&
      process.env.META_INSTAGRAM_APP_SECRET &&
      process.env.META_INSTAGRAM_REDIRECT_URI
  );

  const token = parseCookies(req.headers.cookie || "").lp_meta_token;
  if (!token) {
    res.status(200).json({ configured, connected: false });
    return;
  }

  try {
    const url = new URL("https://graph.instagram.com/me");
    url.searchParams.set("fields", "id,username,account_type");
    url.searchParams.set("access_token", token);

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json();

    if (!r.ok || data.error) {
      res.setHeader("Set-Cookie", "lp_meta_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      res.status(200).json({ configured, connected: false });
      return;
    }

    res.status(200).json({
      configured,
      connected: true,
      profile: { id: data.id, username: data.username, account_type: data.account_type },
    });
  } catch (e) {
    console.error("Meta status error", e);
    res.status(200).json({ configured, connected: false, error: "status_failed" });
  }
}
