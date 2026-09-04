import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "session";

export interface SessionPayload {
  userId: string;
  tenantId: string;
  expiresAt: number;
}

function sign(data: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function createSessionCookie(payload: { userId: string; tenantId: string }): string {
  const session: SessionPayload = { ...payload, expiresAt: Date.now() + SESSION_TTL_MS };
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifySessionCookie(cookieValue: string): SessionPayload | null {
  const [data, signature] = cookieValue.split(".");
  if (!data || !signature) return null;

  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const session = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
  if (session.expiresAt < Date.now()) return null;

  return session;
}
