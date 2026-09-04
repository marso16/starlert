import Redis from "ioredis";

export function createQueueConnection(): Redis {
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  connection.on("error", (error) => console.error("Redis queue connection error:", error));
  return connection;
}
