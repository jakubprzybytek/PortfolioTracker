// Logs the test user in once through the Cognito hosted page and saves the session (tokens live in
// localStorage) for all tests. Run the E2E tests inside `sst shell` so the test user is available:
//   npx sst shell --stage dev -- npm run test:e2e

import { chromium, type FullConfig } from "@playwright/test";
import { Resource } from "sst";

export const STORAGE_STATE = "packages/web/e2e/.auth/user.json";

export const testUser = () => ({ email: Resource.TestUser.email, password: Resource.TestUserPassword.value });

/** Fills the hosted login page (classic UI renders two forms; only one is visible). */
export async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.waitForURL(/amazoncognito\.com/);
  await page.locator('input[name="username"]:visible').fill(email);
  await page.locator('input[name="password"]:visible').fill(password);
  await page.locator('input[name="signInSubmitButton"]:visible').click();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const { email, password } = testUser();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseURL);
  await signIn(page, email, password);
  await page.getByTestId("user-email").waitFor({ timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
