import { expect, test } from "@playwright/test";
import { signIn, testUser } from "./global-setup.ts";

// Starts logged out (no saved session).
test.use({ storageState: { cookies: [], origins: [] } });

test("shows the login form on the site's own domain, rejects a wrong password, keeps the view, logs out", async ({ page, baseURL }) => {
  await page.goto("/#/transactions");
  await expect(page.getByTestId("login-form")).toBeVisible();
  expect(new URL(page.url()).host).toBe(new URL(baseURL!).host); // no redirect to another domain

  const { email, password } = testUser();
  await signIn(page, email, "not-the-password-1A!");
  await expect(page.getByTestId("login-error")).toHaveText("Incorrect email or password.");

  await signIn(page, email, password);
  await expect(page.getByTestId("user-email")).toHaveText(email);
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(page.getByTestId("transactions-table")).toBeVisible();

  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-form")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("login-form")).toBeVisible(); // tokens are gone, not just hidden
});

test("forgot password switches to the reset form and back (no code is requested)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("login-forgot").click();
  await expect(page.getByRole("form", { name: "Reset password" })).toBeVisible();
  await expect(page.getByTestId("login-password")).toHaveCount(0);
  await expect(page.getByTestId("login-submit")).toHaveText("Send code");
  await page.getByTestId("login-back").click();
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
});
