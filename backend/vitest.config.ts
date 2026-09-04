import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      SESSION_SECRET: "test-secret",
      RESEND_API_KEY: "test-key",
      EMAIL_FROM: "alerts@example.com",
      FRONTEND_URL: "http://localhost:5173",
    },
  },
});
