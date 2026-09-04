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
