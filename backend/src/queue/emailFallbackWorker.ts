import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createQueueConnection } from "./connection";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { wasActiveSince } from "../presence/heartbeat";
import { shouldSendFallbackEmail } from "./shouldSendFallback";
import { emailClient } from "../email/client";
import type { EmailFallbackJobData } from "./emailFallbackQueue";

export function startEmailFallbackWorker(): Worker<EmailFallbackJobData> {
  return new Worker<EmailFallbackJobData>(
    "email-fallback",
    async (job) => {
      const { alertId, tenantId, reviewId, createdAt } = job.data;
      const alertCreatedAt = new Date(createdAt);

      const tenantUsers = db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.tenantId, tenantId))
        .all();

      const activeFlags = tenantUsers.map((user) => wasActiveSince(user.id, alertCreatedAt));
      if (!shouldSendFallbackEmail(activeFlags)) return;

      const review = db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).get();
      if (!review) return;

      for (const user of tenantUsers) {
        await emailClient.sendAlertFallbackEmail(user.email, {
          rating: review.rating,
          text: review.text,
          author: review.author,
        });
      }

      db.update(schema.alerts).set({ deliveredEmailAt: new Date() }).where(eq(schema.alerts.id, alertId)).run();
    },
    { connection: createQueueConnection() }
  );
}

if (require.main === module) {
  startEmailFallbackWorker();
  console.log("Email fallback worker started");
}
