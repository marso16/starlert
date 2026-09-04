import { describe, it, expect, vi, afterEach } from "vitest";
import { createSessionCookie, verifySessionCookie } from "../src/auth/session";

afterEach(() => vi.useRealTimers());

describe("session cookie", () => {
  it("round trips a valid session", () => {
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    const session = verifySessionCookie(cookie);
    expect(session).toMatchObject({ userId: "u1", tenantId: "t1" });
  });

  it("rejects a tampered cookie", () => {
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    expect(verifySessionCookie(tampered)).toBeNull();
  });

  it("rejects an expired session", () => {
    vi.useFakeTimers();
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(verifySessionCookie(cookie)).toBeNull();
  });
});
