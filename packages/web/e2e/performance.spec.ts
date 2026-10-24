import { expect, test, type Page } from "@playwright/test";

type Bench = { id: string; label: string; short?: string; note: string; points: { date: string; value: number }[] };

/** Replaces the benchmarks in `GET /portfolio/years` (the stage may not have fetched any yet), made from the first day valued. */
async function withBenchmarks(page: Page, make: (first: string) => Bench[]) {
  await page.route(/\/portfolio\/years/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, benchmarks: make(body.total?.from ?? "2025-02-03") } });
  });
}

/** A value per day from `from` to today, growing `perDay` a day. */
function series(from: string, start: number, perDay: number) {
  const points: { date: string; value: number }[] = [];
  for (let d = new Date(`${from}T00:00:00Z`), v = start; d <= new Date(); d.setUTCDate(d.getUTCDate() + 1), v *= 1 + perDay) points.push({ date: d.toISOString().slice(0, 10), value: v });
  return points;
}

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

  test("two parts: by year (the whole history) and over time (with the range picker)", async ({ page }) => {
    const byYear = page.getByTestId("by-year");
    const overTime = page.getByTestId("over-time");
    await expect(byYear.getByTestId("years-table")).toBeVisible();
    await expect(byYear.getByTestId("years-chart")).toBeVisible();
    await expect(byYear.getByTestId("performance-range")).toHaveCount(0);
    await expect(overTime.getByTestId("performance-range")).toBeVisible();
    await expect(byYear.getByTestId("income-chart")).toBeVisible();
    for (const id of ["growth-chart", "drawdown-chart", "allocation-chart"]) await expect(overTime.getByTestId(id)).toBeVisible();
    // By year comes first
    expect((await byYear.boundingBox())!.y).toBeLessThan((await overTime.boundingBox())!.y);
  });

  test("income by year: coupons, dividends and interest stacked per year, next to return and inflation", async ({ page }) => {
    const chart = page.getByTestId("income-chart");
    await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.getByTestId("years-pair").locator(".chart-key").last()).toContainText("Coupons");
    // Side by side with the yearly bars
    const [a, b] = [(await page.getByTestId("years-chart").boundingBox())!, (await chart.boundingBox())!];
    expect(b.x).toBeGreaterThan(a.x + a.width);
    await chart.locator(".recharts-bar-rectangle").first().hover();
    await expect(page.locator(".chart-tip").filter({ hasText: "Total" })).toBeVisible();
  });

  test("returns by year: Return right before the tinted benchmarks, under their own heading", async ({ page }) => {
    const table = page.getByTestId("years-table");
    await expect(page.getByTestId("years-row").first()).toBeVisible();
    const heads = await table.locator("thead tr:last-child th").evaluateAll((ths) => ths.filter((th) => (th as HTMLElement).offsetParent !== null).map((th) => th.textContent?.trim()));
    const i = heads.indexOf("Return");
    expect(heads.slice(i, i + 4)).toEqual(["Return", "WIG", "World", "40/60"]);
    await expect(table.locator("thead th.group-label")).toContainText("Benchmarks");
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("[data-testid=years-row] td.bench")).not.toBe(await bg("[data-testid=years-row] td.ret"));
  });

  test("returns by year against inflation: the table, the bars per year and the growth of 100 zł", async ({ page }) => {
    await withBenchmarks(page, () => []);
    await page.reload();
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
    // Growth of 100 zł: the portfolio, CPI and CPI + 2 % from 100 at the start of the range
    const growth = page.getByTestId("growth-chart");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(3);
    await expect(page.getByTestId("growth-panel").locator(".chart-key")).toContainText("Inflation +2 %");
    await expect(page.getByTestId("growth-panel").locator(".chart-key")).toContainText("Inflation (CPI)");
    await page.getByTestId("performance-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("performance-range")).toHaveAttribute("aria-busy", "false");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(3);
  });

  test("benchmarks: a line each on the growth of 100 zł and a column each in the returns by year", async ({ page }) => {
    // One from before the first day, one starting after it (no line, no returns before it starts).
    await withBenchmarks(page, (first) => {
      const late = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      return [
        { id: "WIG", label: "WIG", note: "test WIG", points: series(new Date(Date.parse(first) - 14 * 86_400_000).toISOString().slice(0, 10), 1000, 0.0005) },
        { id: "MSCI_WORLD", label: "MSCI World", short: "World", note: "test world", points: series(late, 50, 0) },
        { id: "MIX_40_60", label: "40/60 World/EDO", short: "40/60", note: "test mix", points: series(late, 100, 0) },
      ];
    });
    await page.reload();
    const table = page.getByTestId("years-table");
    await expect(table.locator("thead th").filter({ hasText: "WIG" })).toHaveCount(1);
    await expect(table.locator("thead th").filter({ hasText: "World" })).toHaveCount(1);
    await expect(table.locator("thead th").filter({ hasText: "40/60" })).toHaveCount(1);
    // Three benchmark columns still fit at 1280 px (the box doesn't scroll)
    const wrap = page.getByTestId("years");
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // A narrower screen drops the money columns and XIRR first; the benchmarks stay
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(table.locator("thead th").filter({ hasText: "40/60" })).toBeVisible();
    await expect(table.locator("thead th.col-start").first()).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    const oldest = page.getByTestId("years-row").last();
    await expect(oldest.getByTestId("years-bench-WIG")).toHaveText(/^\+\d.* %$/); // growing: positive
    await expect(oldest.getByTestId("years-bench-MSCI_WORLD")).toHaveText("–");
    await expect(page.getByTestId("years-total").getByTestId("years-bench-WIG")).toHaveText(/\d %/);
    const growth = page.getByTestId("growth-chart");
    await page.getByTestId("performance-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("performance-range")).toHaveAttribute("aria-busy", "false");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(4); // portfolio, CPI, CPI + 2 %, WIG (the other two start later)
    const key = page.getByTestId("growth-panel").locator(".chart-key");
    await expect(key).toContainText("WIG");
    await expect(key).not.toContainText("MSCI World");
    // Over the last month both have a value on the first day: both lines
    await page.getByTestId("performance-range").getByRole("button", { name: "1M" }).click();
    await expect(page.getByTestId("performance-range")).toHaveAttribute("aria-busy", "false");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(6);
    await expect(key).toContainText("MSCI World 100,00 zł");
  });

  test("holds the charts' space while loading; a new range dims the three charts that follow it", async ({ page }) => {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    await page.route(/\/portfolio\/(history|years)/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByTestId("chart-skeleton")).toHaveCount(5); // return and inflation, income, growth of 100 zł, drawdown, allocation over time
    // The table's header while loading is the loaded one (the benchmarks come from the fixed list), placeholders under each column
    const heads = page.getByTestId("years-table").locator("thead th");
    const visibleTexts = () => heads.evaluateAll((ths) => ths.filter((th) => (th as HTMLElement).offsetParent !== null).map((th) => th.textContent));
    const loadingHeads = await visibleTexts();
    const visibleCells = (sel: string) => page.locator(sel).first().evaluate((tr) => [...tr.children].filter((td) => (td as HTMLElement).offsetParent !== null).length);
    expect(await visibleCells("[data-testid=years-table] tbody tr.skeleton-row")).toBe(await visibleCells("[data-testid=years-table] thead tr:last-child"));
    release();
    await expect(page.getByTestId("years-row").first()).toBeVisible();
    expect(await visibleTexts()).toEqual(loadingHeads);
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

  test("returns by year: four columns that fit the screen (XIRR among them), inflation under the return; the header fits too", async ({ page }) => {
    await page.goto("/#/performance");
    const table = page.getByTestId("years-table");
    await expect(page.getByTestId("years-row").first()).toBeVisible();
    await expect(table.locator("thead th")).toHaveCount(4);
    await expect(page.getByTestId("years-row").first().getByTestId("years-xirr")).toBeVisible();
    await expect(page.getByTestId("years-row").first().getByTestId("years-twr")).toContainText("infl.");
    const wrap = page.getByTestId("years");
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("returns by year: a tap on a row opens what the wide table shows (money, inflation, benchmarks), a second tap closes it", async ({ page }) => {
    await page.goto("/#/performance");
    const row = page.getByTestId("years-row").first();
    await expect(row).toBeVisible();
    await expect(page.getByTestId("years-detail")).toHaveCount(0);
    await row.click();
    const detail = page.getByTestId("years-detail");
    await expect(detail).toHaveCount(1);
    await expect(row).toHaveAttribute("aria-expanded", "true");
    for (const label of ["Days", "Start", "Put in", "End", "Profit", "Inflation"]) await expect(detail.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    await expect(detail.getByTestId("years-detail-benchmarks").locator("dt")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // The whole history: its rates a year, and in all.
    await page.getByTestId("years-total").click();
    await expect(detail).toHaveCount(1);
    await expect(detail.locator("dt", { hasText: "Return in all" })).toBeVisible();
    await page.getByTestId("years-total").click();
    await expect(page.getByTestId("years-detail")).toHaveCount(0);
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
