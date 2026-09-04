import { OAuth2Client } from "google-auth-library";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/business.manage";

function createOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URL
  );
}

export function buildAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [REQUIRED_SCOPE],
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. The owner may need to revoke prior access at myaccount.google.com/permissions and reconnect."
    );
  }
  return { refreshToken: tokens.refresh_token };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain an access token from the stored refresh token");
  }
  return token;
}
