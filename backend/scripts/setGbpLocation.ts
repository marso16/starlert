import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";

const [, , tenantId, gbpLocationId] = process.argv;

if (!tenantId || !gbpLocationId) {
  console.error("Usage: pnpm tsx scripts/setGbpLocation.ts <tenantId> <accounts/*/locations/*>");
  process.exit(1);
}

const result = db
  .update(schema.googleConnections)
  .set({ gbpLocationId })
  .where(eq(schema.googleConnections.tenantId, tenantId))
  .run();

if (result.changes === 0) {
  console.error(`No google_connections row found for tenant ${tenantId}. Connect Google for that tenant first.`);
  process.exit(1);
}

console.log(`Set gbpLocationId for tenant ${tenantId}`);
