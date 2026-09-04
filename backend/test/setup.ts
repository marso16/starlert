process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-secret";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "alerts@example.com";
process.env.FRONTEND_URL = "http://localhost:5173";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/db/client";

migrate(db, { migrationsFolder: "./drizzle" });
