import { expect, test } from "@playwright/test";

// Holdings and Transactions views, against the sample data: accounts "broker" (DS0432, IZ0836) and "ike" (DS0432).

test.describe("navigation", () => {
  test("the side menu switches views and keeps the URL in sync", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("total-value")).toBeVisible();

    await page.getByTestId("nav-holdings").click();
    await expect(page).toHaveURL(/#\/holdings$/);
    await expect(page.getByTestId("nav-holdings")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Holdings", level: 2 })).toBeVisible();

    await page.getByTestId("nav-transactions").click();
    await expect(page).toHaveURL(/#\/transactions$/);
    await expect(page.getByTestId("transactions-table")).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId("nav-holdings")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("transactions view", () => {
  test("lists all transactions, newest first", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(13);
    const dates = await rows.locator("td:first-child").allTextContents();
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(rows.first()).toContainText("2026-09-30");
    await expect(page.getByTestId("filters-summary")).toHaveText("13 of 13 transactions");
  });

  test("filters by instrument, account and asset type, and keeps filters in the URL", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(13);

    await page.getByTestId("filter-instrument").selectOption({ label: "DS0432" });
    await expect(rows).toHaveCount(4); // broker: buy + 2 coupons, ike: buy
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/instrument=PL0000113783/);
    await expect(page).toHaveURL(/account=ike/);

    await page.reload();
    await expect(rows).toHaveCount(1);

    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(13);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(4); // the deposits
    await expect(rows.first()).toContainText("Deposit");
  });
});

test.describe("holdings view", () => {
  test("groups holdings by account, sorted alphabetically", async ({ page }) => {
    await page.goto("/#/holdings");
    const table = page.getByTestId("holdings-by-account");
    await expect(page.getByTestId("account-broker")).toBeVisible();
    await expect(page.getByTestId("account-ike")).toBeVisible();
    await expect(page.getByTestId("holdings-total")).toBeVisible();

    const groupOrder = await table.locator("tr.group").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(groupOrder).toEqual(["account-broker", "account-etf", "account-ike"]);
    // each account ends with its cash; the incomplete account shows only cash, greyed, with a note
    await expect(table.locator('tr[data-testid="cash-row"][data-account="broker"]')).toContainText("5420,86");
    await expect(page.getByTestId("account-etf").getByTestId("incomplete")).toContainText("ETFs not tracked yet");
    await expect(table.locator('tr[data-testid="cash-row"][data-account="etf"]')).toHaveClass(/muted/);
    const broker = table.locator('tr[data-testid="holding-row"][data-account="broker"]');
    await expect(broker).toHaveCount(2);
    expect(await broker.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "IZ0836"]);
    const ike = table.locator('tr[data-testid="holding-row"][data-account="ike"]');
    await expect(ike).toHaveCount(3);
    expect(await ike.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "EDO0935", "SAMPLE-APARTMENT"]);
    await expect(ike.first().locator("td").nth(2)).toHaveText("5");
    await expect(ike.nth(1).locator("td").nth(1)).toHaveText("Retail bond");
  });

  test("filters by account and asset type", async ({ page }) => {
    await page.goto("/#/holdings");
    const rows = page.getByTestId("holding-row");
    await expect(rows).toHaveCount(5);
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId("account-broker")).toHaveCount(0);
    await expect(page.getByTestId("filters-summary")).toHaveText("3 of 5 holdings");
    await page.getByTestId("filters-reset").click();
    await page.getByTestId("filter-type").selectOption({ label: "Listed bond" });
    await expect(rows).toHaveCount(3);
    await page.getByTestId("filter-type").selectOption({ label: "Retail bond" });
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("cash-row")).toHaveCount(3);
  });
});

test.describe("prices view", () => {
  test("lists held instruments with price, date and 1-year change; a click shows the chart", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-prices").click();
    await expect(page).toHaveURL(/#\/prices$/);
    const rows = page.getByTestId("prices-table").locator("tbody tr");
    await expect(rows).toHaveCount(4);
    expect(await rows.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "EDO0935", "IZ0836", "SAMPLE-APARTMENT"]);
    const manual = page.getByTestId("price-SAMPLE-APARTMENT");
    await expect(manual.locator("td").nth(2)).toHaveText("950,00 PLN");
    await expect(manual.locator("td").nth(3)).toHaveText(/2026-09-30\s*manual/);
    // Retail bond: its interest rate instead of a market price, the previous year's rate in "1 year"
    const edo = page.getByTestId("price-EDO0935");
    await expect(edo.locator("td").nth(2)).toHaveText("5,00 % p.a.");
    await expect(edo.locator("td").nth(3)).toHaveText("calculated");
    await expect(edo.locator("td").nth(4)).toHaveText("6,00 % before");
    const ds = page.getByTestId("price-DS0432");
    await expect(ds.locator("td").nth(2)).toHaveText(/^\d+,\d{2} %$/); // clean price, % of nominal
    await expect(ds.locator("td").nth(3)).toHaveText(/^\d{4}-\d{2}-\d{2}/);
    await expect(ds.locator("td").nth(4)).toHaveText(/%$/);

    await ds.click();
    await expect(page).toHaveURL(/#\/prices\?chart=PL0000113783$/);
    await expect(page.getByTestId("price-title")).toContainText("DS0432");
    await expect(page.getByTestId("price-chart").locator("path.recharts-line-curve")).toHaveCount(1);
    await ds.click(); // click again: chart closes
    await expect(page.getByTestId("price-title")).toHaveCount(0);

    // Retail bond: the chart is its calculated value per bond
    await page.getByTestId("price-EDO0935").click();
    await expect(page.getByTestId("price-title")).toContainText("value per bond, PLN (calculated");
    await expect(page.getByTestId("price-chart").locator("path.recharts-line-curve")).toHaveCount(1);
  });
});
