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
