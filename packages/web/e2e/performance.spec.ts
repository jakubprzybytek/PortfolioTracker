import { expect, test } from "@playwright/test";

// Runs against the dev stage data: data/instruments.json + data/transactions.sample.json imported.

test.describe("performance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/performance");
  });

  test("is in the menu after the Dashboard; the range is in the URL", async ({ page }) => {
    await expect(page.getByTestId("nav-performance")).toHaveAttribute("aria-current", "page");
    const items = await page.locator("#nav-menu ul a").evaluateAll((as) => as.map((a) => a.getAttribute("data-testid")));
    expect(items.slice(0, 2)).toEqual(["nav-dashboard", "nav-performance"]);
    const range = page.getByTestId("performance-range");
    await expect(range.getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
    await range.getByRole("button", { name: "ALL" }).click();
    await expect(page).toHaveURL(/#\/performance\?range=ALL$/);
    await page.reload();
    await expect(page.getByTestId("performance-range").getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
  });

  test("renders the drawdown and the allocation over time, following the range", async ({ page }) => {
    const dd = page.getByTestId("drawdown-chart");
    await expect(dd.locator("path.recharts-area-area")).toHaveCount(1);
    const alloc = page.getByTestId("allocation-chart");
    await expect(alloc.locator("path.recharts-area-area").first()).toBeVisible();
    expect(await alloc.locator("path.recharts-area-area").count()).toBeGreaterThanOrEqual(3); // shares, bonds, cash (and other)
    await page.getByTestId("performance-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("performance-range")).toHaveAttribute("aria-busy", "false");
    await expect(dd.locator("path.recharts-area-area")).toHaveCount(1);
    // side by side on a computer, at the same height
    const [a, b] = [(await dd.boundingBox())!, (await alloc.boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    // y axis of the drawdown: from 0 % down, nothing above it
    const ticks = dd.locator(".recharts-yAxis-tick-labels text");
    await expect(ticks.first()).toBeVisible();
    const labels = (await ticks.allTextContents()).map((t) => t.replace(/\s/g, " "));
    expect(labels).toContain("0 %");
    expect(labels.every((t) => t === "0 %" || /^[-−]/.test(t))).toBe(true);
  });

  test("returns by year against inflation: the table, the bars per year and the growth of 100 zł", async ({ page }) => {
    const rows = page.getByTestId("years-row");
    await expect(rows.first()).toBeVisible();
    // Newest first; the sample starts in February 2025: that year and the year so far are parts of a year.
    await expect(rows.last()).toHaveAttribute("data-year", "2025");
    await expect(rows.last()).toContainText("from 2025-02-03");
    await expect(rows.first()).toHaveClass(/partial/);
    for (const id of ["years-twr", "years-inflation", "years-real", "years-xirr"]) await expect(rows.last().getByTestId(id)).toHaveText(/\d %/);
    await expect(page.getByTestId("years-total")).toContainText("a year, since 2025-02");
    // One pair of bars per year, the real return as a dot
    const bars = page.getByTestId("years-chart");
    expect(await bars.locator(".recharts-bar-rectangle").count()).toBe(2 * (await rows.count()));
    await expect(bars.locator(".recharts-scatter circle").first()).toBeVisible();
    // Growth of 100 zł: two lines from 100 at the start of the range
    const growth = page.getByTestId("growth-chart");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(2);
    await expect(page.getByTestId("returns-pair").locator(".chart-key").last()).toContainText("Inflation (CPI)");
    await page.getByTestId("performance-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("performance-range")).toHaveAttribute("aria-busy", "false");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(2);
  });

  test("holds the charts' space while loading; a new range dims the three charts that follow it", async ({ page }) => {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    await page.route(/\/portfolio\/(history|years)/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByTestId("chart-skeleton")).toHaveCount(4); // return and inflation, growth of 100 zł, drawdown, allocation over time
    release();
    await expect(page.getByTestId("growth-chart")).toBeVisible();
    await expect(page.getByTestId("chart-skeleton")).toHaveCount(0);
    gate = new Promise<void>((r) => (release = r));
    const range = page.getByTestId("performance-range");
    await range.getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("chart-busy")).toHaveCount(3); // growth of 100 zł, drawdown, allocation over time (the years don't depend on it)
    await expect(range.getByRole("button", { name: "1M" })).toBeDisabled();
    release();
    await expect(page.getByTestId("chart-busy")).toHaveCount(0);
  });
});

test.describe("performance on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("returns by year: three columns that fit the screen, inflation under the return; the header fits too", async ({ page }) => {
    await page.goto("/#/performance");
    const table = page.getByTestId("years-table");
    await expect(page.getByTestId("years-row").first()).toBeVisible();
    await expect(table.locator("thead th")).toHaveCount(3);
    await expect(page.getByTestId("years-row").first().getByTestId("years-twr")).toContainText("infl.");
    const wrap = page.getByTestId("years");
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("status", () => {
  test("a failed job's warning on the Dashboard links to the Status page", async ({ page }) => {
    await page.route("**/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ now: new Date().toISOString(), jobs: { valuation: { status: "failed", finishedAt: "2026-10-21T06:00:00Z", note: "test failure" } } }),
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId("job-errors")).toContainText("valuation");
    await page.getByTestId("job-errors").getByRole("link", { name: "Status" }).click();
    await expect(page).toHaveURL(/#\/status$/);
    await expect(page.getByTestId("job-valuation")).toContainText("failed");
  });
});
