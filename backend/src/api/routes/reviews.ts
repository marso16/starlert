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
