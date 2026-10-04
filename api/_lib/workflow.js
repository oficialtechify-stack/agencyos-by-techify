import crypto from "node:crypto";
import { readJson, removeJson, writeJson } from "./blob-store.js";

export function publicProject(project) {
  const p = project || {};
  return {
    id: String(p.id || ""),
    title: String(p.title || ""),
    platform: String(p.platform || ""),
    format: String(p.format || ""),
    campaign: String(p.campaign || ""),
    caption: String(p.caption || ""),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    assets: Array.isArray(p.assets)
      ? p.assets
          .map((a, index) => ({
            id: String(a && a.id ? a.id : ""),
            name: String(a && a.name ? a.name : ""),
            type: String(a && a.type ? a.type : ""),
            url: a && a.url ? String(a.url) : "",
            order: Number.isFinite(Number(a && a.order)) ? Number(a.order) : index,
          }))
          .sort((a, b) => a.order - b.order)
      : [],
  };
}

export function fingerprintProject(project) {
  const p = publicProject(project);
  const protectedContent = {
    id: p.id,
    platform: p.platform,
    format: p.format,
    caption: p.caption,
    assets: p.assets.map((a) => ({ url: a.url, type: a.type, order: a.order })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(protectedContent)).digest("hex");
}

export const approvalPath = (id) => "workflow/approvals/" + encodeURIComponent(id) + ".json";
export const schedulePath = (id) => "workflow/schedules/" + encodeURIComponent(id) + ".json";
export const publicationPath = (id) => "workflow/publications/" + encodeURIComponent(id) + ".json";

export async function getApproval(projectId) {
  return readJson(approvalPath(projectId));
}

export async function approveProject(project, user) {
  const clean = publicProject(project);
  if (!clean.id) throw Object.assign(new Error("Conteúdo inválido."), { status: 400 });
  const record = {
    projectId: clean.id,
    fingerprint: fingerprintProject(clean),
    approvedAt: new Date().toISOString(),
    approvedBy: user.email,
    approvedByName: user.name,
  };
  await writeJson(approvalPath(clean.id), record);
  await removeJson(schedulePath(clean.id));
  return record;
}

export async function invalidateApproval(projectId) {
  await Promise.all([removeJson(approvalPath(projectId)), removeJson(schedulePath(projectId))]);
}

export async function assertApproved(project) {
  const clean = publicProject(project);
  const approval = await getApproval(clean.id);
  if (!approval) throw Object.assign(new Error("Este conteúdo ainda não foi aprovado pelo administrador."), { status: 409 });
  const current = fingerprintProject(clean);
  if (approval.fingerprint !== current) {
    await invalidateApproval(clean.id);
    throw Object.assign(new Error("O conteúdo mudou depois da aprovação. Envie novamente para aprovação."), { status: 409 });
  }
  return { clean, approval, fingerprint: current };
}
