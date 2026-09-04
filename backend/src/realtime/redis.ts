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
