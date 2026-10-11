import { defineConfig } from "@playwright/test";

// Inside `sst shell` (the login uses the stage's test user): npx sst shell --stage dev -- npm run test:e2e
// E2E against the local Vite dev server (started by `npm run dev -- --stage dev`), which talks to the dev API.
// Set WEB_URL to test a deployed site instead.
const baseURL = process.env["WEB_URL"] ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL, viewport: { width: 1280, height: 900 }, trace: "retain-on-failure", storageState: "packages/web/e2e/.auth/user.json" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
