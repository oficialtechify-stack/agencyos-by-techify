import { send } from "@vercel/queue";
import { readJson, removeJson, writeJson } from "./blob-store.js";
import { approvalPath, fingerprintProject, publicationPath, schedulePath } from "./workflow.js";
import { publishInstagram } from "./meta.js";
import { sendTeamPush } from "./push.js";

export const SCHEDULE_TOPIC = "instagram-scheduled-publish";
const MAX_DELAY_SECONDS = 23 * 60 * 60; // stay below the queue retention window
const RETENTION_SECONDS = 24 * 60 * 60;

export async function enqueueScheduledPublish(job, hop = 0) {
  const scheduledMs = new Date(job.scheduledAt).getTime();
  if (!Number.isFinite(scheduledMs)) throw Object.assign(new Error("Data de agendamento inválida."), { status: 400 });

  const remainingSeconds = Math.max(0, Math.ceil((scheduledMs - Date.now()) / 1000));
  const delaySeconds = Math.min(remainingSeconds, MAX_DELAY_SECONDS);
  const idempotencyKey = [
    "leadspay",
    job.projectId,
    job.fingerprint.slice(0, 20),
    new Date(job.scheduledAt).getTime(),
    hop
  ].join(":");

  const queued = await send(
    SCHEDULE_TOPIC,
    {
      projectId: job.projectId,
      scheduledAt: job.scheduledAt,
      fingerprint: job.fingerprint,
      hop
    },
    {
      delaySeconds,
      retentionSeconds: RETENTION_SECONDS,
      idempotencyKey
    }
  );

  return {
    messageId: queued.messageId,
    delaySeconds,
    hop,
    queuedAt: new Date().toISOString()
  };
}

async function updateWorkspace(projectId, patch) {
  const path = "workspace/projects/" + encodeURIComponent(projectId) + ".json";
  const current = await readJson(path);
  if (current) {
    await writeJson(path, { ...current, ...patch, updatedAt: new Date().toISOString() });
  }
}

export async function processScheduledPublish(message) {
  const projectId = String(message?.projectId || "");
  const scheduledAt = String(message?.scheduledAt || "");
  const fingerprint = String(message?.fingerprint || "");
  const hop = Number(message?.hop || 0);

  if (!projectId || !scheduledAt || !fingerprint) {
    return { status: "invalid-message" };
  }

  const job = await readJson(schedulePath(projectId));
  if (!job) return { status: "schedule-cancelled" };

  // Ignore superseded queue messages after rescheduling/editing.
  if (job.scheduledAt !== scheduledAt || job.fingerprint !== fingerprint) {
    return { status: "superseded" };
  }

  const scheduledMs = new Date(job.scheduledAt).getTime();
  if (!Number.isFinite(scheduledMs)) {
    await removeJson(schedulePath(projectId));
    await updateWorkspace(projectId, { status: "failed", scheduleError: "Data inválida", scheduledAt: null });
    return { status: "invalid-date" };
  }

  // For schedules farther than the queue delay window, chain another delayed message.
  if (scheduledMs > Date.now() + 15_000) {
    const queued = await enqueueScheduledPublish(job, hop + 1);
    await writeJson(schedulePath(projectId), { ...job, queue: queued, updatedAt: new Date().toISOString() });
    return { status: "requeued", nextDelaySeconds: queued.delaySeconds, hop: hop + 1 };
  }

  const existingPublication = await readJson(publicationPath(projectId));
  if (existingPublication) {
    await removeJson(schedulePath(projectId));
    await updateWorkspace(projectId, {
      status: "published",
      publishedAt: existingPublication.publishedAt,
      metaMediaId: existingPublication.mediaId,
      scheduledAt: null,
      scheduleError: null
    });
    return { status: "already-published", mediaId: existingPublication.mediaId };
  }

  const approval = await readJson(approvalPath(projectId));
  if (!approval || approval.fingerprint !== fingerprint || fingerprintProject(job.project) !== fingerprint) {
    await removeJson(schedulePath(projectId));
    await updateWorkspace(projectId, {
      status: "changes",
      scheduledAt: null,
      scheduleError: "A aprovação não corresponde mais ao conteúdo atual."
    });
    return { status: "approval-invalid" };
  }

  try {
    const result = await publishInstagram(job.project);
    const publication = {
      projectId,
      fingerprint,
      ...result,
      publishedBy: "scheduler",
      publishedByName: "Agendamento automático"
    };
    await writeJson(publicationPath(projectId), publication);
    await removeJson(schedulePath(projectId));
    await updateWorkspace(projectId, {
      status: "published",
      publishedAt: publication.publishedAt,
      metaMediaId: publication.mediaId,
      scheduledAt: null,
      scheduleError: null
    });

    try {
      await sendTeamPush(
        { email: "scheduler@leadspay.local", name: "LeadsPay Connect", role: "system" },
        {
          title: "Publicação realizada",
          body: (job.project?.title || "Conteúdo") + " foi publicado no Instagram.",
          url: "/?open=instagram",
          tag: "leadspay-published-" + projectId
        }
      );
    } catch {}

    return { status: "published", mediaId: result.mediaId };
  } catch (error) {
    await updateWorkspace(projectId, {
      status: "scheduled",
      scheduleError: error?.message || "Falha temporária ao publicar."
    });
    // Throw so Vercel Queue retries automatically.
    throw error;
  }
}
