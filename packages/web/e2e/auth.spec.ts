import { expect, test } from "@playwright/test";
import { signIn, testUser } from "./global-setup.ts";

// Starts logged out (no saved session).
test.use({ storageState: { cookies: [], origins: [] } });

test("redirects to the login page, logs in, returns to the same view, logs out", async ({ page }) => {
  await page.goto("/#/transactions");
  await expect(page).toHaveURL(/amazoncognito\.com\/(login|oauth2)/);

  const { email, password } = testUser();
  await signIn(page, email, password);
  await expect(page.getByTestId("user-email")).toHaveText(email);
  await expect(page).toHaveURL(/#\/transactions$/); // back on the view it started from, without ?code=
  await expect(page.getByTestId("transactions-table")).toBeVisible();

  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/amazoncognito\.com/); // logged out, so the site sends you to the login page again
  await page.goto("/");
  await expect(page).toHaveURL(/amazoncognito\.com/);
});
