# Review and Reputation Alert Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant dashboard that polls a business's Google reviews, alerts the owner in real time (with an email fallback) when a low-star review comes in, so it can be sold directly to local business clients.

**Architecture:** `backend/` is a standalone Node/Express service that owns the SQLite database (via Drizzle), the Google OAuth and review-sync polling job, the Redis-backed real-time push (SSE) and BullMQ delayed email fallback, and the magic-link auth API. `frontend/` is a SvelteKit app that is a pure client: it talks to `backend/` only over HTTP and SSE, proxied under `/api` so cookies stay same-site.

**Tech Stack:** Node.js, TypeScript, Express, Drizzle ORM, better-sqlite3, ioredis, BullMQ, Resend, google-auth-library, SvelteKit 5 (runes), Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-03-review-alert-dashboard-design.md`

## Global Constraints

- No em dashes anywhere: not in code, comments, commit messages, UI copy, or docs. Use a comma, colon, parentheses, or a new sentence instead.
- Frontend UI must not be generic, cookie-cutter Tailwind styling. This plan uses plain, deliberate CSS with a distinct visual identity rather than a default component-library look.
- `backend/` and `frontend/` are one project, one git repository. Commit after each task from the repo root.
- `backend/` is the only thing that talks to the SQLite database. `frontend/` never imports Drizzle or opens the database file.
- Star threshold for a negative review defaults to 3 or below; poll interval defaults to 15 minutes. Both are global env-configured values in v1, not per-tenant columns (per the spec's deferred "Open questions").
- Every backend route that returns tenant data must scope its query by `tenant_id` from the authenticated session, never trust a client-supplied tenant id.

---

## File Structure

```
backend/
  drizzle.config.ts
  tsconfig.json
  vitest.config.ts
  drizzle/                        (generated SQL migrations)
  src/
    db/
      schema.ts                   Drizzle table definitions
      client.ts                   better-sqlite3 + drizzle singleton
      migrate.ts                  applies migrations (run once at deploy)
    email/
      client.ts                   Resend wrapper, injectable for tests
    auth/
      magicLink.ts                token create/verify
      session.ts                  signed session cookie create/verify
    google/
      oauth.ts                    OAuth2 client, auth URL, token exchange
      reviewsClient.ts             GoogleReviewsClient interface + http impl
      sync.ts                      core sync/dedup/threshold/alert logic
      poller.ts                    long-running poll loop entrypoint
    realtime/
      redis.ts                    ioredis publisher/subscriber factories
      publish.ts                  publishAlert helper
    queue/
      connection.ts                ioredis connection for BullMQ
      emailFallbackQueue.ts         producer: enqueueEmailFallback
      emailFallbackWorker.ts        worker entrypoint + decision logic
    presence/
      heartbeat.ts                 recordHeartbeat / wasActiveSince
    api/
      middleware/
        requireAuth.ts
      routes/
        auth.ts
        google.ts
        reviews.ts
        presence.ts
        realtime.ts
    app.ts                        creates the Express app (no listen)
    server.ts                     entrypoint: app.listen
  scripts/
    createTenant.ts                manual onboarding
    setGbpLocation.ts               manual admin: attach a GBP location id
  test/
    setup.ts
    db.test.ts
    email.test.ts
    magicLink.test.ts
    session.test.ts
    googleOAuth.test.ts
    sync.test.ts
    heartbeat.test.ts
    emailFallbackDecision.test.ts
    createTenant.test.ts
    app.test.ts

frontend/
  vite.config.ts                  adds /api dev proxy
  src/
    lib/
      api.ts                      fetch wrapper + ReviewAlert type
      sse.ts                      subscribeToAlerts
      presence.ts                 startPresenceHeartbeat
      sound.ts                    playAlertSound
    routes/
      login/+page.svelte
      auth/verify/+page.svelte
      dashboard/+page.svelte
```

---

### Task 1: Backend scaffold, schema, and database client

**Files:**
- Modify: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/drizzle.config.ts`
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/client.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/vitest.config.ts`
- Create: `backend/test/setup.ts`
- Test: `backend/test/db.test.ts`
- Remove: `backend/app.js` (empty placeholder from initial scaffold, replaced by `src/server.ts` in Task 9)

**Interfaces:**
- Produces: `schema.tenants`, `schema.users`, `schema.loginTokens`, `schema.googleConnections`, `schema.reviews`, `schema.alerts`, `schema.presence` (Drizzle sqlite-core tables). `db: BetterSQLite3Database<typeof schema>` (singleton, from `db/client.ts`). `createDb(path: string): { db, sqlite }`.

- [ ] **Step 1: Install dependencies**

```bash
cd backend
pnpm add express cookie-parser ioredis bullmq resend google-auth-library dotenv
pnpm add -D typescript vitest supertest @types/express @types/cookie-parser @types/supertest
```

- [ ] **Step 2: Remove the empty placeholder entrypoint and point `main` at the real one**

```bash
rm backend/app.js
```

Edit `backend/package.json`: change `"main": "app.js"` to `"main": "src/server.ts"`, and add these to `"scripts"`:

```json
"dev": "tsx watch src/server.ts",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx src/db/migrate.ts",
"test": "vitest run"
```

- [ ] **Step 3: Add `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "scripts", "test"]
}
```

- [ ] **Step 4: Write the Drizzle schema**

Create `backend/src/db/schema.ts`:

```ts
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
```

- [ ] **Step 5: Write the database client**

Create `backend/src/db/client.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDb(path: string): {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
} {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

const dbPath = process.env.DATABASE_PATH ?? "./data.sqlite";
export const { db, sqlite } = createDb(dbPath);
```

- [ ] **Step 6: Add drizzle-kit config and generate the first migration**

Create `backend/drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
```

Run:

```bash
cd backend
pnpm drizzle-kit generate
```

Expected: a new SQL file appears under `backend/drizzle/` containing `CREATE TABLE` statements for all seven tables.

- [ ] **Step 7: Write the migration runner**

Create `backend/src/db/migrate.ts`:

```ts
import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client";

migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
```

- [ ] **Step 8: Configure Vitest and a shared test setup that migrates an in-memory database**

Create `backend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
```

Create `backend/test/setup.ts`:

```ts
process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-secret";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "alerts@example.com";
process.env.FRONTEND_URL = "http://localhost:5173";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/db/client";

migrate(db, { migrationsFolder: "./drizzle" });
```

- [ ] **Step 9: Write the failing smoke test**

Create `backend/test/db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { tenants } from "../src/db/schema";

describe("db client", () => {
  it("can insert and read back a tenant", () => {
    const id = randomUUID();
    db.insert(tenants).values({ id, name: "Acme Plumbing", createdAt: new Date() }).run();

    const row = db.select().from(tenants).where(eq(tenants.id, id)).get();
    expect(row?.name).toBe("Acme Plumbing");
  });
});
```

- [ ] **Step 10: Run the test**

```bash
cd backend
pnpm test
```

Expected: PASS. This is a smoke test for the schema and migrations working together, so there is no separate "make it fail first" step here: the test failing would indicate a setup problem, not a missing feature.

- [ ] **Step 11: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/drizzle.config.ts backend/drizzle backend/vitest.config.ts backend/src/db backend/test
git rm backend/app.js
git commit -m "Add backend schema, database client, and migrations"
```

---

### Task 2: Email client

**Files:**
- Create: `backend/src/email/client.ts`
- Test: `backend/test/email.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createEmailClient(apiKey: string, fromAddress: string): EmailClient`, `emailClient: EmailClient` (singleton), `EmailClient.sendMagicLinkEmail(to: string, loginUrl: string): Promise<void>`, `EmailClient.sendAlertFallbackEmail(to: string, review: ReviewSummary): Promise<void>`, `ReviewSummary { rating: number; text: string | null; author: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/email.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "test" }, error: null });

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/email.test.ts
```

Expected: FAIL with "Cannot find module '../src/email/client'".

- [ ] **Step 3: Implement the email client**

Create `backend/src/email/client.ts`:

```ts
import { Resend } from "resend";

export interface ReviewSummary {
  rating: number;
  text: string | null;
  author: string | null;
}

export interface EmailClient {
  sendMagicLinkEmail(to: string, loginUrl: string): Promise<void>;
  sendAlertFallbackEmail(to: string, review: ReviewSummary): Promise<void>;
}

export function createEmailClient(apiKey: string, fromAddress: string): EmailClient {
  const resend = new Resend(apiKey);

  return {
    async sendMagicLinkEmail(to, loginUrl) {
      await resend.emails.send({
        from: fromAddress,
        to,
        subject: "Your login link",
        html: `<p>Click below to log in. This link expires in 15 minutes.</p><p><a href="${loginUrl}">${loginUrl}</a></p>`,
      });
    },
    async sendAlertFallbackEmail(to, review) {
      await resend.emails.send({
        from: fromAddress,
        to,
        subject: `New ${review.rating} star review needs your attention`,
        html: `<p>A new review from ${review.author ?? "a customer"} came in:</p><blockquote>${review.text ?? "(no comment left)"}</blockquote><p>Rating: ${review.rating} out of 5.</p>`,
      });
    },
  };
}

export const emailClient = createEmailClient(
  process.env.RESEND_API_KEY ?? "",
  process.env.EMAIL_FROM ?? "alerts@example.com"
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/email.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/email backend/test/email.test.ts
git commit -m "Add email client for magic link and alert fallback emails"
```

---

### Task 3: Magic-link authentication and session cookies

**Files:**
- Create: `backend/src/auth/magicLink.ts`
- Create: `backend/src/auth/session.ts`
- Create: `backend/src/api/middleware/requireAuth.ts`
- Create: `backend/src/api/routes/auth.ts`
- Test: `backend/test/magicLink.test.ts`
- Test: `backend/test/session.test.ts`

**Interfaces:**
- Consumes: `db`, `schema.users`, `schema.loginTokens` (Task 1). `emailClient` (Task 2).
- Produces: `createLoginToken(userId: string): { token: string; expiresAt: Date }`, `verifyLoginToken(token: string): { userId: string; tenantId: string } | null`, `createSessionCookie(payload: { userId: string; tenantId: string }): string`, `verifySessionCookie(cookieValue: string): { userId: string; tenantId: string; expiresAt: number } | null`, `SESSION_COOKIE_NAME: string`, `requireAuth` (Express middleware, attaches `req.auth = { userId, tenantId }`), `authRouter` (Express Router with `POST /request-link`, `GET /verify`).

- [ ] **Step 1: Write the failing magic link test**

Create `backend/test/magicLink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLoginToken, verifyLoginToken } from "../src/auth/magicLink";

function makeUser() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Acme", notes: null, createdAt: new Date() }).run();
  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: "owner@acme.com" }).run();
  return { tenantId, userId };
}

describe("magic link tokens", () => {
  it("verifies a freshly created token and returns the user's tenant", () => {
    const { tenantId, userId } = makeUser();
    const { token } = createLoginToken(userId);

    const result = verifyLoginToken(token);

    expect(result).toEqual({ userId, tenantId });
  });

  it("rejects a token that has already been used", () => {
    const { userId } = makeUser();
    const { token } = createLoginToken(userId);

    verifyLoginToken(token);
    const secondAttempt = verifyLoginToken(token);

    expect(secondAttempt).toBeNull();
  });

  it("rejects an unknown token", () => {
    expect(verifyLoginToken("not-a-real-token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/magicLink.test.ts
```

Expected: FAIL with "Cannot find module '../src/auth/magicLink'".

- [ ] **Step 3: Implement magic link tokens**

Create `backend/src/auth/magicLink.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/magicLink.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing session test**

Create `backend/test/session.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSessionCookie, verifySessionCookie } from "../src/auth/session";

afterEach(() => vi.useRealTimers());

describe("session cookie", () => {
  it("round trips a valid session", () => {
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    const session = verifySessionCookie(cookie);
    expect(session).toMatchObject({ userId: "u1", tenantId: "t1" });
  });

  it("rejects a tampered cookie", () => {
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    expect(verifySessionCookie(tampered)).toBeNull();
  });

  it("rejects an expired session", () => {
    vi.useFakeTimers();
    const cookie = createSessionCookie({ userId: "u1", tenantId: "t1" });
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(verifySessionCookie(cookie)).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/session.test.ts
```

Expected: FAIL with "Cannot find module '../src/auth/session'".

- [ ] **Step 7: Implement session cookies**

Create `backend/src/auth/session.ts`:

```ts
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
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/session.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Implement the auth middleware**

Create `backend/src/api/middleware/requireAuth.ts`:

```ts
import type { Request, Response, NextFunction } from "express";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "../../auth/session";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; tenantId: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  const session = cookieValue ? verifySessionCookie(cookieValue) : null;
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.auth = { userId: session.userId, tenantId: session.tenantId };
  next();
}
```

- [ ] **Step 10: Implement the auth routes**

Create `backend/src/api/routes/auth.ts`:

```ts
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
    await emailClient.sendMagicLinkEmail(email, loginUrl);
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
```

- [ ] **Step 11: Commit**

```bash
git add backend/src/auth backend/src/api/middleware backend/src/api/routes/auth.ts backend/test/magicLink.test.ts backend/test/session.test.ts
git commit -m "Add magic link auth, session cookies, and auth API routes"
```

---

### Task 4: Manual tenant onboarding script

**Files:**
- Create: `backend/scripts/createTenant.ts`
- Test: `backend/test/createTenant.test.ts`

**Interfaces:**
- Consumes: `db`, `schema.tenants`, `schema.users` (Task 1). `createLoginToken` (Task 3). `emailClient.sendMagicLinkEmail` (Task 2).
- Produces: `createTenantAndInvite(name: string, email: string, deps?: { sendInvite: EmailClient["sendMagicLinkEmail"] }): Promise<{ tenantId: string; userId: string }>`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/createTenant.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createTenantAndInvite } from "../scripts/createTenant";

describe("createTenantAndInvite", () => {
  it("creates a tenant and its first user, and sends an invite email", async () => {
    const sendInvite = vi.fn().mockResolvedValue(undefined);

    const { tenantId, userId } = await createTenantAndInvite("Acme Plumbing", "owner@acme.com", {
      sendInvite,
    });

    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
    expect(tenant?.name).toBe("Acme Plumbing");

    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(user?.email).toBe("owner@acme.com");

    expect(sendInvite).toHaveBeenCalledWith("owner@acme.com", expect.stringContaining("/auth/verify?token="));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/createTenant.test.ts
```

Expected: FAIL with "Cannot find module '../scripts/createTenant'".

- [ ] **Step 3: Implement the script**

Create `backend/scripts/createTenant.ts`:

```ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLoginToken } from "../src/auth/magicLink";
import { emailClient, type EmailClient } from "../src/email/client";

export async function createTenantAndInvite(
  name: string,
  email: string,
  deps: { sendInvite: EmailClient["sendMagicLinkEmail"] } = { sendInvite: emailClient.sendMagicLinkEmail }
): Promise<{ tenantId: string; userId: string }> {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name, notes: null, createdAt: new Date() }).run();

  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: email.toLowerCase() }).run();

  const { token } = createLoginToken(userId);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const loginUrl = `${frontendUrl}/auth/verify?token=${token}`;

  await deps.sendInvite(email, loginUrl);

  return { tenantId, userId };
}

if (require.main === module) {
  const [, , name, email] = process.argv;
  if (!name || !email) {
    console.error('Usage: pnpm tsx scripts/createTenant.ts "Business Name" owner@example.com');
    process.exit(1);
  }
  createTenantAndInvite(name, email)
    .then(({ tenantId }) => console.log(`Created tenant ${name} (${tenantId}) and sent login link to ${email}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/createTenant.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/createTenant.ts backend/test/createTenant.test.ts
git commit -m "Add manual tenant onboarding script"
```

---

### Task 5: Google OAuth connection

**Files:**
- Create: `backend/src/google/oauth.ts`
- Create: `backend/src/api/routes/google.ts`
- Create: `backend/scripts/setGbpLocation.ts`
- Test: `backend/test/googleOAuth.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 3). `db`, `schema.googleConnections` (Task 1).
- Produces: `buildAuthUrl(state: string): string`, `exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }>`, `getAccessToken(refreshToken: string): Promise<string>`, `googleRouter` (Express Router with `GET /connect`, `GET /status`, `GET /callback`).

- [ ] **Step 1: Write the failing test**

Create `backend/test/googleOAuth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const generateAuthUrlMock = vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/mock");
const getTokenMock = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    generateAuthUrl: generateAuthUrlMock,
    getToken: getTokenMock,
  })),
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/googleOAuth.test.ts
```

Expected: FAIL with "Cannot find module '../src/google/oauth'".

- [ ] **Step 3: Implement the OAuth client**

Create `backend/src/google/oauth.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/googleOAuth.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Implement the connect/callback routes**

Create `backend/src/api/routes/google.ts`:

```ts
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { requireAuth } from "../middleware/requireAuth";
import { buildAuthUrl, exchangeCodeForTokens } from "../../google/oauth";

export const googleRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

googleRouter.get("/connect", requireAuth, (req, res) => {
  res.redirect(buildAuthUrl(req.auth!.tenantId));
});

googleRouter.get("/status", requireAuth, (req, res) => {
  const connection = db
    .select({ status: schema.googleConnections.status })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, req.auth!.tenantId))
    .get();

  res.json({ status: connection?.status ?? "not_connected" });
});

googleRouter.get("/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const tenantId = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !tenantId) {
    res.status(400).send("Missing code or state");
    return;
  }

  const { refreshToken } = await exchangeCodeForTokens(code);

  const existing = db
    .select()
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, tenantId))
    .get();

  if (existing) {
    db.update(schema.googleConnections)
      .set({ refreshToken, status: "connected", connectedAt: new Date() })
      .where(eq(schema.googleConnections.tenantId, tenantId))
      .run();
  } else {
    db.insert(schema.googleConnections)
      .values({ tenantId, refreshToken, gbpLocationId: "", connectedAt: new Date(), status: "connected" })
      .run();
  }

  res.redirect(`${FRONTEND_URL}/dashboard?google=connected`);
});
```

Note: the Business Profile location id is not discovered automatically in v1. Onboarding is already a manual, operator-driven process (per the spec), so after a tenant connects, you look up their location id and attach it with the script from the next step. This avoids building a full account/location picker UI for a handful of clients.

- [ ] **Step 6: Implement the location-attaching admin script**

Create `backend/scripts/setGbpLocation.ts`:

```ts
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";

const [, , tenantId, gbpLocationId] = process.argv;

if (!tenantId || !gbpLocationId) {
  console.error("Usage: pnpm tsx scripts/setGbpLocation.ts <tenantId> <accounts/*/locations/*>");
  process.exit(1);
}

const result = db
  .update(schema.googleConnections)
  .set({ gbpLocationId })
  .where(eq(schema.googleConnections.tenantId, tenantId))
  .run();

if (result.changes === 0) {
  console.error(`No google_connections row found for tenant ${tenantId}. Connect Google for that tenant first.`);
  process.exit(1);
}

console.log(`Set gbpLocationId for tenant ${tenantId}`);
```

- [ ] **Step 7: Manual verification**

This flow needs real Google OAuth credentials, so it is verified manually rather than by an automated test:

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL` in `backend/.env` from a Google Cloud OAuth client with the Business Profile API enabled.
2. Start the backend (available after Task 9), log in as a tenant user, visit `/api/google/connect`.
3. Confirm it redirects to a real Google consent screen requesting the Business Profile scope.
4. After granting access, confirm it redirects to `${FRONTEND_URL}/dashboard?google=connected` and a row now exists in `google_connections` with `status = 'connected'`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/google/oauth.ts backend/src/api/routes/google.ts backend/scripts/setGbpLocation.ts backend/test/googleOAuth.test.ts
git commit -m "Add Google OAuth connection flow and location admin script"
```

---

### Task 6: Google review sync core logic

**Files:**
- Create: `backend/src/google/reviewsClient.ts`
- Create: `backend/src/google/sync.ts`
- Test: `backend/test/sync.test.ts`

**Interfaces:**
- Consumes: `db`, `schema.reviews`, `schema.alerts`, `schema.googleConnections` (Task 1). `getAccessToken` (Task 5).
- Produces: `GoogleReview { externalReviewId, rating, text, author, reviewTime }`, `GoogleReviewsClient.listReviews(params: { accessToken: string; gbpLocationId: string }): Promise<GoogleReview[]>`, `httpGoogleReviewsClient: GoogleReviewsClient`, `AlertCreatedPayload { id, tenantId, reviewId, rating, text, author, reviewTime, createdAt }`, `SyncDeps { db, reviewsClient, negativeThreshold, onAlertCreated?(payload: AlertCreatedPayload): void }`, `syncTenantReviews(deps: SyncDeps, connection: { tenantId, refreshToken, gbpLocationId }): Promise<{ newReviews: number; newAlerts: number }>`, `runSyncForAllTenants(deps: SyncDeps): Promise<void>`.

- [ ] **Step 1: Implement the reviews client (interface plus a real HTTP implementation)**

Create `backend/src/google/reviewsClient.ts`:

```ts
export interface GoogleReview {
  externalReviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: Date;
}

export interface GoogleReviewsClient {
  listReviews(params: { accessToken: string; gbpLocationId: string }): Promise<GoogleReview[]>;
}

const STAR_RATING_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const httpGoogleReviewsClient: GoogleReviewsClient = {
  async listReviews({ accessToken, gbpLocationId }) {
    const response = await fetch(`https://mybusiness.googleapis.com/v4/${gbpLocationId}/reviews`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Google reviews request failed with ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      reviews?: Array<{
        reviewId: string;
        starRating: string;
        comment?: string;
        reviewer?: { displayName?: string };
        createTime: string;
      }>;
    };
    return (data.reviews ?? []).map((r) => ({
      externalReviewId: r.reviewId,
      rating: STAR_RATING_MAP[r.starRating] ?? 0,
      text: r.comment ?? null,
      author: r.reviewer?.displayName ?? null,
      reviewTime: new Date(r.createTime),
    }));
  },
};
```

- [ ] **Step 2: Write the failing sync tests**

Create `backend/test/sync.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import type { GoogleReviewsClient } from "../src/google/reviewsClient";

vi.mock("../src/google/oauth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
}));

import { getAccessToken } from "../src/google/oauth";
import { syncTenantReviews, runSyncForAllTenants } from "../src/google/sync";

function makeTenantWithConnection() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Test Business", notes: null, createdAt: new Date() }).run();
  db.insert(schema.googleConnections)
    .values({
      tenantId,
      refreshToken: "fake-refresh-token",
      gbpLocationId: "accounts/1/locations/1",
      connectedAt: new Date(),
      status: "connected",
    })
    .run();
  return tenantId;
}

describe("syncTenantReviews", () => {
  it("stores new reviews and creates an alert only for ratings at or below the threshold", async () => {
    const tenantId = makeTenantWithConnection();
    const onAlertCreated = vi.fn();
    const reviewsClient: GoogleReviewsClient = {
      listReviews: vi.fn().mockResolvedValue([
        { externalReviewId: "r1", rating: 2, text: "Not great", author: "Jane", reviewTime: new Date() },
        { externalReviewId: "r2", rating: 5, text: "Loved it", author: "Sam", reviewTime: new Date() },
      ]),
    };

    const result = await syncTenantReviews(
      { db, reviewsClient, negativeThreshold: 3, onAlertCreated },
      { tenantId, refreshToken: "fake-refresh-token", gbpLocationId: "accounts/1/locations/1" }
    );

    expect(result).toEqual({ newReviews: 2, newAlerts: 1 });
    expect(onAlertCreated).toHaveBeenCalledTimes(1);
    expect(onAlertCreated).toHaveBeenCalledWith(expect.objectContaining({ tenantId, rating: 2 }));

    const alerts = db.select().from(schema.alerts).where(eq(schema.alerts.tenantId, tenantId)).all();
    expect(alerts).toHaveLength(1);
  });

  it("does not duplicate reviews or alerts on a second sync of the same data", async () => {
    const tenantId = makeTenantWithConnection();
    const reviewsClient: GoogleReviewsClient = {
      listReviews: vi.fn().mockResolvedValue([
        { externalReviewId: "r1", rating: 1, text: "Bad", author: "Jane", reviewTime: new Date() },
      ]),
    };
    const deps = { db, reviewsClient, negativeThreshold: 3 };
    const connection = { tenantId, refreshToken: "fake-refresh-token", gbpLocationId: "accounts/1/locations/1" };

    await syncTenantReviews(deps, connection);
    const secondRun = await syncTenantReviews(deps, connection);

    expect(secondRun).toEqual({ newReviews: 0, newAlerts: 0 });
    const alerts = db.select().from(schema.alerts).where(eq(schema.alerts.tenantId, tenantId)).all();
    expect(alerts).toHaveLength(1);
  });
});

describe("runSyncForAllTenants", () => {
  it("marks a connection needs_reconnect when the access token fetch fails", async () => {
    const tenantId = makeTenantWithConnection();
    vi.mocked(getAccessToken).mockRejectedValueOnce(new Error("invalid_grant: access token expired"));

    await runSyncForAllTenants({ db, reviewsClient: { listReviews: vi.fn() }, negativeThreshold: 3 });

    const connection = db
      .select()
      .from(schema.googleConnections)
      .where(eq(schema.googleConnections.tenantId, tenantId))
      .get();
    expect(connection?.status).toBe("needs_reconnect");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend
pnpm vitest run test/sync.test.ts
```

Expected: FAIL with "Cannot find module '../src/google/sync'".

- [ ] **Step 4: Implement the sync logic**

Create `backend/src/google/sync.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import type { GoogleReviewsClient } from "./reviewsClient";
import { getAccessToken } from "./oauth";

export interface AlertCreatedPayload {
  id: string;
  tenantId: string;
  reviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: Date;
  createdAt: Date;
}

export interface SyncDeps {
  db: BetterSQLite3Database<typeof schema>;
  reviewsClient: GoogleReviewsClient;
  negativeThreshold: number;
  onAlertCreated?: (payload: AlertCreatedPayload) => void;
}

export async function syncTenantReviews(
  deps: SyncDeps,
  connection: { tenantId: string; refreshToken: string; gbpLocationId: string }
): Promise<{ newReviews: number; newAlerts: number }> {
  const accessToken = await getAccessToken(connection.refreshToken);
  const googleReviews = await deps.reviewsClient.listReviews({
    accessToken,
    gbpLocationId: connection.gbpLocationId,
  });

  let newReviews = 0;
  let newAlerts = 0;

  for (const review of googleReviews) {
    const existing = deps.db
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.tenantId, connection.tenantId),
          eq(schema.reviews.externalReviewId, review.externalReviewId)
        )
      )
      .get();
    if (existing) continue;

    const reviewId = randomUUID();
    deps.db
      .insert(schema.reviews)
      .values({
        id: reviewId,
        tenantId: connection.tenantId,
        externalReviewId: review.externalReviewId,
        rating: review.rating,
        text: review.text,
        author: review.author,
        reviewTime: review.reviewTime,
        replied: false,
      })
      .run();
    newReviews += 1;

    if (review.rating <= deps.negativeThreshold) {
      const alertId = randomUUID();
      const createdAt = new Date();
      deps.db
        .insert(schema.alerts)
        .values({ id: alertId, tenantId: connection.tenantId, reviewId, createdAt })
        .run();
      newAlerts += 1;
      deps.onAlertCreated?.({
        id: alertId,
        tenantId: connection.tenantId,
        reviewId,
        rating: review.rating,
        text: review.text,
        author: review.author,
        reviewTime: review.reviewTime,
        createdAt,
      });
    }
  }

  deps.db
    .update(schema.googleConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(schema.googleConnections.tenantId, connection.tenantId))
    .run();

  return { newReviews, newAlerts };
}

export async function runSyncForAllTenants(deps: SyncDeps): Promise<void> {
  const connections = deps.db
    .select()
    .from(schema.googleConnections)
    .where(and(eq(schema.googleConnections.status, "connected"), ne(schema.googleConnections.gbpLocationId, "")))
    .all();

  for (const connection of connections) {
    try {
      await syncTenantReviews(deps, connection);
    } catch (error) {
      console.error(`Sync failed for tenant ${connection.tenantId}:`, error);
      deps.db
        .update(schema.googleConnections)
        .set({ status: "needs_reconnect" })
        .where(eq(schema.googleConnections.tenantId, connection.tenantId))
        .run();
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend
pnpm vitest run test/sync.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/google/reviewsClient.ts backend/src/google/sync.ts backend/test/sync.test.ts
git commit -m "Add Google review sync with dedup, threshold, and alert creation"
```

---

### Task 7: Real-time alert delivery over Redis and SSE

**Files:**
- Create: `backend/src/realtime/redis.ts`
- Create: `backend/src/realtime/publish.ts`
- Create: `backend/src/api/routes/realtime.ts`
- Test: `backend/test/publish.test.ts`

**Interfaces:**
- Consumes: `AlertCreatedPayload` shape (Task 6, structurally). `requireAuth` (Task 3).
- Produces: `alertChannel(tenantId: string): string`, `redisPublisher: Redis`, `createSubscriber(): Redis`, `publishAlert(alert: AlertEvent): Promise<void>` where `AlertEvent` is `{ id, tenantId, reviewId, rating, text, author, reviewTime }`, `realtimeRouter` (Express Router with `GET /stream`, an SSE endpoint).

- [ ] **Step 1: Write the failing publish test**

Create `backend/test/publish.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const publishMock = vi.fn().mockResolvedValue(1);

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/publish.test.ts
```

Expected: FAIL with "Cannot find module '../src/realtime/redis'".

- [ ] **Step 3: Implement the Redis factories**

Create `backend/src/realtime/redis.ts`:

```ts
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisPublisher = new Redis(REDIS_URL);
redisPublisher.on("error", (error) => console.error("Redis publisher error:", error));

export function createSubscriber(): Redis {
  const subscriber = new Redis(REDIS_URL);
  subscriber.on("error", (error) => console.error("Redis subscriber error:", error));
  return subscriber;
}

export function alertChannel(tenantId: string): string {
  return `alerts:${tenantId}`;
}
```

- [ ] **Step 4: Implement publishAlert**

Create `backend/src/realtime/publish.ts`:

```ts
import { redisPublisher, alertChannel } from "./redis";

export interface AlertEvent {
  id: string;
  tenantId: string;
  reviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: Date;
}

export async function publishAlert(alert: AlertEvent): Promise<void> {
  await redisPublisher.publish(
    alertChannel(alert.tenantId),
    JSON.stringify({
      id: alert.id,
      reviewId: alert.reviewId,
      rating: alert.rating,
      text: alert.text,
      author: alert.author,
      reviewTime: alert.reviewTime.toISOString(),
    })
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/publish.test.ts
```

Expected: PASS.

- [ ] **Step 6: Implement the SSE endpoint**

Create `backend/src/api/routes/realtime.ts`:

```ts
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { createSubscriber, alertChannel } from "../../realtime/redis";

export const realtimeRouter = Router();

realtimeRouter.get("/stream", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const subscriber = createSubscriber();
  const channel = alertChannel(req.auth!.tenantId);
  subscriber.subscribe(channel);
  subscriber.on("message", (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });

  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    subscriber.unsubscribe(channel);
    subscriber.quit();
  });
});
```

This endpoint needs a real Redis connection and an open HTTP connection to verify end to end, so it is checked manually once the server is wired up in Task 9: open the dashboard in a browser, trigger a test alert (`redis-cli publish alerts:<tenantId> '{"id":"1","reviewId":"r1","rating":1,"text":"test","author":"test","reviewTime":"2026-01-01T00:00:00.000Z"}'`), and confirm it appears live without a page refresh.

- [ ] **Step 7: Commit**

```bash
git add backend/src/realtime backend/src/api/routes/realtime.ts backend/test/publish.test.ts
git commit -m "Add Redis pub/sub and SSE endpoint for real-time alert delivery"
```

---

### Task 8: Presence heartbeat and BullMQ email fallback worker

**Files:**
- Create: `backend/src/presence/heartbeat.ts`
- Create: `backend/src/queue/connection.ts`
- Create: `backend/src/queue/emailFallbackQueue.ts`
- Create: `backend/src/queue/shouldSendFallback.ts`
- Create: `backend/src/queue/emailFallbackWorker.ts`
- Test: `backend/test/heartbeat.test.ts`
- Test: `backend/test/shouldSendFallback.test.ts`

**Interfaces:**
- Consumes: `db`, `schema.presence`, `schema.users`, `schema.reviews`, `schema.alerts` (Task 1). `emailClient` (Task 2). `AlertCreatedPayload` shape (Task 6).
- Produces: `recordHeartbeat(userId: string): void`, `wasActiveSince(userId: string, since: Date): boolean`, `EmailFallbackJobData { alertId, tenantId, reviewId, createdAt }`, `enqueueEmailFallback(alert: Pick<AlertCreatedPayload, "id" | "tenantId" | "reviewId" | "createdAt">): Promise<void>`, `shouldSendFallbackEmail(anyUserActiveSinceAlert: boolean[]): boolean`, `startEmailFallbackWorker(): Worker<EmailFallbackJobData>`.

- [ ] **Step 1: Write the failing heartbeat test**

Create `backend/test/heartbeat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { recordHeartbeat, wasActiveSince } from "../src/presence/heartbeat";

function makeUser() {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Acme", notes: null, createdAt: new Date() }).run();
  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: "owner@acme.com" }).run();
  return userId;
}

describe("presence heartbeat", () => {
  it("reports active when the heartbeat is after the given time", () => {
    const userId = makeUser();
    const before = new Date(Date.now() - 1000);
    recordHeartbeat(userId);
    expect(wasActiveSince(userId, before)).toBe(true);
  });

  it("reports inactive when there is no heartbeat row", () => {
    const userId = makeUser();
    expect(wasActiveSince(userId, new Date())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/heartbeat.test.ts
```

Expected: FAIL with "Cannot find module '../src/presence/heartbeat'".

- [ ] **Step 3: Implement presence tracking**

Create `backend/src/presence/heartbeat.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/heartbeat.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing decision-logic test**

Create `backend/test/shouldSendFallback.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldSendFallbackEmail } from "../src/queue/shouldSendFallback";

describe("shouldSendFallbackEmail", () => {
  it("sends when nobody has been active since the alert", () => {
    expect(shouldSendFallbackEmail([false, false])).toBe(true);
  });

  it("skips when at least one user has been active since the alert", () => {
    expect(shouldSendFallbackEmail([false, true])).toBe(false);
  });

  it("sends when there are no users to check", () => {
    expect(shouldSendFallbackEmail([])).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/shouldSendFallback.test.ts
```

Expected: FAIL with "Cannot find module '../src/queue/shouldSendFallback'".

- [ ] **Step 7: Implement the decision function**

Create `backend/src/queue/shouldSendFallback.ts`:

```ts
export function shouldSendFallbackEmail(anyUserActiveSinceAlert: boolean[]): boolean {
  return !anyUserActiveSinceAlert.some((active) => active);
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/shouldSendFallback.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Implement the BullMQ connection and queue producer**

Create `backend/src/queue/connection.ts`:

```ts
import Redis from "ioredis";

export function createQueueConnection(): Redis {
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  connection.on("error", (error) => console.error("Redis queue connection error:", error));
  return connection;
}
```

Create `backend/src/queue/emailFallbackQueue.ts`:

```ts
import { Queue } from "bullmq";
import { createQueueConnection } from "./connection";
import type { AlertCreatedPayload } from "../google/sync";

export interface EmailFallbackJobData {
  alertId: string;
  tenantId: string;
  reviewId: string;
  createdAt: string;
}

const EMAIL_FALLBACK_DELAY_MS = Number(process.env.EMAIL_FALLBACK_DELAY_MS ?? 25 * 60 * 1000);

export const emailFallbackQueue = new Queue<EmailFallbackJobData>("email-fallback", {
  connection: createQueueConnection(),
});

export async function enqueueEmailFallback(
  alert: Pick<AlertCreatedPayload, "id" | "tenantId" | "reviewId" | "createdAt">
): Promise<void> {
  await emailFallbackQueue.add(
    "send-fallback-email",
    {
      alertId: alert.id,
      tenantId: alert.tenantId,
      reviewId: alert.reviewId,
      createdAt: alert.createdAt.toISOString(),
    },
    { delay: EMAIL_FALLBACK_DELAY_MS }
  );
}
```

- [ ] **Step 10: Implement the worker**

Create `backend/src/queue/emailFallbackWorker.ts`:

```ts
import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createQueueConnection } from "./connection";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { wasActiveSince } from "../presence/heartbeat";
import { shouldSendFallbackEmail } from "./shouldSendFallback";
import { emailClient } from "../email/client";
import type { EmailFallbackJobData } from "./emailFallbackQueue";

export function startEmailFallbackWorker(): Worker<EmailFallbackJobData> {
  return new Worker<EmailFallbackJobData>(
    "email-fallback",
    async (job) => {
      const { alertId, tenantId, reviewId, createdAt } = job.data;
      const alertCreatedAt = new Date(createdAt);

      const tenantUsers = db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.tenantId, tenantId))
        .all();

      const activeFlags = tenantUsers.map((user) => wasActiveSince(user.id, alertCreatedAt));
      if (!shouldSendFallbackEmail(activeFlags)) return;

      const review = db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).get();
      if (!review) return;

      for (const user of tenantUsers) {
        await emailClient.sendAlertFallbackEmail(user.email, {
          rating: review.rating,
          text: review.text,
          author: review.author,
        });
      }

      db.update(schema.alerts).set({ deliveredEmailAt: new Date() }).where(eq(schema.alerts.id, alertId)).run();
    },
    { connection: createQueueConnection() }
  );
}

if (require.main === module) {
  startEmailFallbackWorker();
  console.log("Email fallback worker started");
}
```

- [ ] **Step 11: Manual verification**

This needs a running Redis instance and BullMQ's real delay scheduling, so verify by hand: run `pnpm tsx src/queue/emailFallbackWorker.ts`, call `enqueueEmailFallback` from a Node REPL or a throwaway script with a short `EMAIL_FALLBACK_DELAY_MS` (for example `5000` in `.env` while testing), and confirm the worker log shows the job running and, if no presence heartbeat was recorded for that user, that `sendAlertFallbackEmail` fires.

- [ ] **Step 12: Commit**

```bash
git add backend/src/presence backend/src/queue backend/test/heartbeat.test.ts backend/test/shouldSendFallback.test.ts
git commit -m "Add presence heartbeat and BullMQ email fallback worker"
```

---

### Task 9: Wire up the Express app, data API, and process entrypoints

**Files:**
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`
- Create: `backend/src/api/routes/reviews.ts`
- Create: `backend/src/api/routes/presence.ts`
- Create: `backend/src/google/poller.ts`
- Modify: `backend/package.json`
- Test: `backend/test/app.test.ts`

**Interfaces:**
- Consumes: `authRouter` (Task 3), `googleRouter` (Task 5), `realtimeRouter` (Task 7), `runSyncForAllTenants`/`httpGoogleReviewsClient` (Task 6), `publishAlert` (Task 7), `enqueueEmailFallback` (Task 8), `recordHeartbeat` (Task 8), `requireAuth` (Task 3).
- Produces: `createApp(): Express`, mounted routes `POST /api/auth/request-link`, `GET /api/auth/verify`, `GET /api/google/connect`, `GET /api/google/callback`, `GET /api/google/status`, `GET /api/alerts`, `POST /api/presence/heartbeat`, `GET /api/realtime/stream`.

- [ ] **Step 1: Write the failing app test**

Create `backend/test/app.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("app", () => {
  it("rejects unauthenticated requests to /api/alerts", async () => {
    const response = await request(createApp()).get("/api/alerts");
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pnpm vitest run test/app.test.ts
```

Expected: FAIL with "Cannot find module '../src/app'".

- [ ] **Step 3: Implement the reviews/alerts and presence routes**

Create `backend/src/api/routes/reviews.ts`:

```ts
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { requireAuth } from "../middleware/requireAuth";

export const reviewsRouter = Router();

reviewsRouter.get("/alerts", requireAuth, (req, res) => {
  const rows = db
    .select({
      alertId: schema.alerts.id,
      reviewId: schema.reviews.id,
      rating: schema.reviews.rating,
      text: schema.reviews.text,
      author: schema.reviews.author,
      reviewTime: schema.reviews.reviewTime,
    })
    .from(schema.alerts)
    .innerJoin(schema.reviews, eq(schema.alerts.reviewId, schema.reviews.id))
    .where(eq(schema.alerts.tenantId, req.auth!.tenantId))
    .orderBy(desc(schema.alerts.createdAt))
    .all();

  res.json(
    rows.map((row) => ({
      id: row.alertId,
      reviewId: row.reviewId,
      rating: row.rating,
      text: row.text,
      author: row.author,
      reviewTime: row.reviewTime.toISOString(),
    }))
  );
});
```

Create `backend/src/api/routes/presence.ts`:

```ts
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { recordHeartbeat } from "../../presence/heartbeat";

export const presenceRouter = Router();

presenceRouter.post("/heartbeat", requireAuth, (req, res) => {
  recordHeartbeat(req.auth!.userId);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Implement the app factory**

Create `backend/src/app.ts`:

```ts
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./api/routes/auth";
import { googleRouter } from "./api/routes/google";
import { reviewsRouter } from "./api/routes/reviews";
import { realtimeRouter } from "./api/routes/realtime";
import { presenceRouter } from "./api/routes/presence";

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/auth", authRouter);
  app.use("/api/google", googleRouter);
  app.use("/api", reviewsRouter);
  app.use("/api/realtime", realtimeRouter);
  app.use("/api/presence", presenceRouter);

  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend
pnpm vitest run test/app.test.ts
```

Expected: PASS.

- [ ] **Step 6: Implement the server and poller entrypoints**

Create `backend/src/server.ts`:

```ts
import "dotenv/config";
import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Backend listening on port ${port}`));
```

Create `backend/src/google/poller.ts`:

```ts
import "dotenv/config";
import { db } from "../db/client";
import { httpGoogleReviewsClient } from "./reviewsClient";
import { runSyncForAllTenants } from "./sync";
import { publishAlert } from "../realtime/publish";
import { enqueueEmailFallback } from "../queue/emailFallbackQueue";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15 * 60 * 1000);
const NEGATIVE_THRESHOLD = Number(process.env.NEGATIVE_REVIEW_THRESHOLD ?? 3);

async function tick(): Promise<void> {
  await runSyncForAllTenants({
    db,
    reviewsClient: httpGoogleReviewsClient,
    negativeThreshold: NEGATIVE_THRESHOLD,
    onAlertCreated: (alert) => {
      // Publishing and enqueueing are best effort: a Redis outage must not
      // crash the poller, since the alert row itself is already durably
      // stored and can still be delivered once Redis recovers.
      publishAlert(alert).catch((error) => console.error("Failed to publish real-time alert:", error));
      enqueueEmailFallback(alert).catch((error) => console.error("Failed to enqueue email fallback:", error));
    },
  });
}

tick();
setInterval(tick, POLL_INTERVAL_MS);
```

- [ ] **Step 7: Add the remaining process scripts**

Edit `backend/package.json`, add to `"scripts"`:

```json
"worker": "tsx src/queue/emailFallbackWorker.ts",
"poller": "tsx src/google/poller.ts"
```

- [ ] **Step 8: Manual verification**

```bash
cd backend
pnpm db:migrate
pnpm dev
```

In another terminal:

```bash
curl -i http://localhost:3000/api/alerts
```

Expected: `HTTP/1.1 401 Unauthorized` with `{"error":"Not authenticated"}`, confirming the whole app boots and auth is enforced end to end.

- [ ] **Step 9: Commit**

```bash
git add backend/src/app.ts backend/src/server.ts backend/src/api/routes/reviews.ts backend/src/api/routes/presence.ts backend/src/google/poller.ts backend/package.json backend/test/app.test.ts
git commit -m "Wire up the Express app, data API, and worker/poller entrypoints"
```

---

### Task 10: Re-scaffold the frontend as a SvelteKit app

The existing `frontend/` directory was generated from SvelteKit's library template (for publishing a reusable component package), not an app template. It has no real code in it yet, so replacing it is low risk.

**Files:**
- Remove and regenerate: `frontend/` (entire directory)
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Regenerate the frontend as a normal app**

```bash
cd /home/ubuntu/projects/scalable
rm -rf frontend
pnpm dlx sv@0.17.0 create --template minimal --types ts --install pnpm frontend
```

If that non-interactive form is rejected by the installed `sv` version, run `pnpm dlx sv create frontend` instead and answer the prompts: SvelteKit minimal template, TypeScript, pnpm.

- [ ] **Step 2: Confirm the result is an app, not a library**

Open `frontend/package.json` and confirm it has `"private": true`, no `"exports"` field, and no `svelte-package`/`publint` step in its build script. If any of those are present, the wrong template was selected: delete `frontend/` and repeat Step 1.

- [ ] **Step 3: Add the API dev proxy**

Read the generated `frontend/vite.config.ts` and add a `server.proxy` entry inside `defineConfig({...})` so `/api` requests during `pnpm dev` reach the backend on the same origin (this is what lets the session cookie work without CORS):

```ts
server: {
  proxy: {
    "/api": {
      target: process.env.BACKEND_URL ?? "http://localhost:3000",
      changeOrigin: true,
    },
  },
},
```

- [ ] **Step 4: Manual verification**

```bash
cd frontend
pnpm dev
```

Open `http://localhost:5173` in a browser and confirm the default SvelteKit page loads without console errors.

- [ ] **Step 5: Commit**

```bash
git add -A frontend
git commit -m "Re-scaffold frontend as a SvelteKit app instead of a library"
```

---

### Task 11: Frontend login and magic-link verification

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/routes/login/+page.svelte`
- Create: `frontend/src/routes/auth/verify/+page.svelte`

**Interfaces:**
- Consumes: `POST /api/auth/request-link`, `GET /api/auth/verify?token=` (Task 3, reached through the `/api` proxy from Task 10).
- Produces: `requestLoginLink(email: string): Promise<void>`, `verifyLoginToken(token: string): Promise<boolean>`, `ReviewAlert { id, reviewId, rating, text, author, reviewTime }`, `fetchAlerts(): Promise<ReviewAlert[]>`, `sendPresenceHeartbeat(): Promise<void>`, `GoogleConnectionStatus`, `fetchGoogleStatus(): Promise<GoogleConnectionStatus>` (the last four are used starting in Task 12, defined here since they belong to the same API client file).

- [ ] **Step 1: Implement the API client**

Create `frontend/src/lib/api.ts`:

```ts
const API_BASE = "/api";

export async function requestLoginLink(email: string): Promise<void> {
  await fetch(`${API_BASE}/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
}

export async function verifyLoginToken(token: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/auth/verify?token=${encodeURIComponent(token)}`, {
    credentials: "include",
  });
  return response.ok;
}

export interface ReviewAlert {
  id: string;
  reviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: string;
}

export async function fetchAlerts(): Promise<ReviewAlert[]> {
  const response = await fetch(`${API_BASE}/alerts`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load alerts");
  return response.json();
}

export async function sendPresenceHeartbeat(): Promise<void> {
  await fetch(`${API_BASE}/presence/heartbeat`, { method: "POST", credentials: "include" });
}

export type GoogleConnectionStatus = "connected" | "needs_reconnect" | "not_connected";

export async function fetchGoogleStatus(): Promise<GoogleConnectionStatus> {
  const response = await fetch(`${API_BASE}/google/status`, { credentials: "include" });
  if (!response.ok) return "not_connected";
  const data = (await response.json()) as { status: GoogleConnectionStatus };
  return data.status;
}
```

- [ ] **Step 2: Implement the login page**

Create `frontend/src/routes/login/+page.svelte`:

```svelte
<script lang="ts">
  import { requestLoginLink } from '$lib/api';

  let email = $state('');
  let status = $state<'idle' | 'sending' | 'sent'>('idle');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    status = 'sending';
    await requestLoginLink(email);
    status = 'sent';
  }
</script>

<main class="login">
  <div class="panel">
    <h1>Sign in</h1>
    {#if status === 'sent'}
      <p class="confirmation">Check your email for a login link.</p>
    {:else}
      <form onsubmit={submit}>
        <label for="email">Work email</label>
        <input id="email" type="email" bind:value={email} required placeholder="owner@yourbusiness.com" />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending...' : 'Send login link'}
        </button>
      </form>
    {/if}
  </div>
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #14171c;
    color: #f2efe9;
    font-family: 'Iowan Old Style', Georgia, serif;
  }

  .panel {
    width: min(360px, 90vw);
    padding: 2.5rem;
    background: #1d2128;
    border: 1px solid #2b313b;
    border-radius: 2px;
  }

  h1 {
    margin: 0 0 1.5rem;
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  label {
    display: block;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9aa3b1;
    margin-bottom: 0.5rem;
  }

  input {
    width: 100%;
    padding: 0.7rem 0.8rem;
    background: #14171c;
    border: 1px solid #2b313b;
    color: #f2efe9;
    font-size: 1rem;
    box-sizing: border-box;
    margin-bottom: 1.25rem;
  }

  button {
    width: 100%;
    padding: 0.75rem;
    background: #d97757;
    color: #14171c;
    border: none;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .confirmation {
    color: #9aa3b1;
  }
</style>
```

- [ ] **Step 3: Implement the verify page**

Create `frontend/src/routes/auth/verify/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { verifyLoginToken } from '$lib/api';

  let status = $state<'checking' | 'failed'>('checking');

  onMount(async () => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      status = 'failed';
      return;
    }
    const ok = await verifyLoginToken(token);
    if (ok) {
      goto('/dashboard');
    } else {
      status = 'failed';
    }
  });
</script>

<main class="verify">
  {#if status === 'checking'}
    <p>Signing you in...</p>
  {:else}
    <p>That link is invalid or expired. <a href="/login">Request a new one</a>.</p>
  {/if}
</main>

<style>
  .verify {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #14171c;
    color: #f2efe9;
    font-family: 'Iowan Old Style', Georgia, serif;
  }
</style>
```

- [ ] **Step 4: Manual verification**

With the backend running (`pnpm dev` in `backend/`, migrated database, at least one tenant created via `createTenant.ts`) and the frontend running (`pnpm dev` in `frontend/`):

1. Visit `http://localhost:5173/login`, submit the email address used in `createTenant.ts`.
2. Check the backend logs or the Resend dashboard for the sent email, copy the `token` query parameter from the link.
3. Visit `http://localhost:5173/auth/verify?token=<token>` and confirm it redirects to `/dashboard` (a 404 is expected there until Task 12).
4. Confirm a `session` cookie is now set (check the browser's dev tools, Application tab).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/routes/login frontend/src/routes/auth
git commit -m "Add frontend login and magic-link verification pages"
```

---

### Task 12: Frontend dashboard with real-time alerts

**Files:**
- Create: `frontend/src/lib/sse.ts`
- Create: `frontend/src/lib/presence.ts`
- Create: `frontend/src/lib/sound.ts`
- Create: `frontend/src/routes/dashboard/+page.svelte`
- Create: `frontend/static/alert.mp3` (a short notification sound, see Step 1)

**Interfaces:**
- Consumes: `fetchAlerts`, `sendPresenceHeartbeat`, `fetchGoogleStatus`, `ReviewAlert`, `GoogleConnectionStatus` (Task 11). Backend `GET /api/realtime/stream` (Task 7) and `GET /api/google/status` (Task 5), both reached through the proxy.
- Produces: `subscribeToAlerts(onAlert: (alert: ReviewAlert) => void): () => void`, `startPresenceHeartbeat(): () => void`, `playAlertSound(): void`.

- [ ] **Step 1: Add a notification sound asset**

Place any short (1 to 2 second) notification sound file at `frontend/static/alert.mp3`. If none is available yet, use a placeholder silent or beep file for now and swap it later; the code in this task does not depend on its specific content.

- [ ] **Step 2: Implement the SSE subscription helper**

Create `frontend/src/lib/sse.ts`:

```ts
import type { ReviewAlert } from './api';

export function subscribeToAlerts(onAlert: (alert: ReviewAlert) => void): () => void {
  const source = new EventSource('/api/realtime/stream', { withCredentials: true });

  source.onmessage = (event) => {
    onAlert(JSON.parse(event.data) as ReviewAlert);
  };

  return () => source.close();
}
```

- [ ] **Step 3: Implement the presence heartbeat helper**

Create `frontend/src/lib/presence.ts`:

```ts
import { sendPresenceHeartbeat } from './api';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function startPresenceHeartbeat(): () => void {
  void sendPresenceHeartbeat();
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendPresenceHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}
```

- [ ] **Step 4: Implement the sound helper**

Create `frontend/src/lib/sound.ts`:

```ts
export function playAlertSound(): void {
  const audio = new Audio('/alert.mp3');
  void audio.play().catch(() => {
    // Autoplay can be blocked until the user interacts with the page once; not fatal.
  });
}
```

- [ ] **Step 5: Implement the dashboard page**

Create `frontend/src/routes/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchAlerts, fetchGoogleStatus, type ReviewAlert, type GoogleConnectionStatus } from '$lib/api';
  import { startPresenceHeartbeat } from '$lib/presence';
  import { subscribeToAlerts } from '$lib/sse';
  import { playAlertSound } from '$lib/sound';

  let alerts = $state<ReviewAlert[]>([]);
  let loading = $state(true);
  let googleStatus = $state<GoogleConnectionStatus>('connected');

  let stopHeartbeat: () => void;
  let closeStream: () => void;

  onMount(async () => {
    const [initialAlerts, status] = await Promise.all([fetchAlerts(), fetchGoogleStatus()]);
    alerts = initialAlerts;
    googleStatus = status;
    loading = false;

    stopHeartbeat = startPresenceHeartbeat();
    closeStream = subscribeToAlerts((incoming) => {
      alerts = [incoming, ...alerts];
      playAlertSound();
    });
  });

  onDestroy(() => {
    stopHeartbeat?.();
    closeStream?.();
  });
</script>

<main class="dashboard">
  <header>
    <h1>Reviews needing attention</h1>
  </header>

  {#if googleStatus !== 'connected'}
    <p class="banner">
      Your Google Business Profile connection needs attention.
      <a href="/api/google/connect">Reconnect Google</a>
    </p>
  {/if}

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if alerts.length === 0}
    <p class="empty">No low-rated reviews yet. You will hear a sound the moment one comes in.</p>
  {:else}
    <ul class="alerts">
      {#each alerts as alert (alert.id)}
        <li class="alert">
          <div class="rating" data-rating={alert.rating}>{alert.rating}</div>
          <div class="content">
            <p class="author">{alert.author ?? 'A customer'}</p>
            <p class="text">{alert.text ?? '(no comment left)'}</p>
            <p class="time">{new Date(alert.reviewTime).toLocaleString()}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .dashboard {
    min-height: 100vh;
    background: #f4f1ea;
    color: #14171c;
    font-family: 'Iowan Old Style', Georgia, serif;
    padding: 3rem clamp(1rem, 5vw, 4rem);
  }

  header h1 {
    font-size: 1.75rem;
    font-weight: 500;
    margin-bottom: 2rem;
  }

  .empty {
    color: #6b7280;
  }

  .banner {
    margin: 0 0 1.5rem;
    padding: 0.85rem 1.1rem;
    background: #f0e4c8;
    border: 1px solid #d8c393;
    color: #5c4a1f;
  }

  .banner a {
    color: #5c4a1f;
    font-weight: 600;
  }

  .alerts {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #d8d2c4;
    border: 1px solid #d8d2c4;
  }

  .alert {
    display: flex;
    gap: 1.25rem;
    padding: 1.25rem 1.5rem;
    background: #fbfaf6;
  }

  .rating {
    flex: none;
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #b4443a;
    color: #fbfaf6;
    font-weight: 600;
  }

  .content {
    flex: 1;
  }

  .author {
    margin: 0 0 0.25rem;
    font-weight: 600;
  }

  .text {
    margin: 0 0 0.5rem;
    color: #3f3a33;
  }

  .time {
    margin: 0;
    font-size: 0.8rem;
    color: #8a8371;
  }
</style>
```

- [ ] **Step 6: Manual verification (this is the end-to-end path for the whole feature)**

With backend, worker, poller, and frontend all running:

1. Log in as a tenant user through `/login` and `/auth/verify`, land on `/dashboard`.
2. Publish a fake alert directly to Redis to simulate a new low-star review: `redis-cli publish alerts:<tenantId> '{"id":"test-1","reviewId":"r1","rating":1,"text":"Terrible","author":"Test","reviewTime":"2026-01-01T00:00:00.000Z"}'`.
3. Confirm the alert appears at the top of the list immediately, with the notification sound playing, and no page reload.
4. Confirm the visual design is a deliberate, distinct look (the panel above uses a serif display font, a warm off-white and near-black palette, and a plain divided list rather than a default component-library card grid) rather than a generic gradient-hero, rounded-shadow-card Tailwind layout.
5. Confirm the reconnect banner: manually set that tenant's `google_connections.status` to `needs_reconnect` (`sqlite3 backend/data.sqlite "UPDATE google_connections SET status = 'needs_reconnect' WHERE tenant_id = '<tenantId>';"`), reload `/dashboard`, and confirm the banner with the "Reconnect Google" link appears. Set it back to `connected` afterward.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/sse.ts frontend/src/lib/presence.ts frontend/src/lib/sound.ts frontend/src/routes/dashboard frontend/static/alert.mp3
git commit -m "Add frontend dashboard with real-time alerts, presence heartbeat, and sound"
```
