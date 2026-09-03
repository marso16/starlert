import { describe, it, expect, vi } from "vitest";

const { sendMock } = vi.hoisted(() => {
  return {
    sendMock: vi.fn().mockResolvedValue({ data: { id: "test" }, error: null }),
  };
});

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function() {
    return {
      emails: { send: sendMock },
    };
  }),
}));

import { createEmailClient } from "../src/email/client";

describe("email client", () => {
  it("sends a magic link email containing the login url", async () => {
    const client = createEmailClient("test-key", "alerts@example.com");
    await client.sendMagicLinkEmail("owner@acme.com", "https://app.example.com/auth/verify?token=abc");

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@acme.com", from: "alerts@example.com" })
    );
    expect(sendMock.mock.calls[0][0].html).toContain(
      "https://app.example.com/auth/verify?token=abc"
    );
  });

  it("sends an alert fallback email describing the review", async () => {
    const client = createEmailClient("test-key", "alerts@example.com");
    await client.sendAlertFallbackEmail("owner@acme.com", {
      rating: 1,
      text: "Terrible service",
      author: "Jane",
    });

    const call = sendMock.mock.calls.at(-1)?.[0];
    expect(call.subject).toContain("1 star");
    expect(call.html).toContain("Terrible service");
  });
});
