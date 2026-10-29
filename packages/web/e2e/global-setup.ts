// Logs the test user in once through the app's login form and saves the session (Amplify keeps the tokens
// in localStorage) for all tests. Run the E2E tests inside `sst shell` so the test user is available:
//   npx sst shell --stage dev -- npm run test:e2e

import { chromium, type FullConfig } from "@playwright/test";
import { Resource } from "sst";

export const STORAGE_STATE = "packages/web/e2e/.auth/user.json";

export const testUser = () => ({ email: Resource.TestUser.email, password: Resource.TestUserPassword.value });

/** Fills the app's login form. */
export async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

export default async function globalSetup(config: FullConfig) {
  // The tests add, edit and delete data: never on prod (its API refuses the test user anyway).
  if (Resource.App.stage === "prod") throw new Error("The E2E tests change data: they must not run against prod");
  const baseURL = config.projects[0]!.use.baseURL!;
  if (/^https:\/\/portfoliotracker\.albedoonline\.com/.test(baseURL)) throw new Error("The E2E tests must not run against the prod site");
  const { email, password } = testUser();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseURL);
  await signIn(page, email, password);
  await page.getByTestId("user-email").waitFor({ timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
