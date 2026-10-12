import { expect, test } from "@playwright/test";

// Views against the sample data: accounts "broker" (DS0432, IZ0836), "ike" (DS0432, EDO0935, SAMPLE-APARTMENT),
// "foreign" (SPXS, an ETF in EUR) and "etf" (incomplete: cash only).

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
    await expect(rows).toHaveCount(16);
    const dates = await rows.locator("td:first-child").allTextContents();
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(rows.first()).toContainText("2026-09-30");
    await expect(page.getByTestId("filters-summary")).toHaveText("16 of 16 transactions");
  });

  test("filters by instrument, account and asset type, and keeps filters in the URL", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(16);

    await page.getByTestId("filter-instrument").selectOption({ label: "DS0432" });
    await expect(rows).toHaveCount(4); // broker: buy + 2 coupons, ike: buy
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/instrument=PL0000113783/);
    await expect(page).toHaveURL(/account=ike/);

    await page.reload();
    await expect(rows).toHaveCount(1);

    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(16);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(5); // the deposits
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
    expect(groupOrder).toEqual(["account-broker", "account-etf", "account-foreign", "account-ike"]);
    // each account ends with its cash; the incomplete account shows only cash, greyed, with a note
    await expect(table.locator('tr[data-testid="cash-row"][data-account="broker"]')).toContainText("5420,86");
    await expect(page.getByTestId("account-etf").getByTestId("incomplete")).toContainText("ETFs not tracked yet");
    await expect(table.locator('tr[data-testid="cash-row"][data-account="etf"]')).toHaveClass(/muted/);
    const broker = table.locator('tr[data-testid="holding-row"][data-account="broker"]');
    await expect(broker).toHaveCount(2);
    expect(await broker.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "IZ0836"]);
    await expect(broker.nth(0).locator("td").nth(4)).toHaveText(/^\d+,\d{2}$/); // accrued interest per bond
    await expect(broker.nth(1).locator("td").nth(4)).toHaveText(/^\d+,\d{2}$/);
    const ike = table.locator('tr[data-testid="holding-row"][data-account="ike"]');
    await expect(ike).toHaveCount(3);
    expect(await ike.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "EDO0935", "SAMPLE-APARTMENT"]);
    await expect(ike.first().locator("td").nth(2)).toHaveText("5");
    await expect(ike.nth(1).locator("td").nth(1)).toHaveText("Retail bond");
  });

  test("filters by account and asset type", async ({ page }) => {
    await page.goto("/#/holdings");
    const rows = page.getByTestId("holding-row");
    await expect(rows).toHaveCount(6);
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId("account-broker")).toHaveCount(0);
    await expect(page.getByTestId("filters-summary")).toHaveText("3 of 6 holdings");
    await page.getByTestId("filters-reset").click();
    await page.getByTestId("filter-type").selectOption({ label: "Listed bond" });
    await expect(rows).toHaveCount(3);
    await page.getByTestId("filter-type").selectOption({ label: "Retail bond" });
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-type").selectOption({ label: "ETF" });
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("cash-row")).toHaveCount(4);
  });
});

test.describe("prices view", () => {
  test("lists held instruments with price, date and 1-year change; a click shows the chart", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-prices").click();
    await expect(page).toHaveURL(/#\/prices$/);
    const rows = page.getByTestId("prices-table").locator("tbody tr");
    await expect(rows).toHaveCount(5);
    expect(await rows.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "EDO0935", "IZ0836", "SAMPLE-APARTMENT", "SPXS"]);
    await expect(page.getByTestId("price-SPXS").locator("td").nth(2)).toHaveText(/^\d+,\d{2} EUR$/); // ETF: in its currency
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

    // Transactions as markers: the sample BUY of IZ0836 on 2025-06-10 falls inside the full range
    await page.getByTestId("price-IZ0836").click();
    await page.getByTestId("price-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("price-chart").locator(".recharts-reference-dot")).toHaveCount(1);

    // Retail bond: the chart is its calculated value per bond
    await page.getByTestId("price-EDO0935").click();
    await expect(page.getByTestId("price-title")).toContainText("value per bond, PLN (calculated");
    await expect(page.getByTestId("price-chart").locator("path.recharts-line-curve")).toHaveCount(1);
  });
});

test.describe("holdings grouped by instrument", () => {
  test("groups by instrument with one row per account, cash last; the choice is in the URL and works with filters", async ({ page }) => {
    await page.goto("/#/holdings");
    await page.getByTestId("group-by").getByRole("button", { name: "Instrument" }).click();
    await expect(page).toHaveURL(/group=instrument/);
    const table = page.getByTestId("holdings-by-account");
    await expect(page.getByTestId("instrument-cash")).toBeVisible(); // data loaded
    const order = await table.locator("tr.group").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(order).toEqual(["instrument-DS0432", "instrument-EDO0935", "instrument-IZ0836", "instrument-SAMPLE-APARTMENT", "instrument-SPXS", "instrument-cash"]);

    // DS0432 is held in two accounts: 20 + 5
    const ds = page.getByTestId("instrument-DS0432");
    await expect(ds.locator("td").nth(2)).toHaveText("25");
    const dsRows = page.getByTestId("holding-row").filter({ has: page.locator("td:first-child", { hasText: /^(broker|ike)$/ }) });
    await expect(dsRows.first()).toBeVisible();
    // cash: one row per account, the incomplete one greyed
    await expect(page.getByTestId("cash-row")).toHaveCount(4);
    await expect(table.locator('tr[data-testid="cash-row"][data-account="etf"]')).toHaveClass(/muted/);

    await page.reload();
    await expect(page.getByTestId("instrument-cash")).toBeVisible();
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(page).toHaveURL(/group=instrument/);
    await expect(page.getByTestId("instrument-DS0432").locator("td").nth(2)).toHaveText("5");
    await expect(page.getByTestId("instrument-IZ0836")).toHaveCount(0); // not held in ike

    await page.getByTestId("group-by").getByRole("button", { name: "Account" }).click();
    await expect(page.getByTestId("account-ike")).toBeVisible();
    await expect(page).not.toHaveURL(/group=/);
  });
});

test.describe("holdings row chart", () => {
  test("clicking a row docks its value chart at the bottom; resizable, remembered, closable", async ({ page }) => {
    await page.goto("/#/holdings");
    const row = page.locator('tr[data-testid="holding-row"][data-account="broker"][data-isin="PL0000113783"]');
    await row.click();
    await expect(page).toHaveURL(/chart=PL0000113783&chartAccount=broker/);
    await expect(row).toHaveClass(/selected/);
    const panel = page.getByTestId("chart-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("chart-panel-title")).toContainText("DS0432");
    await expect(page.getByTestId("chart-panel-title")).toContainText("broker");
    await expect(page.getByTestId("holding-chart").locator("path.recharts-area-area")).toHaveCount(2); // value + cost
    await expect(page.getByTestId("holdings-by-account")).toBeVisible(); // the list stays visible above

    // default: a third of the window; dragging the handle up makes it taller, and it's remembered
    const before = (await panel.boundingBox())!.height;
    expect(before).toBeGreaterThan(250);
    expect(before).toBeLessThan(350);
    const handle = (await page.getByTestId("chart-panel-handle").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 200, { steps: 5 });
    await page.mouse.up();
    const after = (await panel.boundingBox())!.height;
    expect(after).toBeGreaterThan(before + 150);
    await page.reload();
    await expect(page.getByTestId("chart-panel")).toBeVisible();
    expect(Math.abs((await page.getByTestId("chart-panel").boundingBox())!.height - after)).toBeLessThan(5);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chart-panel")).toHaveCount(0);
    await expect(page).not.toHaveURL(/chart=/);
    await page.evaluate(() => window.localStorage.removeItem("portfolio-tracker.chartPanel.height"));
  });

  test("grouped by instrument, the group row charts the instrument across accounts", async ({ page }) => {
    await page.goto("/#/holdings?group=instrument");
    await page.getByTestId("instrument-DS0432").click();
    await expect(page).toHaveURL(/chart=PL0000113783/);
    await expect(page).not.toHaveURL(/chartAccount=/);
    await expect(page.getByTestId("chart-panel-title")).toContainText("all accounts");
    await expect(page.getByTestId("holding-chart").locator("path.recharts-area-area")).toHaveCount(2);
    await page.getByTestId("chart-panel-close").click();
    await expect(page.getByTestId("chart-panel")).toHaveCount(0);
  });
});

test.describe("indicators view", () => {
  test("lists CPI m/m and the reference index; a click shows the chart, its range in the URL", async ({ page }) => {
    await page.goto("/#/indicators");
    await expect(page.getByTestId("nav-indicators")).toHaveAttribute("aria-current", "page");
    const mom = page.getByTestId("indicator-cpi-mom");
    await expect(mom).toContainText("Inflation, month on month");
    await expect(mom.locator("td").nth(2)).toHaveText(/^\d{4}-\d{2}$/); // the latest month
    await expect(page.getByTestId("indicator-cpi-index")).toContainText("CPI reference index");

    await mom.click();
    await expect(page).toHaveURL(/#\/indicators\?chart=cpi-mom$/);
    await expect(mom).toHaveClass(/selected/);
    await expect(page.getByTestId("indicator-title")).toContainText("Inflation, month on month");
    await expect(page.getByTestId("indicator-chart")).toHaveAttribute("data-points", "60"); // 5Y default: 60 months
    await expect(page.getByTestId("indicator-chart").locator(".recharts-bar-rectangle").first()).toBeVisible(); // (a 0.0 % month draws no bar)

    await page.getByTestId("indicator-range").getByRole("button", { name: "1Y" }).click();
    await expect(page).toHaveURL(/range=1Y/);
    await expect(page.getByTestId("indicator-chart")).toHaveAttribute("data-points", "12");

    await page.getByTestId("indicator-cpi-index").click();
    await expect(page).toHaveURL(/chart=cpi-index/);
    await expect(page.getByTestId("indicator-chart").locator("path.recharts-line-curve")).toHaveCount(1);

    // Exchange rates: their own group, daily NBP rates as a line
    await expect(page.getByTestId("indicator-group-Exchange rates")).toBeVisible();
    const eur = page.getByTestId("indicator-fx-eur");
    await expect(eur).toContainText("EUR/PLN");
    await expect(eur.locator("td").nth(1)).toHaveText(/^\d,\d{4}$/);
    await expect(eur.locator("td").nth(2)).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await eur.click();
    await expect(page).toHaveURL(/chart=fx-eur/);
    await expect(page.getByTestId("indicator-chart").locator("path.recharts-line-curve")).toHaveCount(1);
    await expect.poll(async () => Number(await page.getByTestId("indicator-chart").getAttribute("data-points"))).toBeGreaterThan(240); // ~250 business days in 1Y
  });
});
