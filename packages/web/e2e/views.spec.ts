import { expect, test } from "@playwright/test";

// Views against the sample data: accounts "broker" (DS0432, IZ0836), "ike" (DS0432, EDO0935, SAMPLE-APARTMENT),
// "foreign" (SPXS, an ETF in EUR), "bonds" (KRU0827, a Catalyst bond), "ibkr" (EUR cash, a Bund) and "etf" (incomplete: cash only).

test.describe("navigation", () => {
  test("the side menu switches views and keeps the URL in sync", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("total-all")).toBeVisible();

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
    await expect(rows).toHaveCount(31);
    const dates = await rows.locator("td:first-child").allTextContents();
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(rows.first()).toContainText("2026-09-30");
    await expect(page.getByTestId("filters-summary")).toHaveText("31 of 31 transactions");
  });

  test("rows of one date share a background; the next date has the other one", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(31);
    const list = await rows.evaluateAll((trs) => trs.map((tr) => ({ date: tr.querySelector("td")!.textContent, band: tr.className.match(/band-(a|b)/)?.[1] })));
    expect(list[0]!.band).toBe("a");
    for (let i = 1; i < list.length; i++) {
      const same = list[i]!.date === list[i - 1]!.date;
      expect(list[i]!.band === list[i - 1]!.band, `${list[i]!.date} after ${list[i - 1]!.date}`).toBe(same);
    }
    const colors = await rows.evaluateAll((trs) => trs.slice(0, 2).map((tr) => getComputedStyle(tr.querySelector("td")!).backgroundColor));
    expect(colors[0]).not.toBe(colors[1]); // different dates (2026-09-30, 2026-06-01): visibly different
  });

  test("filters by instrument, account and asset type, and keeps filters in the URL", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(31);

    await page.getByTestId("filter-instrument").selectOption({ label: "DS0432" });
    await expect(rows).toHaveCount(4); // broker: buy + 2 coupons, ike: buy
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/instrument=PL0000113783/);
    await expect(page).toHaveURL(/account=ike/);

    await page.reload();
    await expect(rows).toHaveCount(1);

    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(31);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(14); // the 10 deposits, the closed account's interest and withdrawal, eur's 2 exchanges
    await expect(rows.first()).toContainText("Deposit");
    // A currency exchange shows both sides
    await page.getByTestId("filter-account").selectOption("eur");
    const exchange = rows.filter({ hasText: "Currency exchange" }).filter({ hasText: "2025-11-03" });
    await expect(exchange.getByTestId("tx-amount-cell")).toHaveText(/^-4\s?300,00\s*zł\s*→\s*1\s?000,00 EUR$/);
  });
});

test.describe("adding transactions", () => {
  test("adds, edits and deletes a transaction from the form", async ({ page }) => {
    // Dated far ahead in its own account, so no valuation day (and no other test) sees it meanwhile.
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row").first()).toBeVisible();
    await page.getByTestId("tx-add").click();
    const form = page.getByTestId("tx-form");
    await expect(form).toBeVisible();
    await page.getByTestId("tx-date").fill("2099-03-04");
    await page.getByTestId("tx-type").selectOption("DEPOSIT");
    await page.getByTestId("tx-account").selectOption("__new_account__");
    await page.getByTestId("tx-new-account").fill("e2e-test");
    await page.getByTestId("tx-amount").fill("250");
    await expect(page.getByTestId("tx-summary")).toContainText("Cash in e2e-test: 250,00 zł");
    await page.getByTestId("tx-note").fill("E2E test");
    await page.getByTestId("tx-save").click();
    await expect(form).toBeHidden();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction added.");
    const row = page.locator('tr[data-testid="transaction-row"]').filter({ hasText: "e2e-test" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("2099-03-04");
    await expect(row).toContainText("250,00 zł");

    // Edit: the form opens with its values; a new amount replaces the old.
    await row.click();
    await expect(page.getByTestId("tx-amount")).toHaveValue("250");
    await page.getByTestId("tx-amount").fill("300");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction updated.");
    await expect(row).toContainText("300,00 zł");

    // Delete, after confirming.
    await row.click();
    await page.getByTestId("tx-delete").click();
    await page.getByTestId("tx-delete-confirm").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction deleted.");
    await expect(row).toHaveCount(0);
  });

  test("suggests a bond buy's amount and finds a new treasury series by code; the server's objections show", async ({ page }) => {
    await page.goto("/#/transactions");
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("BUY");
    await page.getByTestId("tx-instrument").selectOption({ label: "DS0432 · Obligacje skarbowe DS0432 (stałe 1,75 %)" });
    await page.getByTestId("tx-quantity").fill("10");
    await page.getByTestId("tx-price").fill("80,5");
    await expect(page.getByTestId("tx-amount")).toHaveValue("8050"); // 10 × 80.5 % × 1000
    await page.getByTestId("tx-fee").fill("16,10");
    await expect(page.getByTestId("tx-summary")).toContainText("8 066,10 zł");

    await page.getByTestId("tx-instrument").selectOption("__new__");
    await page.getByTestId("tx-new-code").fill("EDO1036");
    await page.getByTestId("tx-lookup").click();
    await expect(page.getByTestId("tx-new-instrument")).toContainText("Obligacje skarbowe EDO1036 (emerytalne 10-letnie)");

    // Server-side check: a deposit with nothing in it.
    await page.getByTestId("tx-type").selectOption("DEPOSIT");
    await page.getByTestId("tx-amount").fill("0");
    await page.getByTestId("tx-amount").fill("");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-error")).toHaveText("Enter the amount");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tx-form")).toBeHidden();
  });
});

test.describe("adding transactions in other currencies", () => {
  test("in an account kept in EUR the form starts in EUR, a trade in its instrument's currency; an exchange shows both sides", async ({ page }) => {
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row").first()).toBeVisible();
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-account").selectOption("eur");
    await page.getByTestId("tx-type").selectOption("BUY");
    await page.getByTestId("tx-instrument").selectOption({ label: "DE0001102523 · DE Govt 0.0 Nov15'27 (sample holding)" });
    await expect(page.getByTestId("tx-currency")).toHaveValue("EUR");
    await expect(page.getByTestId("tx-fx")).toHaveCount(0); // paid in the bond's own currency: no rate
    await page.getByTestId("tx-quantity").fill("2");
    await page.getByTestId("tx-price").fill("96");
    await expect(page.getByTestId("tx-amount")).toHaveValue("1920"); // 2 × 96 % × 1000 EUR
    await expect(page.getByTestId("tx-summary")).toContainText("1 920,00 EUR");

    await page.getByTestId("tx-type").selectOption("EXCHANGE");
    await expect(page.getByTestId("tx-currency")).toHaveValue("EUR");
    await page.getByTestId("tx-amount").fill("100");
    await page.getByTestId("tx-to-currency").selectOption("USD");
    await page.getByTestId("tx-to-amount").fill("116");
    await expect(page.getByTestId("tx-summary")).toContainText("100,00 EUR");
    await expect(page.getByTestId("tx-summary")).toContainText("+116,00 USD");
    await page.getByTestId("tx-to-currency").selectOption("EUR");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-error")).toHaveText("Choose two different currencies");
    await page.keyboard.press("Escape");
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
    expect(groupOrder).toEqual(["account-bonds", "account-broker", "account-etf", "account-eur", "account-foreign", "account-ibkr", "account-ike"]);
    // each account ends with its cash; the incomplete account shows only cash, greyed, with a note
    await expect(table.locator('tr[data-testid="cash-row"][data-account="broker"]')).toContainText("5 420,86");
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
    // ibkr: the bond, then the PLN cash, then the foreign cash as cash (amount in EUR, the NBP rate as its price)
    const ibkr = await table.locator('tr[data-account="ibkr"]').evaluateAll((rows) => rows.map((r) => r.querySelector("td")!.textContent!.trim()));
    expect(ibkr).toEqual(["DE0001102523 DE Govt 0.0 Nov15'27 (sample holding)", "Cash", "Cash EUR"]);
    const eur = table.locator('tr[data-testid="holding-row"][data-isin="ZZWALUTYEUR0"]');
    await expect(eur.locator("td").nth(1)).toHaveText("Cash");
    await expect(eur.locator("td").nth(2)).toHaveText("80,96 EUR");
    await expect(eur.locator("td").nth(3)).toHaveText(/^\d,\d{4} PLN$/);
    // eur, an account in several currencies: a cash row per currency, each amount in it and its PLN value
    const eurCash = table.locator('tr[data-testid="cash-row"][data-account="eur"]');
    expect(await eurCash.evaluateAll((rows) => rows.map((r) => r.getAttribute("data-currency")))).toEqual(["EUR", "PLN", "USD"]); // its own currency first
    await expect(eurCash.nth(0).locator("td").nth(0)).toHaveText("Cash EUR");
    await expect(eurCash.nth(0).locator("td").nth(2)).toHaveText("116,75 EUR");
    await expect(eurCash.nth(2).locator("td").nth(2)).toHaveText("23,20 USD");
    await expect(eurCash.nth(1).locator("td").nth(5)).toHaveText("700,00 zł");
    // the bond bought in EUR: cost in PLN, as paid in EUR in its tooltip
    const bund = table.locator('tr[data-testid="holding-row"][data-account="eur"]');
    await expect(bund.locator("td").nth(6)).toHaveText("4 096,41 zł");
    await expect(bund.locator("td").nth(6)).toHaveAttribute("title", /963,25 EUR/);
  });

  test("keeps every row on one line: long names are cut, the full name in the tooltip", async ({ page }) => {
    await page.goto("/#/holdings");
    const row = page.locator('tr[data-testid="holding-row"][data-account="broker"]').nth(1); // IZ0836, a long name
    await expect(row.locator(".name")).toHaveAttribute("title", /indeksowane inflacją/);
    const heights = await page.getByTestId("holding-row").evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) + 2);
  });

  test("filters by account and asset type", async ({ page }) => {
    await page.goto("/#/holdings");
    const rows = page.getByTestId("holding-row");
    await expect(rows).toHaveCount(10);
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId("account-broker")).toHaveCount(0);
    await expect(page.getByTestId("filters-summary")).toHaveText("3 of 10 holdings");
    await page.getByTestId("filters-reset").click();
    await page.getByTestId("filter-type").selectOption({ label: "Listed bond" });
    await expect(rows).toHaveCount(3);
    await page.getByTestId("filter-type").selectOption({ label: "Retail bond" });
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-type").selectOption({ label: "ETF" });
    await expect(rows).toHaveCount(1);
    await page.getByTestId("filter-type").selectOption({ label: "Corporate bond" });
    await expect(rows).toHaveCount(1);
    // Cash: the PLN cash rows and the foreign cash (EUR at ibkr); no separate "Currency" type
    expect(await page.getByTestId("filter-type").locator("option").allTextContents()).not.toContain("Currency");
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-isin", "ZZWALUTYEUR0");
    await expect(page.getByTestId("cash-row")).toHaveCount(9); // 6 accounts in PLN, eur in PLN, EUR and USD
  });
});

test.describe("prices view", () => {
  test("lists held instruments with price, date and 1-year change; a click shows the chart", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-prices").click();
    await expect(page).toHaveURL(/#\/prices$/);
    const rows = page.getByTestId("prices-table").locator("tbody tr");
    await expect(rows).toHaveCount(7);
    expect(await rows.locator("td:first-child strong").allTextContents()).toEqual(["DE0001102523", "DS0432", "EDO0935", "IZ0836", "KRU0827", "SAMPLE-APARTMENT", "SPXS"]);
    await expect(page.getByTestId("price-KRU0827").locator("td").nth(2)).toHaveText(/^\d+,\d{2} %$/); // corporate bond: clean, % of nominal
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

  test("the chart docks in the resizable bottom panel; the list filters by asset type", async ({ page }) => {
    await page.goto("/#/prices");
    const rows = page.getByTestId("prices-table").locator("tbody tr");
    await expect(rows).toHaveCount(7);
    await page.getByTestId("price-SPXS").click();
    const panel = page.getByTestId("chart-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("prices-table")).toBeVisible(); // the list stays visible above
    await expect(page.getByTestId("price-title")).toContainText("close, EUR");
    await expect(page.getByTestId("price-chart").locator("path.recharts-line-curve")).toHaveCount(1);
    const before = (await panel.boundingBox())!.height;
    expect(before).toBeGreaterThan(250); // a third of the 900 px window
    expect(before).toBeLessThan(350);

    // filter by type: in the URL, keeps the open chart
    await page.getByTestId("filter-type").selectOption({ label: "Listed bond" });
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(/type=BOND_LISTED/);
    await expect(page).toHaveURL(/chart=IE00B3YCGJ38/);
    await expect(page.getByTestId("filters-summary")).toHaveText("2 of 7 instruments");
    await page.getByTestId("filter-type").selectOption({ label: "ETF" });
    await expect(rows).toHaveCount(1);
    await page.reload();
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("chart-panel")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chart-panel")).toHaveCount(0);
    await expect(page).not.toHaveURL(/chart=/);
    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(7);
  });

  test("an asset valued by hand takes a new value from its chart panel, and the value can be deleted", async ({ page }) => {
    await page.goto("/#/prices?chart=ZZSAMPLEAPA0");
    await expect(page.getByTestId("price-title")).toContainText("SAMPLE-APARTMENT");
    await page.getByTestId("manual-value-open").click();
    const list = page.getByTestId("manual-value-list");
    await expect(list).toContainText("2026-09-30");
    // Dated before the sample's latest value, so the valuation of today doesn't change.
    await page.getByTestId("manual-value-date").fill("2026-07-16");
    await page.getByTestId("manual-value-price").fill("930,5");
    await page.getByTestId("manual-value-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("SAMPLE-APARTMENT: value 930,50 PLN on 2026-07-16 saved");
    await expect(page.getByTestId("recalc")).toContainText("Recalculating the valuation"); // until a valuation run finishes
    await expect(list).toContainText("2026-07-16");
    await page.getByTestId("manual-value-delete-2026-07-16").click();
    await expect(page.getByTestId("manual-value-delete-2026-07-16")).toHaveText("Delete?");
    await page.getByTestId("manual-value-delete-2026-07-16").click();
    await expect(page.getByTestId("tx-toast")).toContainText("value of 2026-07-16 deleted");
    await expect(list).not.toContainText("2026-07-16");
    // A listed bond has a price source: no form.
    await page.goto("/#/prices?chart=PL0000113783");
    await expect(page.getByTestId("price-title")).toContainText("DS0432");
    await expect(page.getByTestId("manual-value-open")).toHaveCount(0);
  });

  test("a corporate bond's coupon periods replace its chart; a period is added, given a rate and deleted", async ({ page }) => {
    await page.goto("/#/prices?chart=PLKRK0000713");
    await expect(page.getByTestId("price-title")).toContainText("KRU0827");
    await page.getByTestId("coupon-periods-open").click();
    const table = page.getByTestId("coupon-periods");
    // The sample's periods (data/coupons.sample.json), newest first; the sample coupon fits its period's rate.
    const feb = table.locator('[data-testid="coupon-period"][data-start="2026-02-12"]');
    await expect(feb).toContainText("8,86 %");
    await expect(feb).toContainText("86,42 zł");
    await expect(feb.getByTestId("coupon-use-suggested")).toHaveCount(0);
    // A period far ahead (today's value stays as it is), then its rate, then gone.
    await page.getByTestId("coupon-add").click();
    await page.getByTestId("coupon-edit-start").fill("2032-01-01");
    await page.getByTestId("coupon-edit-end").fill("2032-04-01");
    await page.getByTestId("coupon-edit-paymentDate").fill("2032-04-01");
    await page.getByTestId("coupon-edit-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("KRU0827: period from 2032-01-01 saved");
    await page.getByTestId("coupon-future").click();
    const added = table.locator('[data-testid="coupon-period"][data-start="2032-01-01"]');
    await expect(added.getByTestId("coupon-rate")).toContainText("no rate");
    await added.getByTestId("coupon-edit").click();
    await page.getByTestId("coupon-edit-rate").fill("7,5");
    await page.getByTestId("coupon-edit-save").click();
    await expect(added.getByTestId("coupon-rate")).toContainText("7,50 %");
    await expect(added.getByTestId("coupon-rate")).toContainText("yours");
    await added.getByTestId("coupon-delete").click();
    await added.getByTestId("coupon-delete").click();
    await expect(page.getByTestId("tx-toast")).toContainText("period from 2032-01-01 deleted");
    await expect(added).toHaveCount(0);
    // Back to the chart.
    await page.getByTestId("coupon-periods-open").click();
    await expect(table).toHaveCount(0);
  });
});

test.describe("holdings grouped by instrument", () => {
  test("one row per instrument with its account; several accounts expand on demand; cash last; in the URL, works with filters", async ({ page }) => {
    await page.goto("/#/holdings");
    await page.getByTestId("group-by").getByRole("button", { name: "Instrument" }).click();
    await expect(page).toHaveURL(/group=instrument/);
    const table = page.getByTestId("holdings-by-account");
    await expect(page.getByTestId("instrument-cash")).toBeVisible(); // data loaded
    const order = await table.locator('tr[data-testid^="instrument-"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(order).toEqual(["instrument-DE0001102523", "instrument-DS0432", "instrument-EDO0935", "instrument-IZ0836", "instrument-KRU0827", "instrument-SAMPLE-APARTMENT", "instrument-SPXS", "instrument-cash", "instrument-EUR"]); // foreign cash after the PLN cash
    await expect(page.getByTestId("holding-row")).toHaveCount(0); // nothing expanded: one row per instrument

    // Held in one account: the account in its own column, no sub-rows
    await expect(page.getByTestId("instrument-IZ0836").locator("td").nth(1)).toHaveText("broker");
    await expect(page.getByTestId("instrument-SPXS").locator("td").nth(1)).toHaveText("foreign");
    // DS0432 is held in two accounts (20 + 5): one summed row that expands
    const ds = page.getByTestId("instrument-DS0432");
    await expect(ds.locator("td").nth(1)).toHaveText("▸ 2 accounts");
    await expect(ds.locator("td").nth(2)).toHaveText("25");
    await page.getByTestId("expand-DS0432").click();
    await expect(page).not.toHaveURL(/chart=/); // the toggle doesn't open the chart
    const dsRows = table.locator('tr[data-testid="holding-row"][data-isin="PL0000113783"]');
    await expect(dsRows).toHaveCount(2);
    await expect(dsRows.nth(0).locator("td").nth(1)).toHaveText("└ broker");
    await expect(dsRows.nth(0).locator("td").nth(2)).toHaveText("20");
    await expect(dsRows.nth(1).locator("td").nth(2)).toHaveText("5");
    await page.getByTestId("expand-DS0432").click();
    await expect(dsRows).toHaveCount(0);

    // Cash: one row (complete accounts summed), expands to one row per account, the incomplete one greyed
    await expect(page.getByTestId("instrument-cash").locator("td").nth(1)).toHaveText("▸ 7 accounts");
    await expect(page.getByTestId("cash-row")).toHaveCount(0);
    await page.getByTestId("expand-cash").click();
    await expect(page.getByTestId("cash-row")).toHaveCount(9); // eur: one per currency
    await expect(table.locator('tr[data-testid="cash-row"][data-account="etf"]')).toHaveClass(/muted/);

    await page.reload();
    await expect(page.getByTestId("instrument-cash")).toBeVisible();
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(page).toHaveURL(/group=instrument/);
    await expect(page.getByTestId("instrument-DS0432").locator("td").nth(1)).toHaveText("ike"); // now in one account
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

    // An instrument in one account: its row is that position
    await page.getByTestId("instrument-SPXS").click();
    await expect(page).toHaveURL(/chart=IE00B3YCGJ38&chartAccount=foreign/);
    await expect(page.getByTestId("chart-panel-title")).toContainText("foreign");
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

test.describe("notes view", () => {
  test("writes a note in Markdown with a live preview, shows it rendered, edits and deletes it", async ({ page }) => {
    const title = `E2E note ${Date.now()}`;
    await page.goto("/#/notes");
    await expect(page.getByTestId("nav-notes")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("note-new").click();
    await expect(page).toHaveURL(/#\/notes\?note=new$/);
    await page.getByTestId("note-title-input").fill(title);
    await page.getByTestId("note-body-input").fill("## Checklist\n\n- **bold** item\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.hacked = 1</script>");
    await expect(page.getByLabel("Preview").getByRole("heading", { name: "Checklist" })).toBeVisible();
    await page.getByTestId("note-save").click();

    await expect(page).toHaveURL(/#\/notes\?note=[a-f0-9]+$/);
    await expect(page.getByTestId("note-title")).toHaveText(title);
    const rendered = page.getByTestId("note-rendered");
    await expect(rendered.getByRole("heading", { name: "Checklist", level: 2 })).toBeVisible();
    await expect(rendered.locator("strong")).toHaveText("bold");
    await expect(rendered.locator("table td")).toHaveText(["1", "2"]);
    await expect(rendered.locator('input[type="checkbox"]')).toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined(); // raw HTML isn't run
    await expect(page.getByTestId("note-item").filter({ hasText: title })).toHaveAttribute("aria-current", "page");

    await page.getByTestId("note-edit").click();
    await page.getByTestId("note-body-input").fill("Just *text* now");
    await page.getByTestId("note-save").click();
    await expect(page.getByTestId("note-rendered").locator("em")).toHaveText("text");
    await page.reload();
    await expect(page.getByTestId("note-rendered")).toHaveText("Just text now");

    await page.getByTestId("note-delete").click();
    await page.getByTestId("note-delete-confirm").click();
    await expect(page).toHaveURL(/#\/notes$/);
    await expect(page.getByTestId("note-item").filter({ hasText: title })).toHaveCount(0);
  });
});
