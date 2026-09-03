import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { createLoginToken, verifyLoginToken } from "../../auth/magicLink";
import { createSessionCookie, SESSION_COOKIE_NAME } from "../../auth/session";
import { emailClient } from "../../email/client";

export const authRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

authRouter.post("/request-link", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (user) {
    const { token } = createLoginToken(user.id);
    const loginUrl = `${FRONTEND_URL}/auth/verify?token=${token}`;
    // Fire and forget: do not await the send. Awaiting it here would make a
    // registered email measurably slower to respond than an unregistered one
    // (a response-timing side channel), and would turn a Resend failure into
    // a 500 on this branch only, both of which defeat the "identical response
    // regardless of registration" guarantee below.
    emailClient.sendMagicLinkEmail(email, loginUrl).catch((error) => {
      console.error("Failed to send magic link email", error);
    });
  }

  // Always respond the same way whether or not the email is registered,
  // so this endpoint cannot be used to enumerate customer accounts.
  res.json({ ok: true });
});

authRouter.get("/verify", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifyLoginToken(token) : null;
  if (!session) {
    res.status(400).json({ error: "Invalid or expired link" });
    return;
  }

  res.cookie(SESSION_COOKIE_NAME, createSessionCookie(session), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
  res.json({ ok: true });
});
