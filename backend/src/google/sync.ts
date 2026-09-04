import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import type { GoogleReviewsClient } from "./reviewsClient";
import { getAccessToken } from "./oauth";

export interface AlertCreatedPayload {
  id: string;
  tenantId: string;
  reviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: Date;
  createdAt: Date;
}

export interface SyncDeps {
  db: BetterSQLite3Database<typeof schema>;
  reviewsClient: GoogleReviewsClient;
  negativeThreshold: number;
  onAlertCreated?: (payload: AlertCreatedPayload) => void;
}

export async function syncTenantReviews(
  deps: SyncDeps,
  connection: { tenantId: string; refreshToken: string; gbpLocationId: string }
): Promise<{ newReviews: number; newAlerts: number }> {
  const accessToken = await getAccessToken(connection.refreshToken);
  const googleReviews = await deps.reviewsClient.listReviews({
    accessToken,
    gbpLocationId: connection.gbpLocationId,
  });

  let newReviews = 0;
  let newAlerts = 0;

  for (const review of googleReviews) {
    const existing = deps.db
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.tenantId, connection.tenantId),
          eq(schema.reviews.externalReviewId, review.externalReviewId)
        )
      )
      .get();
    if (existing) continue;

    const reviewId = randomUUID();
    deps.db
      .insert(schema.reviews)
      .values({
        id: reviewId,
        tenantId: connection.tenantId,
        externalReviewId: review.externalReviewId,
        rating: review.rating,
        text: review.text,
        author: review.author,
        reviewTime: review.reviewTime,
        replied: false,
      })
      .run();
    newReviews += 1;

    if (review.rating <= deps.negativeThreshold) {
      const alertId = randomUUID();
      const createdAt = new Date();
      deps.db
        .insert(schema.alerts)
        .values({ id: alertId, tenantId: connection.tenantId, reviewId, createdAt })
        .run();
      newAlerts += 1;
      deps.onAlertCreated?.({
        id: alertId,
        tenantId: connection.tenantId,
        reviewId,
        rating: review.rating,
        text: review.text,
        author: review.author,
        reviewTime: review.reviewTime,
        createdAt,
      });
    }
  }

  deps.db
    .update(schema.googleConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(schema.googleConnections.tenantId, connection.tenantId))
    .run();

  return { newReviews, newAlerts };
}

export async function runSyncForAllTenants(deps: SyncDeps): Promise<void> {
  const connections = deps.db
    .select()
    .from(schema.googleConnections)
    .where(and(eq(schema.googleConnections.status, "connected"), ne(schema.googleConnections.gbpLocationId, "")))
    .all();

  for (const connection of connections) {
    try {
      await syncTenantReviews(deps, connection);
    } catch (error) {
      console.error(`Sync failed for tenant ${connection.tenantId}:`, error);
      deps.db
        .update(schema.googleConnections)
        .set({ status: "needs_reconnect" })
        .where(eq(schema.googleConnections.tenantId, connection.tenantId))
        .run();
    }
  }
}
