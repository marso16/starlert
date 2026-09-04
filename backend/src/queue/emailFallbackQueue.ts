import { Queue } from "bullmq";
import { createQueueConnection } from "./connection";
import type { AlertCreatedPayload } from "../google/sync";

export interface EmailFallbackJobData {
  alertId: string;
  tenantId: string;
  reviewId: string;
  createdAt: string;
}

const EMAIL_FALLBACK_DELAY_MS = Number(process.env.EMAIL_FALLBACK_DELAY_MS ?? 25 * 60 * 1000);

export const emailFallbackQueue = new Queue<EmailFallbackJobData>("email-fallback", {
  connection: createQueueConnection(),
});

export async function enqueueEmailFallback(
  alert: Pick<AlertCreatedPayload, "id" | "tenantId" | "reviewId" | "createdAt">
): Promise<void> {
  await emailFallbackQueue.add(
    "send-fallback-email",
    {
      alertId: alert.id,
      tenantId: alert.tenantId,
      reviewId: alert.reviewId,
      createdAt: alert.createdAt.toISOString(),
    },
    { delay: EMAIL_FALLBACK_DELAY_MS }
  );
}
