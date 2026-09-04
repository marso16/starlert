import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { recordHeartbeat } from "../../presence/heartbeat";

export const presenceRouter = Router();

presenceRouter.post("/heartbeat", requireAuth, (req, res) => {
  recordHeartbeat(req.auth!.userId);
  res.json({ ok: true });
});
