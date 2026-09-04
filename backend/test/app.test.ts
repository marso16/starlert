import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("app", () => {
  it("rejects unauthenticated requests to /api/alerts", async () => {
    const response = await request(createApp()).get("/api/alerts");
    expect(response.status).toBe(401);
  });
});
