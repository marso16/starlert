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
