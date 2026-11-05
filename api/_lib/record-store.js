import { readJson as blobRead, writeJson as blobWrite, removeJson as blobRemove, listJson as blobList } from "./blob-store.js";
import { decodeJwt } from "jose";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Firestore project for the record adapter. Never hardcode the old project:
// the front uses agencyos-1c3fc, so the backend must read/write the same one.
const projectId = process.env.CONNECT_FIRESTORE_PROJECT_ID || "agencyos-1c3fc";
const apiBase = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents";
const enabled = () => process.env.CONNECT_STORAGE_BACKEND === "firestore";
const idFor = path => Buffer.from(path, "utf8").toString("base64url");
const endpoint = path => apiBase + "/connectRecords/" + encodeURIComponent(idFor(path));

// Server identity (option A): when a Firebase service account is configured
// (FIREBASE_SERVICE_ACCOUNT_JSON exists in Vercel), the Admin SDK talks to
// Firestore as the server. Cron and the queue have no user token, so they can
// only work through this path. Without a service account, keep the current
// REST path with the user's idToken.
let adminDb = null;
let adminUnavailable = false;
function getAdminDb() {
  if (adminDb) return adminDb;
  if (adminUnavailable) return null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const credential = JSON.parse(raw);
    const app = getApps().find(a => a.name === "agencyos-admin") ||
      initializeApp({ credential: cert(credential), projectId }, "agencyos-admin");
    adminDb = getFirestore(app);
    return adminDb;
  } catch (e) {
    adminUnavailable = true;
    console.error("Firebase Admin indisponível; usando REST com token do usuário:", e?.message || e);
    return null;
  }
}
const useAdmin = () => enabled() && Boolean(getAdminDb());

// Owner stamped on every Firestore document (see firestore.rules,
// match /connectRecords). Routes pass it explicitly when they know the user;
// otherwise derive it from the idToken (already validated upstream by
// requireTeamUser). owner === null means "preserve the existing ownerUid"
// (used by system patches of user records). System writes with no user and
// no explicit owner are stamped as system.
function ownerFromToken(token) {
  if (!token) return null;
  try {
    const payload = decodeJwt(String(token).replace(/^Bearer\s+/i, ""));
    const email = String(payload.email || "").toLowerCase();
    const role = email === "rickmarketing81@gmail.com" ? "admin"
      : email === "vitoriajob02@gmail.com" ? "designer" : "member";
    const uid = String(payload.sub || "");
    return uid ? { uid, role } : null;
  } catch {
    return null;
  }
}
function resolveOwner(token, owner) {
  if (owner === null) return null;
  if (owner && owner.uid) return { uid: String(owner.uid), role: String(owner.role || "") };
  return ownerFromToken(token) || { uid: "system", role: "system" };
}

function requireToken(token) {
  if (!token || !token.startsWith("Bearer ")) {
    const e = new Error("Sessão necessária para acessar o Firebase."); e.status = 401; throw e;
  }
  return token;
}
async function request(url, token, method="GET", body) {
  const response = await fetch(url, {
    method,
    headers: {Authorization: requireToken(token), ...(body ? {"Content-Type":"application/json"} : {})},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  if (response.status === 404) return null;
  let data;
  try { data = await response.json() } catch { data = {} }
  if (!response.ok) {
    const e = new Error(response.status === 403
      ? "O Firestore recusou o acesso. Verifique as regras do Firebase e os usuários autorizados."
      : "Falha no Firestore (" + response.status + "): " + String(data?.error?.message || "indisponível"));
    e.status = response.status === 403 ? 503 : (response.status >= 500 ? 503 : response.status);
    throw e;
  }
  return data;
}
async function adminRead(path) {
  const snap = await getAdminDb().collection("connectRecords").doc(idFor(path)).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data && typeof data.json === "string" ? JSON.parse(data.json) : null;
}
async function adminWrite(path, data, owner) {
  const fields = {
    path,
    json: JSON.stringify(data),
    updatedAt: new Date().toISOString()
  };
  if (owner && owner.uid) {
    fields.ownerUid = owner.uid;
    if (owner.role) fields.ownerRole = owner.role;
  }
  await getAdminDb().collection("connectRecords").doc(idFor(path)).set(fields, { merge: true });
}
async function adminRemove(path) {
  await getAdminDb().collection("connectRecords").doc(idFor(path)).delete();
}
async function adminList(prefix) {
  const snap = await getAdminDb().collection("connectRecords")
    .where("path", ">=", prefix).where("path", "<", prefix + "\uf8ff").limit(1500).get();
  const records = snap.docs
    .map(d => d.data() && d.data().path)
    .filter(p => typeof p === "string" && p.startsWith(prefix))
    .map(pathname => ({ pathname }));
  if (records.length >= 1500) {
    const error = new Error("Limite de registros atingido; a paginação precisa ser configurada."); error.status = 503; throw error;
  }
  return records;
}

// The old Blob records remain untouched. Explicit cutover is required after a verified migration.
export async function readRecord(path, token) {
  if (!enabled()) return blobRead(path);
  if (useAdmin()) return adminRead(path);
  const doc = await request(endpoint(path),token);
  return doc ? JSON.parse(doc.fields.json.stringValue) : null;
}
export async function writeRecord(path, data, token, owner) {
  if (!enabled()) return blobWrite(path,data);
  const resolved = resolveOwner(token, owner);
  if (useAdmin()) return adminWrite(path, data, resolved);
  const fields = {
    path:{stringValue:path},
    json:{stringValue:JSON.stringify(data)},
    updatedAt:{timestampValue:new Date().toISOString()}
  };
  if (resolved && resolved.uid) {
    fields.ownerUid = {stringValue: resolved.uid};
    if (resolved.role) fields.ownerRole = {stringValue: resolved.role};
  }
  return request(endpoint(path),token,"PATCH",{fields});
}
export async function removeRecord(path, token) {
  if (!enabled()) return blobRemove(path);
  if (useAdmin()) return adminRemove(path);
  return request(endpoint(path),token,"DELETE");
}
export async function listRecords(prefix, token) {
  if (!enabled()) return blobList(prefix);
  if (useAdmin()) return adminList(prefix);
  const query = {structuredQuery:{from:[{collectionId:"connectRecords"}],
    where:{fieldFilter:{field:{fieldPath:"path"},op:"GREATER_THAN_OR_EQUAL",value:{stringValue:prefix}}},
    limit:1500}};
  const result = await request(apiBase+":runQuery",token,"POST",query);
  const records = (Array.isArray(result) ? result : []).filter(x=>x.document)
    .map(x=>x.document.fields.path?.stringValue).filter(x=>typeof x==="string"&&x.startsWith(prefix))
    .map(pathname=>({pathname}));
  if (records.length >= 1500) {
    const error=new Error("Limite de registros atingido; a paginação precisa ser configurada.");error.status=503;throw error;
  }
  return records;
}
export const currentStorage = () => enabled() ? "firestore" : "blob";
