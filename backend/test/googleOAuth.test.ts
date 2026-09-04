import { describe, it, expect, vi } from "vitest";

const generateAuthUrlMock = vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/mock");
const getTokenMock = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return {
      generateAuthUrl: generateAuthUrlMock,
      getToken: getTokenMock,
    };
  }),
}));

import { buildAuthUrl, exchangeCodeForTokens } from "../src/google/oauth";

describe("google oauth", () => {
  it("builds an auth url requesting the business.manage scope with the given state", () => {
    const url = buildAuthUrl("tenant-123");
    expect(url).toBe("https://accounts.google.com/o/oauth2/mock");
    expect(generateAuthUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: ["https://www.googleapis.com/auth/business.manage"],
        state: "tenant-123",
      })
    );
  });

  it("throws when Google does not return a refresh token", async () => {
    getTokenMock.mockResolvedValueOnce({ tokens: {} });
    await expect(exchangeCodeForTokens("some-code")).rejects.toThrow(/refresh token/);
  });
});
