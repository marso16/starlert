import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
});

export const loginTokens = sqliteTable("login_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
});

export const googleConnections = sqliteTable("google_connections", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id),
  refreshToken: text("refresh_token").notNull(),
  gbpLocationId: text("gbp_location_id").notNull().default(""),
  connectedAt: integer("connected_at", { mode: "timestamp" }).notNull(),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  status: text("status", { enum: ["connected", "needs_reconnect"] })
    .notNull()
    .default("connected"),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    externalReviewId: text("external_review_id").notNull(),
    rating: integer("rating").notNull(),
    text: text("text"),
    author: text("author"),
    reviewTime: integer("review_time", { mode: "timestamp" }).notNull(),
    replied: integer("replied", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    tenantExternalIdx: uniqueIndex("reviews_tenant_external_unique").on(
      table.tenantId,
      table.externalReviewId
    ),
  })
);

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  deliveredRealtimeAt: integer("delivered_realtime_at", { mode: "timestamp" }),
  deliveredEmailAt: integer("delivered_email_at", { mode: "timestamp" }),
});

export const presence = sqliteTable("presence", {
  userId: text("user_id").primaryKey().references(() => users.id),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
});
