import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLoginToken } from "../src/auth/magicLink";
import { emailClient, type EmailClient } from "../src/email/client";

export async function createTenantAndInvite(
  name: string,
  email: string,
  deps: { sendInvite: EmailClient["sendMagicLinkEmail"] } = { sendInvite: emailClient.sendMagicLinkEmail }
): Promise<{ tenantId: string; userId: string }> {
  const tenantId = randomUUID();
  db.insert(schema.tenants).values({ id: tenantId, name, notes: null, createdAt: new Date() }).run();

  const userId = randomUUID();
  db.insert(schema.users).values({ id: userId, tenantId, email: email.toLowerCase() }).run();

  const { token } = createLoginToken(userId);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const loginUrl = `${frontendUrl}/auth/verify?token=${token}`;

  await deps.sendInvite(email, loginUrl);

  return { tenantId, userId };
}

if (require.main === module) {
  const [, , name, email] = process.argv;
  if (!name || !email) {
    console.error('Usage: pnpm tsx scripts/createTenant.ts "Business Name" owner@example.com');
    process.exit(1);
  }
  createTenantAndInvite(name, email)
    .then(({ tenantId }) => console.log(`Created tenant ${name} (${tenantId}) and sent login link to ${email}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
