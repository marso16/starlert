import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLoginToken, verifyLoginToken } from "../src/auth/magicLink";

function makeUser() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Acme", notes: null, createdAt: new Date() }).run();
  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: "owner@acme.com" }).run();
  return { tenantId, userId };
}

afterEach(() => vi.useRealTimers());

describe("magic link tokens", () => {
  it("verifies a freshly created token and returns the user's tenant", () => {
    const { tenantId, userId } = makeUser();
    const { token } = createLoginToken(userId);

    const result = verifyLoginToken(token);

    expect(result).toEqual({ userId, tenantId });
  });

  it("rejects a token that has already been used", () => {
    const { userId } = makeUser();
    const { token } = createLoginToken(userId);

    verifyLoginToken(token);
    const secondAttempt = verifyLoginToken(token);

    expect(secondAttempt).toBeNull();
  });

  it("rejects an unknown token", () => {
    expect(verifyLoginToken("not-a-real-token")).toBeNull();
  });

  it("rejects a token that has expired", () => {
    const { userId } = makeUser();
    vi.useFakeTimers();
    const { token } = createLoginToken(userId);
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(verifyLoginToken(token)).toBeNull();
  });
});
