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
    await expect(page.getByTestId("total-coupons")).toContainText("914,20");
  });

  test("lists the holdings with accrued interest and no data flags", async ({ page }) => {
    const ds = page.getByTestId("holding-DS0432");
    const iz = page.getByTestId("holding-IZ0836");
    await expect(ds).toBeVisible();
    await expect(iz).toBeVisible();
    await expect(ds.locator("td").nth(1)).toHaveText("25"); // 20 in "broker" + 5 in "ike", one row per instrument
    await expect(iz.locator("td").nth(1)).toHaveText("10");
    await expect(ds.locator("td").nth(3)).not.toHaveText("–"); // accrued interest
    await expect(iz.locator("td").nth(4)).toHaveText(/^9\d\d,\d\d$/); // value per bond ≈ 97x PLN (indexed nominal)
    await expect(page.locator(".flag")).toHaveCount(0);
  });

  test("sorts the table by clicking a header", async ({ page }) => {
    const firstCode = () => page.getByTestId("holdings-table").locator("tbody tr").first().locator("td").first().locator("strong").textContent();
    await expect(page.getByTestId("holdings-table").locator("tbody tr")).toHaveCount(2);
    await page.getByRole("columnheader", { name: /^Instrument/ }).click();
    expect(await firstCode()).toBe("DS0432");
    await page.getByRole("columnheader", { name: /^Instrument/ }).click();
    expect(await firstCode()).toBe("IZ0836");
  });

  test("renders the portfolio chart and switches ranges", async ({ page }) => {
    const chart = page.getByTestId("portfolio-chart");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
    await expect(chart.locator("path.recharts-area-area")).toHaveCount(2);
    await page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
  });

  test("selecting a holding shows its price chart with transaction markers", async ({ page }) => {
    await page.getByTestId("holding-IZ0836").click();
    await expect(page.getByTestId("price-title")).toContainText("IZ0836");
    const chart = page.getByTestId("price-chart");
    await expect(chart.locator("path.recharts-line-curve")).toHaveCount(1);
    await page.getByTestId("price-range").getByRole("button", { name: "ALL" }).click();
    // the sample BUY on 2025-06-10 falls inside the full range
    await expect(chart.locator(".recharts-reference-dot")).toHaveCount(1);
    await page.getByTestId("holding-DS0432").click();
    await expect(page.getByTestId("price-title")).toContainText("DS0432");
  });

  test("lists job runs", async ({ page }) => {
    const rows = page.getByTestId("jobs-table").locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(page.getByTestId("jobs-table")).toContainText("valuation");
    await expect(page.getByTestId("jobs-table")).toContainText("ok");
  });
});
