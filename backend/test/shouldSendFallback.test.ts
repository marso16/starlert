import { describe, it, expect } from "vitest";
import { shouldSendFallbackEmail } from "../src/queue/shouldSendFallback";

describe("shouldSendFallbackEmail", () => {
  it("sends when nobody has been active since the alert", () => {
    expect(shouldSendFallbackEmail([false, false])).toBe(true);
  });

  it("skips when at least one user has been active since the alert", () => {
    expect(shouldSendFallbackEmail([false, true])).toBe(false);
  });

  it("sends when there are no users to check", () => {
    expect(shouldSendFallbackEmail([])).toBe(true);
  });
});
