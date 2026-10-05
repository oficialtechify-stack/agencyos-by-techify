import { handleCallback } from "@vercel/queue";
import { processScheduledPublish } from "./_lib/scheduled-publish.js";

export const config = { api: { bodyParser: false } };

const queueCallback = handleCallback(
  async (message, metadata) => {
    const result = await processScheduledPublish(message);
    console.log("scheduled_publish_queue", JSON.stringify({
      messageId: metadata?.messageId,
      deliveryCount: metadata?.deliveryCount,
      result
    }));
  },
  {
    visibilityTimeoutSeconds: 120,
    retry: (error, metadata) => {
      const count = Number(metadata?.deliveryCount || 1);
      if (count >= 8) return { acknowledge: true };
      return { afterSeconds: Math.min(900, Math.max(30, 30 * (2 ** Math.min(count - 1, 5)))) };
    }
  }
);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    const rawBody = await readRawBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, String(item));
      } else if (value !== undefined) {
        headers.set(key, String(value));
      }
    }

    const host = req.headers?.host || "leadspay-connect.vercel.app";
    const protocol = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    const url = protocol + "://" + host + (req.url || "/api/queue-publish");

    const webRequest = new Request(url, {
      method: req.method || "POST",
      headers,
      body: rawBody.length ? rawBody : undefined
    });

    const response = await queueCallback(webRequest);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buffer = Buffer.from(await response.arrayBuffer());
    return res.end(buffer);
  } catch (error) {
    console.error("Queue adapter error", error);
    return res.status(500).json({ ok: false, error: "queue_adapter_error" });
  }
}
