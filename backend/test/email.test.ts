import { describe, it, expect, vi, beforeEach } from "vitest";

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
  beforeEach(() => {
    sendMock.mockResolvedValue({ data: { id: "test" }, error: null });
  });

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

  it("throws an error when magic link email send fails", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid domain" },
    });

    const client = createEmailClient("test-key", "alerts@example.com");
    await expect(
      client.sendMagicLinkEmail("owner@acme.com", "https://app.example.com/auth/verify?token=abc")
    ).rejects.toThrow("Failed to send magic link email");
  });

  it("throws an error when alert fallback email send fails", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Rate limit exceeded" },
    });

    const client = createEmailClient("test-key", "alerts@example.com");
    await expect(
      client.sendAlertFallbackEmail("owner@acme.com", {
        rating: 3,
        text: "Good service",
        author: "Bob",
      })
    ).rejects.toThrow("Failed to send alert fallback email");
  });
});
