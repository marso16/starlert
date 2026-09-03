import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { tenants } from "../src/db/schema";

describe("db client", () => {
  it("can insert and read back a tenant", () => {
    const id = randomUUID();
    db.insert(tenants).values({ id, name: "Acme Plumbing", createdAt: new Date() }).run();

    const row = db.select().from(tenants).where(eq(tenants.id, id)).get();
    expect(row?.name).toBe("Acme Plumbing");
  });
});
