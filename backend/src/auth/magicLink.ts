import { randomUUID, createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import * as schema from "../db/schema";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createLoginToken(userId: string): { token: string; expiresAt: Date } {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  db.insert(schema.loginTokens)
    .values({ id: randomUUID(), userId, tokenHash: hashToken(token), expiresAt, usedAt: null })
    .run();
  return { token, expiresAt };
}

export function verifyLoginToken(token: string): { userId: string; tenantId: string } | null {
  const now = new Date();
  const tokenRow = db
    .select({ id: schema.loginTokens.id, userId: schema.loginTokens.userId })
    .from(schema.loginTokens)
    .where(
      and(
        eq(schema.loginTokens.tokenHash, hashToken(token)),
        isNull(schema.loginTokens.usedAt),
        gt(schema.loginTokens.expiresAt, now)
      )
    )
    .get();

  if (!tokenRow) return null;

  db.update(schema.loginTokens).set({ usedAt: now }).where(eq(schema.loginTokens.id, tokenRow.id)).run();

  const user = db.select().from(schema.users).where(eq(schema.users.id, tokenRow.userId)).get();
  if (!user) return null;

  return { userId: user.id, tenantId: user.tenantId };
}
