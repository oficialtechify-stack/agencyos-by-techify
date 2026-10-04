const TEAM = {
  "rickmarketing81@gmail.com": { role: "admin", name: "Rick" },
  "vitoriajob02@gmail.com": { role: "designer", name: "Vitória" },
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function requireTeamUser(req, allowedRoles = []) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Sessão ausente.");

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw httpError(500, "Autenticação do servidor não configurada.");

  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );
  const data = await response.json();
  const account = data && data.users && data.users[0];
  if (!response.ok || !account || !account.email) throw httpError(401, "Sessão inválida.");

  const email = String(account.email).toLowerCase();
  const member = TEAM[email];
  if (!member) throw httpError(403, "Conta não autorizada.");
  if (allowedRoles.length && !allowedRoles.includes(member.role)) {
    throw httpError(403, "Você não tem permissão para esta ação.");
  }

  return { uid: account.localId, email, ...member };
}

export function sendApiError(res, error) {
  const status = Number(error && error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ ok: false, error: error && error.message ? error.message : "Erro interno." });
}
