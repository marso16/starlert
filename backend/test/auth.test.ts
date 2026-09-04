import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";

const { sendMagicLinkEmailMock } = vi.hoisted(() => ({
  sendMagicLinkEmailMock: vi.fn(),
}));

vi.mock("../src/email/client", () => ({
  emailClient: {
    sendMagicLinkEmail: sendMagicLinkEmailMock,
    sendAlertFallbackEmail: vi.fn(),
  },
}));

import { authRouter } from "../src/api/routes/auth";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/auth", authRouter);
  return app;
}

function makeUser(email: string) {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name: "Acme", notes: null, createdAt: new Date() }).run();
  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email }).run();
  return { tenantId, userId };
}

describe("POST /auth/request-link", () => {
  beforeEach(() => {
    sendMagicLinkEmailMock.mockReset();
  });

  it("responds ok:true for a registered email without waiting on the email send to finish", async () => {
    const email = `owner-${randomUUID()}@acme.com`;
    makeUser(email);

    // A promise that never resolves during this test. If the route handler
    // awaited the email send, this request would hang and the test would
    // time out instead of completing.
    sendMagicLinkEmailMock.mockReturnValue(new Promise(() => {}));

    const app = makeApp();
    const response = await request(app).post("/auth/request-link").send({ email });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
  });

  it("responds identically for an email that is not registered", async () => {
    const app = makeApp();
    const response = await request(app)
      .post("/auth/request-link")
      .send({ email: `nobody-${randomUUID()}@acme.com` });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).not.toHaveBeenCalled();
  });

  it("still responds ok:true when the email send rejects", async () => {
    const email = `owner-${randomUUID()}@acme.com`;
    makeUser(email);
    sendMagicLinkEmailMock.mockRejectedValue(new Error("Resend is down"));

    const app = makeApp();
    const response = await request(app).post("/auth/request-link").send({ email });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
