import { readJson as blobRead, writeJson as blobWrite, removeJson as blobRemove, listJson as blobList } from "./blob-store.js";

const projectId = "leadspay-connect";
const apiBase = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents";
const enabled = () => process.env.CONNECT_STORAGE_BACKEND === "firestore";
const idFor = path => Buffer.from(path, "utf8").toString("base64url");
const endpoint = path => apiBase + "/connectRecords/" + encodeURIComponent(idFor(path));

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
// The old Blob records remain untouched. Explicit cutover is required after a verified migration.
export async function readRecord(path, token) {
  if (!enabled()) return blobRead(path);
  const doc = await request(endpoint(path),token);
  return doc ? JSON.parse(doc.fields.json.stringValue) : null;
}
export async function writeRecord(path, data, token) {
  if (!enabled()) return blobWrite(path,data);
  return request(endpoint(path),token,"PATCH",{fields:{
    path:{stringValue:path},
    json:{stringValue:JSON.stringify(data)},
    updatedAt:{timestampValue:new Date().toISOString()}
  }});
}
export async function removeRecord(path, token) {
  if (!enabled()) return blobRemove(path);
  return request(endpoint(path),token,"DELETE");
}
export async function listRecords(prefix, token) {
  if (!enabled()) return blobList(prefix);
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
