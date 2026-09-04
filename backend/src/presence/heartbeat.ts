import { eq } from "drizzle-orm";
import { db } from "../db/client";
import * as schema from "../db/schema";

export function recordHeartbeat(userId: string): void {
  const now = new Date();
  const existing = db.select().from(schema.presence).where(eq(schema.presence.userId, userId)).get();
  if (existing) {
    db.update(schema.presence).set({ lastSeenAt: now }).where(eq(schema.presence.userId, userId)).run();
  } else {
    db.insert(schema.presence).values({ userId, lastSeenAt: now }).run();
  }
}

export function wasActiveSince(userId: string, since: Date): boolean {
  const row = db.select().from(schema.presence).where(eq(schema.presence.userId, userId)).get();
  return row ? row.lastSeenAt.getTime() >= since.getTime() : false;
}
