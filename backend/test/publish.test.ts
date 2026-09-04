import { describe, it, expect, vi } from "vitest";

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn().mockResolvedValue(1) }));

vi.mock("../src/realtime/redis", async () => {
  const actual = await vi.importActual<typeof import("../src/realtime/redis")>("../src/realtime/redis");
  return { ...actual, redisPublisher: { publish: publishMock } };
});

import { publishAlert } from "../src/realtime/publish";
import { alertChannel } from "../src/realtime/redis";

describe("publishAlert", () => {
  it("publishes the alert as JSON on the tenant's channel", async () => {
    await publishAlert({
      id: "alert-1",
      tenantId: "tenant-1",
      reviewId: "review-1",
      rating: 2,
      text: "Not happy",
      author: "Jane",
      reviewTime: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(publishMock).toHaveBeenCalledWith(
      alertChannel("tenant-1"),
      JSON.stringify({
        id: "alert-1",
        reviewId: "review-1",
        rating: 2,
        text: "Not happy",
        author: "Jane",
        reviewTime: "2026-01-01T00:00:00.000Z",
      })
    );
  });
});
