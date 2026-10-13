import { expect, test } from "@playwright/test";

// Runs against the dev stage data: data/instruments.json + data/transactions.sample.json imported.

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the valuation date and totals", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio Tracker");
    await expect(page.getByTestId("snapshot-date")).toHaveText(/Valuation as of \d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("total-deposits")).toContainText("66 403,69 zł");
    await expect(page.getByTestId("total-profit")).toContainText("%");
    await expect(page.getByTestId("total-profit")).toContainText("XIRR");
    // Where the profit comes from: the parts add up to it
    await expect(page.getByTestId("profit-income")).toContainText("1 016,70 zł"); // coupons, the manual asset's income, the closed account's interest
    const num = (t: string) => Number(t.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", "."));
    const profit = num((await page.getByTestId("total-profit").locator(".value").textContent())!);
    const parts = await page.getByTestId("profit-breakdown").locator(".value").allTextContents();
    expect(parts).toHaveLength(5);
    expect(Math.abs(parts.reduce((s, t) => s + num(t), 0) - profit)).toBeLessThan(0.02);
    // Cash: bonds + broker + foreign + ibkr + ike (8 597,39) + eur (its EUR and USD at today's rate); the incomplete
    // "etf" account is left out and the card says so
    await expect(page.getByTestId("total-cash")).toContainText(/\d\s\d{3},\d{2}\s*zł/);
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
    await expect(page.getByTestId("total-all")).toBeVisible();
    await expect(page.getByTestId("holdings-table")).toHaveCount(0);
    await expect(page.getByTestId("price-chart")).toHaveCount(0);
  });

  test("lists the accounts with net deposits, profit and XIRR; the incomplete one greyed and outside the total", async ({ page }) => {
    const rows = page.getByTestId("account-row");
    await expect(rows).toHaveCount(7);
    expect(await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-account")))).toEqual(["bonds", "broker", "etf", "eur", "foreign", "ibkr", "ike"]);
    // An account kept in EUR: a second line in EUR (deposits as made, 5 000 PLN at 4.2543 + 100 EUR)
    const base = page.locator('tr[data-testid="account-base-row"][data-account="eur"]');
    await expect(base.locator("td").nth(0)).toHaveText("└ in EUR");
    await expect(base.locator("td").nth(1)).toHaveText("1 275,28 EUR");
    const broker = page.locator('tr[data-testid="account-row"][data-account="broker"]');
    await expect(broker.locator("td").nth(1)).toHaveText("30 000,00 zł"); // net deposits
    await expect(broker.locator("td").nth(4)).toHaveText(/zł$/); // unrealised
    await expect(broker.locator("td").nth(5)).toHaveText(/^0,00\s*zł$/); // realised: nothing sold
    await expect(broker.locator("td").nth(6)).toHaveText(/%$/); // XIRR
    await expect(page.locator('tr[data-testid="account-row"][data-account="etf"]')).toHaveClass(/muted/);
    await expect(page.getByTestId("accounts-total").locator("td").nth(1)).toHaveText("66 403,69 zł"); // incl. the closed account's −20, and eur: 5 000 + 100 EUR at 4.2369
  });

  test("folds closed accounts into one greyed row; they stay in the total", async ({ page }) => {
    const toggle = page.getByTestId("toggle-closed");
    await expect(toggle).toHaveText("▸ 1 closed account");
    const closed = page.locator('tr[data-testid="account-row"][data-account="closed"]');
    await expect(closed).toHaveCount(0);
    await toggle.click();
    await expect(closed).toHaveClass(/closed/);
    await expect(closed).toContainText("closed 2025-07-01");
    await expect(closed.locator("td").nth(1)).toHaveText(/^[-−]20,00\s*zł$/); // 1000 in, 1020 out
    await expect(closed.locator("td").nth(3)).toHaveText("0,00 zł"); // total
    await expect(closed.locator("td").nth(7)).toHaveText("20,00 zł"); // income: the interest (its whole profit)
    await toggle.click();
    await expect(closed).toHaveCount(0);
  });

  test("holds the space of loading parts with placeholders", async ({ page }) => {
    // Hold the API back: the placeholders show, then the real content replaces them.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/portfolio/history**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await expect(page.getByTestId("chart-skeleton")).toBeVisible();
    const box = await page.getByTestId("chart-skeleton").boundingBox();
    expect(box!.height).toBe(260);
    release();
    await expect(page.getByTestId("portfolio-chart")).toBeVisible();
    await expect(page.getByTestId("chart-skeleton")).toHaveCount(0);
    expect((await page.getByTestId("portfolio-chart").boundingBox())!.height).toBe(260);
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

  test("sums up the asset mix: shares, bonds, cash and other", async ({ page }) => {
    const mix = page.getByTestId("asset-mix");
    await expect(mix).toBeVisible();
    for (const k of ["SHARES", "BONDS", "CASH", "OTHER"]) await expect(page.getByTestId(`asset-mix-${k}`)).toBeVisible();
    await expect(page.getByTestId("asset-mix-SHARES")).toContainText("Shares"); // the ETF
    const shares = await mix.locator("li strong").allTextContents();
    const sum = shares.reduce((s, t) => s + Number(t.replace(/[^\d,]/g, "").replace(",", ".")), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
  });

  test("while a new range loads: buttons disabled, the chart dimmed with a spinner", async ({ page }) => {
    await expect(page.getByTestId("portfolio-chart").locator("svg.recharts-surface")).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/portfolio/history**", async (route) => {
      await gate;
      await route.continue();
    });
    const range = page.getByTestId("portfolio-range");
    await range.getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("chart-busy")).toBeVisible();
    await expect(range.getByRole("button", { name: "1M" })).toBeDisabled();
    await expect(range).toHaveAttribute("aria-busy", "true");
    release();
    await expect(page.getByTestId("chart-busy")).toHaveCount(0);
    await expect(range.getByRole("button", { name: "1M" })).toBeEnabled();
  });

  test("'Add transaction' is in the menu frame: it opens the form on any view", async ({ page }) => {
    for (const view of ["/", "/#/holdings", "/#/prices", "/#/indicators"]) {
      await page.goto(view);
      await page.getByTestId("tx-add").click();
      await expect(page.getByTestId("tx-form")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("tx-form")).toBeHidden();
    }
  });

  test("lists job runs", async ({ page }) => {
    const rows = page.getByTestId("jobs-table").locator("tbody tr");
    await expect(rows).toHaveCount(9);
    await expect(page.getByTestId("jobs-table")).toContainText("valuation");
    await expect(page.getByTestId("jobs-table")).toContainText("ok");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the menu opens from the ☰ button, navigates and closes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio Tracker");
    await expect(page.getByTestId("nav-holdings")).toBeHidden();
    await page.getByTestId("menu-toggle").click();
    await expect(page.getByTestId("menu-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("user-email")).toBeVisible();
    await page.getByTestId("nav-holdings").click();
    await expect(page).toHaveURL(/#\/holdings$/);
    await expect(page.getByTestId("nav-holdings")).toBeHidden();
    await page.getByTestId("menu-toggle").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-menu")).toBeHidden();
    await page.getByTestId("menu-toggle").click();
    await page.getByTestId("nav-backdrop").click({ position: { x: 200, y: 800 } });
    await expect(page.getByTestId("nav-menu")).toBeHidden();
  });

  test("'Add transaction' is a + next to the menu button", async ({ page }) => {
    await page.goto("/");
    const add = page.getByTestId("tx-add");
    await expect(add).toBeVisible();
    await expect(add).toHaveText("+", { useInnerText: true }); // the label is hidden on a phone
    await add.click();
    await expect(page.getByTestId("tx-form")).toBeVisible();
  });

  test("a row chart opens at half the screen height", async ({ page }) => {
    await page.goto("/#/holdings");
    await page.evaluate(() => window.localStorage.removeItem("portfolio-tracker.chartPanel.height.phone"));
    await page.getByTestId("holding-row").first().click();
    const box = await page.getByTestId("chart-panel").boundingBox();
    expect(Math.abs(box!.height - 844 / 2)).toBeLessThan(2);
  });

  test("summary figures fit their cards; the chart spans the width", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("total-all")).not.toContainText("–");
    const overflowing = await page.locator(".card .value").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(overflowing).toBe(0);
    const chart = page.getByTestId("portfolio-chart");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
    const plot = await chart.locator(".recharts-cartesian-grid").boundingBox();
    const frame = await chart.boundingBox();
    expect(plot!.x - frame!.x).toBeLessThan(4); // no column for the axis labels: they sit inside the plot
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
