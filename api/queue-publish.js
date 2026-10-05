import { handleCallback } from "@vercel/queue";
import { processScheduledPublish } from "./_lib/scheduled-publish.js";

export default handleCallback(
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
