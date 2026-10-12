import { expect, test } from "@playwright/test";

// Runs against the dev stage data: data/instruments.json + data/transactions.sample.json imported.

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the valuation date and totals", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio Tracker");
    await expect(page.getByTestId("snapshot-date")).toHaveText(/Valuation as of \d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("total-value")).toContainText("zł");
    await expect(page.getByTestId("total-value")).not.toContainText("–");
    await expect(page.getByTestId("total-gain")).toContainText("%");
    await expect(page.getByTestId("total-coupons")).toContainText("996,70"); // bond coupons (incl. the corporate bond's 70) + the manual asset's income
    // Cash: bonds + broker + foreign + ike; the incomplete "etf" account is left out and the card says so
    await expect(page.getByTestId("total-cash")).toContainText("7197,39");
    await expect(page.getByTestId("total-cash")).toContainText("1 incomplete account not included");
    await expect(page.getByTestId("total-all")).toContainText("zł");
  });

  test("renders the portfolio chart and switches ranges", async ({ page }) => {
    const chart = page.getByTestId("portfolio-chart");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
    await expect(chart.locator("path.recharts-area-area")).toHaveCount(2);
    await page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
  });

  test("shows totals, chart and jobs only (holdings and prices have their own views)", async ({ page }) => {
    await expect(page.getByTestId("total-value")).toBeVisible();
    await expect(page.getByTestId("holdings-table")).toHaveCount(0);
    await expect(page.getByTestId("price-chart")).toHaveCount(0);
  });

  test("lists the accounts with net deposits, profit and XIRR; the incomplete one greyed and outside the total", async ({ page }) => {
    const rows = page.getByTestId("account-row");
    await expect(rows).toHaveCount(5);
    expect(await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-account")))).toEqual(["bonds", "broker", "etf", "foreign", "ike"]);
    const broker = page.locator('tr[data-testid="account-row"][data-account="broker"]');
    await expect(broker.locator("td").nth(1)).toHaveText("30 000,00 zł"); // net deposits
    await expect(broker.locator("td").nth(6)).toHaveText(/%$/); // XIRR
    await expect(page.locator('tr[data-testid="account-row"][data-account="etf"]')).toHaveClass(/muted/);
    await expect(page.getByTestId("accounts-total").locator("td").nth(1)).toHaveText("51 000,00 zł");
  });

  test("shows the allocation by asset type and by currency", async ({ page }) => {
    await expect(page.getByTestId("alloc-type-CASH")).toContainText("Cash");
    await expect(page.getByTestId("alloc-type-ETF")).toBeVisible();
    await expect(page.getByTestId("alloc-type-BOND_CORPORATE")).toBeVisible();
    await expect(page.getByTestId("alloc-currency-PLN")).toBeVisible();
    await expect(page.getByTestId("alloc-currency-EUR")).toContainText(/\d+,\d+ %/);
    const shares = await page.getByTestId("alloc-type").locator(".alloc-pct").allTextContents();
    const sum = shares.reduce((s, t) => s + Number(t.replace(/[^\d,]/g, "").replace(",", ".")), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5); // one decimal each
  });

  test("lists job runs", async ({ page }) => {
    const rows = page.getByTestId("jobs-table").locator("tbody tr");
    await expect(rows).toHaveCount(9);
    await expect(page.getByTestId("jobs-table")).toContainText("valuation");
    await expect(page.getByTestId("jobs-table")).toContainText("ok");
  });
});
