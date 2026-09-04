import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createTenantAndInvite } from "../scripts/createTenant";

describe("createTenantAndInvite", () => {
  it("creates a tenant and its first user, and sends an invite email", async () => {
    const sendInvite = vi.fn().mockResolvedValue(undefined);

    const { tenantId, userId } = await createTenantAndInvite("Acme Plumbing", "owner@acme.com", {
      sendInvite,
    });

    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
    expect(tenant?.name).toBe("Acme Plumbing");

    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    expect(user?.email).toBe("owner@acme.com");

    expect(sendInvite).toHaveBeenCalledWith("owner@acme.com", expect.stringContaining("/auth/verify?token="));
  });
});
