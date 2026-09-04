import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import type { GoogleReviewsClient } from "../src/google/reviewsClient";

vi.mock("../src/google/oauth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
}));

import { getAccessToken } from "../src/google/oauth";
import { syncTenantReviews, runSyncForAllTenants } from "../src/google/sync";

function makeTenantWithConnection() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Test Business", notes: null, createdAt: new Date() }).run();
  db.insert(schema.googleConnections)
    .values({
      tenantId,
      refreshToken: "fake-refresh-token",
      gbpLocationId: "accounts/1/locations/1",
      connectedAt: new Date(),
      status: "connected",
    })
    .run();
  return tenantId;
}

describe("syncTenantReviews", () => {
  it("stores new reviews and creates an alert only for ratings at or below the threshold", async () => {
    const tenantId = makeTenantWithConnection();
    const onAlertCreated = vi.fn();
    const reviewsClient: GoogleReviewsClient = {
      listReviews: vi.fn().mockResolvedValue([
        { externalReviewId: "r1", rating: 2, text: "Not great", author: "Jane", reviewTime: new Date() },
        { externalReviewId: "r2", rating: 5, text: "Loved it", author: "Sam", reviewTime: new Date() },
      ]),
    };

    const result = await syncTenantReviews(
      { db, reviewsClient, negativeThreshold: 3, onAlertCreated },
      { tenantId, refreshToken: "fake-refresh-token", gbpLocationId: "accounts/1/locations/1" }
    );

    expect(result).toEqual({ newReviews: 2, newAlerts: 1 });
    expect(onAlertCreated).toHaveBeenCalledTimes(1);
    expect(onAlertCreated).toHaveBeenCalledWith(expect.objectContaining({ tenantId, rating: 2 }));

    const alerts = db.select().from(schema.alerts).where(eq(schema.alerts.tenantId, tenantId)).all();
    expect(alerts).toHaveLength(1);
  });

  it("does not duplicate reviews or alerts on a second sync of the same data", async () => {
    const tenantId = makeTenantWithConnection();
    const reviewsClient: GoogleReviewsClient = {
      listReviews: vi.fn().mockResolvedValue([
        { externalReviewId: "r1", rating: 1, text: "Bad", author: "Jane", reviewTime: new Date() },
      ]),
    };
    const deps = { db, reviewsClient, negativeThreshold: 3 };
    const connection = { tenantId, refreshToken: "fake-refresh-token", gbpLocationId: "accounts/1/locations/1" };

    await syncTenantReviews(deps, connection);
    const secondRun = await syncTenantReviews(deps, connection);

    expect(secondRun).toEqual({ newReviews: 0, newAlerts: 0 });
    const alerts = db.select().from(schema.alerts).where(eq(schema.alerts.tenantId, tenantId)).all();
    expect(alerts).toHaveLength(1);
  });
});

describe("runSyncForAllTenants", () => {
  it("marks a connection needs_reconnect when the access token fetch fails", async () => {
    const tenantId = makeTenantWithConnection();
    vi.mocked(getAccessToken).mockRejectedValueOnce(new Error("invalid_grant: access token expired"));

    await runSyncForAllTenants({ db, reviewsClient: { listReviews: vi.fn() }, negativeThreshold: 3 });

    const connection = db
      .select()
      .from(schema.googleConnections)
      .where(eq(schema.googleConnections.tenantId, tenantId))
      .get();
    expect(connection?.status).toBe("needs_reconnect");
  });
});
