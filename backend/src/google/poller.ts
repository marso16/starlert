import "dotenv/config";
import { db } from "../db/client";
import { httpGoogleReviewsClient } from "./reviewsClient";
import { runSyncForAllTenants } from "./sync";
import { publishAlert } from "../realtime/publish";
import { enqueueEmailFallback } from "../queue/emailFallbackQueue";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15 * 60 * 1000);
const NEGATIVE_THRESHOLD = Number(process.env.NEGATIVE_REVIEW_THRESHOLD ?? 3);

async function tick(): Promise<void> {
  await runSyncForAllTenants({
    db,
    reviewsClient: httpGoogleReviewsClient,
    negativeThreshold: NEGATIVE_THRESHOLD,
    onAlertCreated: (alert) => {
      // Publishing and enqueueing are best effort: a Redis outage must not
      // crash the poller, since the alert row itself is already durably
      // stored and can still be delivered once Redis recovers.
      publishAlert(alert).catch((error) => console.error("Failed to publish real-time alert:", error));
      enqueueEmailFallback(alert).catch((error) => console.error("Failed to enqueue email fallback:", error));
    },
  });
}

tick();
setInterval(tick, POLL_INTERVAL_MS);
