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
    // XIRR has its own card, equal to the Accounts table's total
    await expect(page.getByTestId("total-xirr").locator(".value")).toHaveText(/%$/);
    await expect(page.getByTestId("total-xirr")).toContainText("money-weighted");
    const xirrCell = page.getByTestId("accounts-total").locator("td").nth(6);
    await expect(xirrCell).toHaveText(/%$/);
    await expect(page.getByTestId("total-xirr").locator(".value")).toHaveText((await xirrCell.textContent())!);
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
    // The cards stay compact: their note line isn't styled as a note of the Notes view (padding, 200 px tall)
    const card = await page.getByTestId("total-all").boundingBox();
    expect(card!.height).toBeLessThan(140);
    const note = page.getByTestId("total-all").locator(".note");
    expect(await note.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  });

  test("renders the portfolio chart and switches ranges", async ({ page }) => {
    const chart = page.getByTestId("portfolio-chart");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
    await expect(chart.locator("path.recharts-area-area")).toHaveCount(2);
    await page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();
  });

  test("renders the drawdown and the allocation over time, following the range", async ({ page }) => {
    const dd = page.getByTestId("drawdown-chart");
    await expect(dd.locator("path.recharts-area-area")).toHaveCount(1);
    const alloc = page.getByTestId("allocation-chart");
    await expect(alloc.locator("path.recharts-area-area").first()).toBeVisible();
    expect(await alloc.locator("path.recharts-area-area").count()).toBeGreaterThanOrEqual(3); // shares, bonds, cash (and other)
    await page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("portfolio-range")).toHaveAttribute("aria-busy", "false");
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
    await page.getByTestId("portfolio-range").getByRole("button", { name: "ALL" }).click();
    await expect(page.getByTestId("portfolio-range")).toHaveAttribute("aria-busy", "false");
    await expect(growth.locator("path.recharts-line-curve")).toHaveCount(2);
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
    await expect(page.getByTestId("accounts-total").locator("td").nth(1)).toHaveText("66 403,69 zł");
    await expect(page.getByTestId("accounts-total").locator("td").first()).toHaveText("Total (fully tracked accounts)"); // "etf" isn't // incl. the closed account's −20, and eur: 5 000 + 100 EUR at 4.2369
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
    await page.route(/\/portfolio\/(history|years)/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await expect(page.getByTestId("chart-skeleton")).toHaveCount(5); // value, drawdown, allocation over time, return and inflation, growth of 100 zł
    const box = await page.getByTestId("chart-skeleton").first().boundingBox();
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

  test("targets in the asset mix: set them, the legend compares, Rebalance folds out new money and sell and buy; then remove them", async ({ page }) => {
    const num = (t: string) => Number(t.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", ".") || 0);
    const signed = (t: string) => (t.startsWith("sell") ? -num(t) : num(t));
    const classes = ["SHARES", "BONDS", "CASH", "OTHER"];
    const edit = page.getByTestId("targets-edit");
    // Start without targets (a run before may have left them)
    await expect(edit).toBeVisible();
    if ((await edit.textContent()) === "Edit targets") {
      await edit.click();
      await page.getByTestId("targets-remove").click();
    }
    await expect(edit).toHaveText("Set targets");
    await expect(page.locator(".mix-target")).toHaveCount(0);
    await expect(page.getByTestId("targets-rebalance")).toHaveCount(0);

    // The form, in the panel: the targets must add up to 100 %
    await edit.click();
    await page.getByTestId("targets-SHARES-target").fill("60");
    await page.getByTestId("targets-BONDS-target").fill("35");
    await page.getByTestId("targets-CASH-target").fill("4");
    await expect(page.getByTestId("targets-sum")).toHaveText("99 %");
    await expect(page.getByTestId("targets-save")).toBeDisabled();
    await page.getByTestId("targets-CASH-target").fill("5");
    await expect(page.getByTestId("targets-sum")).toHaveText("100 % ✓");
    await page.getByTestId("targets-save").click();

    // The legend: each class's share, its target and the difference; ticks on the bar where shares' and bonds' targets end
    await expect(page.getByTestId("asset-mix-SHARES-target")).toHaveText("of 60 %");
    await expect(page.getByTestId("asset-mix-SHARES-diff")).toHaveText(/^[+−]\d+,\d\spp$/);
    await expect(page.locator(".mix-target")).toHaveCount(2);
    const shares = await page.getByTestId("asset-mix").locator("li strong").allTextContents();
    expect(Math.abs(shares.reduce((s, t) => s + num(t), 0) - 100)).toBeLessThan(0.5);

    // Rebalance folds out (closed until opened, then remembered)
    const toggle = page.getByTestId("targets-rebalance");
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await expect(page.getByTestId("targets")).toHaveCount(0);
    await toggle.click();
    await expect(page.getByTestId("targets-table")).toBeVisible();
    await expect(page.getByTestId("targets-mode").getByRole("button", { name: "New money" })).toHaveAttribute("aria-pressed", "true");
    for (const k of classes) await expect(page.getByTestId(`targets-${k}-trade`)).toHaveText("–");
    await page.reload();
    await expect(page.getByTestId("targets-table")).toBeVisible();

    // New money: only buys, adding up to the amount
    await page.getByTestId("targets-amount").fill("10 000");
    await expect.poll(async () => (await Promise.all(classes.map((k) => page.getByTestId(`targets-${k}-trade`).textContent()))).reduce((s, t) => s + signed(t!), 0)).toBeCloseTo(10_000, 1);
    for (const k of classes) expect(await page.getByTestId(`targets-${k}-trade`).textContent()).not.toMatch(/^sell/);

    // Sell and buy: the sales pay for the buys, every class ends on target
    await page.getByTestId("targets-mode").getByRole("button", { name: "Sell and buy" }).click();
    await expect(page.getByTestId("targets-amount")).toHaveCount(0);
    const trades = await Promise.all(classes.map((k) => page.getByTestId(`targets-${k}-trade`).textContent()));
    expect(Math.abs(trades.reduce((s, t) => s + signed(t!), 0))).toBeLessThan(0.05);
    await expect(page.getByTestId("targets-SHARES-after")).toHaveText("60,0 %of 60 %");

    // On a phone the panel fits the screen, also in a wide font (Linux's DejaVu Sans is much wider than Segoe UI); one
    // class per legend line; the switch and the amount share one row
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({ content: "* { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }" });
    const box = (await page.getByTestId("asset-mix").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.getByTestId("asset-mix").evaluate((p) => p.scrollWidth <= p.clientWidth + 1)).toBe(true);
    expect(await page.getByTestId("targets-table").evaluate((t) => t.scrollWidth <= t.parentElement!.clientWidth + 1)).toBe(true);
    const [a, b] = [(await page.getByTestId("asset-mix-SHARES").boundingBox())!, (await page.getByTestId("asset-mix-BONDS").boundingBox())!];
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    await page.getByTestId("targets-mode").getByRole("button", { name: "New money" }).click();
    const [mode, amount] = [(await page.getByTestId("targets-mode").boundingBox())!, (await page.getByTestId("targets-amount").boundingBox())!];
    expect(Math.abs(mode.y + mode.height / 2 - (amount.y + amount.height / 2))).toBeLessThan(4);

    // Remove them again
    await page.getByTestId("targets-edit").click();
    await page.getByTestId("targets-remove").click();
    await expect(page.getByTestId("targets-edit")).toHaveText("Set targets");
    await expect(page.getByTestId("asset-mix-SHARES-target")).toHaveCount(0);
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
    await expect(page.getByTestId("chart-busy")).toHaveCount(4); // the four charts share the range (value, drawdown, allocation, growth of 100 zł)
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

  test("'Update prices' starts the live prices and shows the progress, or why not now", async ({ page }) => {
    // Mocked: a real refresh revalues today, and the API allows one every 5 minutes.
    let answer = { status: 202, body: { now: new Date().toISOString() } as object };
    await page.route("**/prices/refresh", (route) => route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) }));
    await page.goto("/");
    const button = page.getByTestId("refresh-prices");
    await button.click();
    await expect(page.getByTestId("recalc")).toHaveText("Fetching today's prices…");
    await expect(button).toBeDisabled();
    await page.reload();
    answer = { status: 429, body: { error: "Prices were refreshed less than 5 minutes ago." } };
    await page.getByTestId("refresh-prices").click();
    await expect(page.getByTestId("tx-toast")).toHaveText("Prices were refreshed less than 5 minutes ago.");
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
    // One row: logo, + and ☰ (nothing else in the bar pushes ☰ onto a second row).
    const [brand, plus, menu] = await Promise.all([page.locator("h1.brand").boundingBox(), add.boundingBox(), page.getByTestId("menu-toggle").boundingBox()]);
    expect(Math.abs(plus!.y - menu!.y)).toBeLessThan(2);
    expect(menu!.y).toBeLessThan(brand!.y + brand!.height);
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

  test("returns by year: three columns that fit the screen, inflation under the return", async ({ page }) => {
    await page.goto("/");
    const table = page.getByTestId("years-table");
    await expect(page.getByTestId("years-row").first()).toBeVisible();
    await expect(table.locator("thead th")).toHaveCount(3);
    await expect(page.getByTestId("years-row").first().getByTestId("years-twr")).toContainText("inflation");
    const wrap = page.getByTestId("years");
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
});
