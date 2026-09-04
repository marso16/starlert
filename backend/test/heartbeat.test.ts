import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { recordHeartbeat, wasActiveSince } from "../src/presence/heartbeat";

function makeUser() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Acme", notes: null, createdAt: new Date() }).run();
  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: "owner@acme.com" }).run();
  return userId;
}

describe("presence heartbeat", () => {
  it("reports active when the heartbeat is after the given time", () => {
    const userId = makeUser();
    const before = new Date(Date.now() - 1000);
    recordHeartbeat(userId);
    expect(wasActiveSince(userId, before)).toBe(true);
  });

  it("reports inactive when there is no heartbeat row", () => {
    const userId = makeUser();
    expect(wasActiveSince(userId, new Date())).toBe(false);
  });
});
