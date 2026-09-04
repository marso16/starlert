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
