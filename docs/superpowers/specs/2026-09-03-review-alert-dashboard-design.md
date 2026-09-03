# Review & Reputation Alert Dashboard — Design

## Purpose

A tool sold directly to a small number of local businesses that watches
their Google Business Profile reviews and alerts the owner the moment a
low-star review comes in, so they can respond before it does damage. Sold
as a subscription, onboarded manually (no public signup in v1).

## Goals

- Detect new Google reviews at or below a configurable star threshold
  (default: 3 stars and below) shortly after they're posted.
- Notify the owner in real time if their dashboard is open, with a
  fallback email if they haven't been active recently.
- Keep infrastructure cost near zero: SQLite for storage, the already-
  hosted Redis instance for real-time delivery, email via Resend or
  Postmark.
- Support multiple client businesses (tenants) from one deployment.

## Non-goals (v1)

- No review platforms other than Google Business Profile.
- No AI-drafted reply suggestions (candidate for a v1.1 upsell).
- No public signup or self-serve billing — tenants are created manually
  after a deal closes, billed by invoice.
- No SMS delivery.

## Architecture

Single SvelteKit application: the existing frontend routes plus
SvelteKit server endpoints acting as the backend, avoiding a second
running process for the MVP. SQLite (via Drizzle) is the system of
record. The existing hosted Redis instance is used for two things:
pub/sub for real-time dashboard push, and as the backing store for a
BullMQ queue that runs the delayed email-fallback job. Email goes
through Resend or Postmark. Google Business Profile API (OAuth) is the
only external review source.

## Data model

Shared SQLite database, every tenant-scoped table carries a
`tenant_id`.

- **tenants** — one row per client business. `id`, `name`, `created_at`,
  freeform `notes` (plan/billing notes, since billing is manual).
- **users** — dashboard logins. `id`, `tenant_id`, `email`. Auth is
  magic-link only: a separate `login_tokens` table (`token`, `user_id`,
  `expires_at`, `used_at`) backs the flow, no password column exists.
- **google_connections** — one per tenant. `tenant_id`, `refresh_token`
  (encrypted at rest), `gbp_location_id`, `connected_at`,
  `last_sync_at`, `status` (`connected` / `needs_reconnect`).
- **reviews** — synced review data. `id`, `tenant_id`, `external_review_id`
  (unique per tenant, used for upsert/dedup), `rating`, `text`, `author`,
  `review_time`, `replied` (bool, best-effort from the API).
- **alerts** — one row per review that crossed the negative threshold.
  `id`, `tenant_id`, `review_id`, `created_at`, `delivered_realtime_at`
  (nullable), `delivered_email_at` (nullable).
- **presence** — per-user liveness for the email-fallback decision.
  `user_id`, `last_seen_at`, updated by a heartbeat while the dashboard
  tab is open and focused.

## Review sync

Google's Business Profile API has no push/webhook for new reviews, so
sync is a scheduled poll: every 15 minutes (tunable per tenant if a
client's volume warrants it), a job iterates tenants with a `connected`
Google connection, fetches recent reviews using the stored OAuth
refresh token, and upserts into `reviews` keyed on
`(tenant_id, external_review_id)`. Any newly-inserted review with
`rating <= threshold` (default 3) gets an `alerts` row created in the
same transaction as the review insert, so a review is never synced
without its alert being considered.

## Real-time delivery + email fallback

On `alerts` row creation:

1. Publish an event on a tenant-scoped Redis channel.
2. Any open dashboard session subscribed to that channel (via SSE — chosen
   over raw WebSockets for simpler reconnect semantics and because
   delivery is one-directional, server to client) receives it
   immediately, updates the UI, and plays a notification sound.
3. A BullMQ job is enqueued with a delay of 20-30 minutes (using the
   same Redis instance).
4. When that job runs, it checks `presence.last_seen_at` for the
   tenant's users. If no user has been active since the alert was
   created, it sends the fallback email and stamps
   `delivered_email_at`. If a user was active, the job exits without
   sending and stamps nothing further (the SSE delivery already
   counted as delivered).

## Auth & onboarding

Magic-link email login: user enters their email, a single-use token is
emailed, following the link creates a session. No passwords stored.

Onboarding is manual: after a deal closes, a `tenants` row and the
owner's first `users` row are created directly (an internal admin
action, not a public form), a magic-link login is sent, and the owner
is walked through the Google OAuth consent screen once to populate
`google_connections`.

## Error handling

- **Google token expiry/revocation**: if a poll fails with an auth
  error, mark the connection `needs_reconnect` and surface a visible
  "reconnect Google" banner in that tenant's dashboard rather than
  failing silently. Sync for other tenants continues unaffected.
- **Email delivery failure**: log and move on; it must never block or
  retry-block the real-time (SSE) path, since that's the primary
  delivery channel.
- **Redis unavailable**: real-time delivery and the email-fallback
  queue degrade together; reviews still sync and land in `alerts`, so
  no alert is silently lost, but delivery is delayed until Redis
  recovers. (Acceptable for v1 given a single hosted Redis instance is
  the only dependency added beyond SQLite.)

## Testing

- Unit tests for the threshold/dedup upsert logic in the sync job
  (new review below threshold creates exactly one alert; re-synced
  review does not duplicate one).
- Unit tests for the presence-based email-fallback decision (active
  within window skips email, inactive sends it).
- Integration test for the sync job against a mocked Google Business
  Profile API response (new reviews, no new reviews, auth failure).

## Open questions / tunable parameters (not blocking, can default and adjust later)

- Star threshold for "negative": defaults to <= 3, should be a
  per-tenant setting rather than hardcoded.
- Poll interval: defaults to 15 minutes, should be configurable per
  tenant if a client's review volume or plan tier warrants tighter
  polling.
