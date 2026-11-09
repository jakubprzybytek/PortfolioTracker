import { expect, test } from "@playwright/test";
import { fetchFresh } from "./fresh.ts";

// Views against the sample data: accounts "broker" (DS0432, IZ0836), "ike" (DS0432, EDO0935, SAMPLE-APARTMENT),
// "foreign" (SPXS, an ETF in EUR), "bonds" (KRU0827, a Catalyst bond), "ibkr" (EUR cash, a Bund).

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

test.describe("cached data and Reload", () => {
  const slow = (ms: number) => async (route: import("@playwright/test").Route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  };

  test("a view visited before shows its data at once and refetches it in the background", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    await page.getByTestId("nav-dashboard").click();
    await expect(page.getByTestId("total-all")).toBeVisible();
    await page.waitForTimeout(2500); // within 2 s of the last fetch SWR wouldn't fetch again

    await page.route("**/transactions", slow(3000));
    const refetch = page.waitForRequest("**/transactions");
    await page.getByTestId("nav-transactions").click();
    await expect(rows).toHaveCount(30, { timeout: 1000 }); // from the cache, while the request is held back
    await refetch;
    await expect(page.getByTestId("reload")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("reload")).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
    await expect(rows).toHaveCount(30);
  });

  test("Reload refetches the view's data and keeps it on screen meanwhile", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    await page.route("**/transactions", slow(1500));
    const refetch = page.waitForRequest("**/transactions");
    await page.getByTestId("reload").click();
    await refetch;
    await expect(page.getByTestId("reload")).toHaveAttribute("aria-busy", "true");
    await expect(rows).toHaveCount(30);
    await expect(page.getByTestId("reload")).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
  });

  test("'Reload' (the frame) and 'Update prices' (the view header) are separate buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("refresh-prices")).toHaveText("Update prices");
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);
    // Reload doesn't start the live prices
    let started = false;
    await page.route("**/prices/refresh", (route) => {
      started = true;
      return route.abort();
    });
    await page.getByTestId("reload").click();
    await expect(page.getByTestId("reload")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("recalc")).toHaveCount(0);
    expect(started).toBe(false);
  });
});

test.describe("transactions view", () => {
  test("lists all transactions, newest first", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    const dates = await rows.locator("td:first-child").allTextContents();
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(rows.first()).toContainText("2026-09-30");
    await expect(page.getByTestId("filters-summary")).toHaveText("30 of 30 transactions");
  });

  test("rows of one date share a background; the next date has the other one", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    const list = await rows.evaluateAll((trs) => trs.map((tr) => ({ date: tr.querySelector("td")!.textContent, band: tr.className.match(/band-(a|b)/)?.[1] })));
    expect(list[0]!.band).toBe("a");
    for (let i = 1; i < list.length; i++) {
      const same = list[i]!.date === list[i - 1]!.date;
      expect(list[i]!.band === list[i - 1]!.band, `${list[i]!.date} after ${list[i - 1]!.date}`).toBe(same);
    }
    const colors = await rows.evaluateAll((trs) => trs.slice(0, 2).map((tr) => getComputedStyle(tr.querySelector("td")!).backgroundColor));
    expect(colors[0]).not.toBe(colors[1]); // different dates (2026-09-30, 2026-06-01): visibly different
  });

  test("on a phone, a list of two-line rows instead of the table; a row opens the form", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transactions-table")).toHaveCount(0);
    const rows = page.getByTestId("transactions-list").getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    // A buy: date, type and account, the amount; then the instrument, quantity × price.
    const buy = rows.filter({ hasText: "2025-02-05" });
    await expect(buy).toContainText("Buy · broker");
    await expect(buy.getByTestId("tx-amount-cell")).toHaveText(/-15\s?900,00\s*zł/);
    await expect(buy).toContainText("DS0432");
    await expect(buy).toContainText("20 × 79,5");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); // nothing sideways
    await buy.click();
    await expect(page.getByTestId("tx-form")).toBeVisible();
    await expect(page.getByTestId("tx-date")).toHaveValue("2025-02-05");
    await page.keyboard.press("Escape");

    // Filters: the search and a "Filters" button on one line; the dropdowns fold out below (two a row, the instrument
    // on its own); "Clear" by the count only while something is set.
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const [search, toggle] = [await box("filter-text"), await box("filters-toggle")];
    expect(Math.abs(search.y + search.height / 2 - (toggle.y + toggle.height / 2))).toBeLessThan(3);
    await expect(page.getByTestId("filter-account")).toHaveCount(0);
    await page.getByTestId("filters-toggle").click();
    const [acc, txType, type, instr] = [await box("filter-account"), await box("filter-tx-type"), await box("filter-type"), await box("filter-instrument")];
    expect(Math.abs(acc.y - txType.y)).toBeLessThan(2);
    expect(type.y).toBeGreaterThan(acc.y + acc.height);
    expect(instr.y).toBeGreaterThan(type.y + type.height - 1);
    expect(instr.width).toBeGreaterThan(300);
    await expect(page.getByTestId("filters-reset")).toHaveCount(0);
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(page.getByTestId("filters-reset")).toHaveText("Clear");
    await page.getByTestId("filters-toggle").click(); // folded again: the button says how many are set
    await expect(page.getByTestId("filters-panel")).toHaveCount(0);
    await expect(page.getByTestId("filters-toggle")).toHaveText("Filters · 1");
    expect((await box("filters-reset")).y).toBeGreaterThan(search.y + search.height); // on the count's line
    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(30);
    await expect(page.getByTestId("filters-reset")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Scrolled: the filters stay under the top bar; month rows in the list too.
    await expect(page.getByTestId("transactions-list").getByTestId("month-row").first()).toHaveText(/^September 2026\s*1$/);
    await page.evaluate(() => window.scrollTo(0, 1500));
    const bar = (await page.locator(".sidebar").boundingBox())!;
    const tools = (await box("tx-toolbar"))!;
    expect(Math.abs(tools.y - (bar.y + bar.height))).toBeLessThan(3);
    expect(tools.height).toBeLessThan(100); // two short lines, not the whole set of dropdowns
  });

  test("a long history is drawn 200 rows at a time, the next ones as you scroll to the end", async ({ page }) => {
    // Made up: 450 deposits, a day apart, in two accounts.
    const long = Array.from({ length: 450 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + (449 - i) * 864e5).toISOString().slice(0, 10);
      return { id: `long-${i}`, date: d, account: i % 2 ? "long-a" : "long-b", type: "DEPOSIT", amount: 100 + i, currency: "PLN", source: "e2e" };
    });
    await page.route("**/transactions", (route) => (route.request().method() === "GET" ? route.fulfill({ json: long }) : route.continue()));
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(200);
    await expect(page.getByTestId("filters-summary")).toHaveText("450 of 450 transactions");
    await expect(page.getByTestId("transactions-more")).toHaveText("250 more…");
    await page.getByTestId("transactions-more").scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(400);
    await page.getByTestId("transactions-more").scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(450);
    await expect(page.getByTestId("transactions-more")).toHaveCount(0);
    // A filter starts from the first rows again (seen from the top of the page).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("filter-account").selectOption("long-a");
    await expect(page.getByTestId("filters-summary")).toHaveText("225 of 450 transactions");
    await expect(rows).toHaveCount(200);
    await expect(page.getByTestId("transactions-more")).toHaveText("25 more…");
  });

  test("filters by instrument, account and asset type, and keeps filters in the URL", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    // Account first, the search last.
    expect(await page.locator(".filters select, .filters input").evaluateAll((ss) => ss.map((s) => s.getAttribute("data-testid")))).toEqual(["filter-account", "filter-tx-type", "filter-instrument", "filter-type", "filter-text"]);

    await page.getByTestId("filter-instrument").selectOption({ label: "DS0432" });
    await expect(rows).toHaveCount(4); // broker: buy + 2 coupons, ike: buy
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/instrument=PL0000113783/);
    await expect(page).toHaveURL(/account=ike/);

    await page.reload();
    await expect(rows).toHaveCount(1);

    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(30);
    await page.getByTestId("filter-type").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(13); // the 9 deposits, the closed account's interest and withdrawal, eur's 2 exchanges
    await expect(rows.first()).toContainText("Deposit");
    // A currency exchange shows both sides
    await page.getByTestId("filter-account").selectOption("eur");
    const exchange = rows.filter({ hasText: "Currency exchange" }).filter({ hasText: "2025-11-03" });
    await expect(exchange.getByTestId("tx-amount-cell")).toHaveText(/^-4\s?300,00\s*zł\s*→\s*1\s?000,00 EUR$/);
  });

  test("filters by transaction type and free text (instrument, ISIN, account, type, note), kept in the URL", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    await page.getByTestId("filter-tx-type").selectOption({ label: "Buy" });
    await expect(rows).toHaveCount(10);
    await expect(page).toHaveURL(/tx=BUY/);
    await page.getByTestId("filter-tx-type").selectOption("");
    await page.getByTestId("filter-text").fill("ds0432"); // the code, any case
    await expect(rows).toHaveCount(4);
    await page.getByTestId("filter-tx-type").selectOption({ label: "Coupon" });
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(/q=ds0432/);
    await page.reload();
    await expect(rows).toHaveCount(2);
    await page.getByTestId("filters-reset").click();
    await page.getByTestId("filter-text").fill("broker's rate"); // a note
    await expect(rows).toHaveCount(2);
    await page.getByTestId("filter-text").fill("nothing like this");
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("transactions-table")).toContainText("No transactions match the filters.");
  });

  test("a row per month; the filters and the header stay at the top while scrolling; tinted rows keep their divider", async ({ page }) => {
    await page.goto("/#/transactions");
    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(30);
    const months = page.getByTestId("transactions-table").getByTestId("month-row");
    await expect(months).toHaveCount(15);
    await expect(months.first()).toHaveText(/^September 2026\s*· 1$/);
    await expect(months.nth(2)).toHaveText(/^May 2026\s*· 3$/);
    // The month row comes right before its first transaction.
    const kinds = await page.locator("[data-testid=transactions-table] tbody tr").evaluateAll((trs) => trs.slice(0, 4).map((tr) => tr.getAttribute("data-testid")));
    expect(kinds).toEqual(["month-row", "transaction-row", "month-row", "transaction-row"]);

    // A divider between rows of one date on the tint: not the colour of the tint itself.
    const band = page.locator("tr.band-b[data-testid=transaction-row] td").first();
    const [line, fill] = await band.evaluate((td) => [getComputedStyle(td).borderBottomColor, getComputedStyle(td).backgroundColor]);
    expect(line).not.toBe(fill);

    // Scrolled down: the filters at the top edge, the header right under them.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.evaluate(() => window.scrollTo(0, 1200));
    const tools = (await page.getByTestId("tx-toolbar").boundingBox())!;
    const head = (await page.locator("[data-testid=transactions-table] thead th").first().boundingBox())!;
    expect(Math.abs(tools.y)).toBeLessThan(2);
    expect(Math.abs(head.y - (tools.y + tools.height))).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  });

  test("a wide screen gets a wider list; a narrower one drops the least needed columns, then becomes a list, instead of scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 900 });
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row")).toHaveCount(30);
    expect((await page.getByTestId("transactions-table").boundingBox())!.width).toBeGreaterThan(1450);
    await expect(page.locator("thead th.col-asset")).toBeVisible();
    // Never wider than its box (it would be cut: the box doesn't scroll, so the header can stick).
    for (const width of [1900, 1440, 1280, 1160]) {
      await page.setViewportSize({ width, height: 900 });
      const fits = await page.getByTestId("transactions-table").evaluate((t) => t.offsetWidth <= t.parentElement!.clientWidth + 1);
      expect(fits, `at ${width} px`).toBe(true);
    }
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.locator("thead th.col-asset")).toBeHidden();
    await expect(page.locator("thead th.col-note")).toBeHidden();
    // Narrower still: the list of two-line rows, as on a phone (the filters stay as on a computer).
    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(page.getByTestId("transactions-table")).toHaveCount(0);
    await expect(page.getByTestId("transactions-list").getByTestId("transaction-row")).toHaveCount(30);
    await expect(page.getByTestId("filter-account")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1000);
  });
});

test.describe("adding transactions", () => {
  test("a write-off takes the instrument and the quantity, no amount", async ({ page }) => {
    await page.goto("/#/transactions");
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("WRITE_OFF");
    await expect(page.getByTestId("tx-instrument")).toBeVisible();
    await expect(page.getByTestId("tx-quantity")).toBeVisible();
    await expect(page.getByTestId("tx-amount")).toHaveCount(0);
    await expect(page.getByTestId("tx-price")).toHaveCount(0);
    await expect(page.getByTestId("tx-summary")).toContainText("No cash moves");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tx-form")).toBeHidden();
  });

  test("the instrument list shows the account's own; tax paid takes the gross and keeps the net", async ({ page }) => {
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row").first()).toBeVisible();
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("COUPON");
    await page.getByTestId("tx-account").selectOption("broker");
    const select = page.getByTestId("tx-instrument");
    // broker has had DS0432 and IZ0836, not the Kruk bond of "bonds".
    await expect(select.locator("option", { hasText: "DS0432" })).toBeAttached();
    await expect(select.locator('option[value="PLKRK0000713"]')).toHaveCount(0);
    await select.selectOption("__other__");
    await expect(select.locator('option[value="PLKRK0000713"]')).toHaveCount(1);
    await expect(select.locator('option[value="__other__"]')).toHaveCount(0);
    await expect(select.locator('option[value="__new__"]')).toHaveCount(1);

    await page.getByTestId("tx-amount").fill("100");
    await page.getByTestId("tx-tax").fill("19");
    await expect(page.getByTestId("tx-summary")).toContainText("81,00 zł");
    await expect(page.getByTestId("tx-summary")).toContainText("100,00 gross − 19,00 tax");
    await page.keyboard.press("Escape");
  });

  test("the instrument list waits for the account's transactions instead of showing every instrument first", async ({ page }) => {
    // Hold back the transactions (which instruments the account has had) until released.
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(
      (url) => url.pathname.endsWith("/transactions"),
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await page.goto("/#/holdings");
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-account").selectOption("broker");
    const select = page.getByTestId("tx-instrument");
    await expect(select).toBeDisabled();
    await expect(select.locator("option").first()).toHaveText("Loading…");
    release();
    await expect(select).toBeEnabled();
    await expect(select.locator('option[value="PLKRK0000713"]')).toHaveCount(0); // broker's own only
    await expect(select.locator("option", { hasText: "DS0432" })).toBeAttached();
    await page.keyboard.press("Escape");
  });

  test("on a phone the instrument is chosen in a sheet: only the account's own, 'Other instrument…' for the rest, a search, Escape closes the sheet only", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/transactions");
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("COUPON");
    await page.getByTestId("tx-account").selectOption("broker");
    await expect(page.getByTestId("tx-instrument")).toHaveCount(0); // no native dropdown
    const trigger = page.getByTestId("tx-instrument-picker");
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveText(/Choose/);
    await trigger.click();
    const sheet = page.getByTestId("instrument-sheet");
    await expect(sheet).toBeVisible();
    // Only broker's own (DS0432, IZ0836), not the Kruk bond of "bonds".
    await expect(sheet.locator("legend").first()).toHaveText("In broker");
    await expect(sheet.getByTestId("instrument-option")).toHaveCount(2);
    await expect(sheet.getByTestId("instrument-option").filter({ hasText: "DS0432" })).toHaveCount(1);
    await expect(sheet.locator('[data-isin="PLKRK0000713"]')).toHaveCount(0);
    await expect(sheet.getByTestId("instrument-new")).toBeVisible();
    // Every row is one line of code and one of name, however long the name.
    const heights = await sheet.getByTestId("instrument-option").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    // Search: code, name or ISIN, accents ignored; within the account's own.
    await page.getByTestId("instrument-search").fill("kru0827");
    await expect(sheet.getByTestId("instrument-empty")).toContainText("in broker");
    // "Other instrument…": every one, the sheet stays open, the search kept.
    await sheet.getByTestId("instrument-other").click();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-isin="PLKRK0000713"]')).toHaveCount(1);
    await expect(sheet.getByTestId("instrument-other")).toHaveCount(0);
    await page.getByTestId("instrument-search").fill("ds0432");
    await expect(sheet.getByTestId("instrument-option")).toHaveCount(1);
    // Escape closes the sheet, not the form.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("tx-form")).toBeVisible();
    // Choosing one closes the sheet and shows it in the field.
    await trigger.click();
    await sheet.getByTestId("instrument-option").filter({ hasText: "DS0432" }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toContainText("DS0432");
    await expect(page.locator("small.one-line")).toContainText("· PLN"); // the info line: type · ISIN · currency
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tx-form")).toBeHidden();
  });

  test("tax paid is saved with the transaction: the net as the amount, the tax in the note column, gross and tax again on edit", async ({ page }) => {
    // Dated far ahead in its own account, as the other saving tests.
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row").first()).toBeVisible();
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-date").fill("2099-04-05");
    await page.getByTestId("tx-type").selectOption("COUPON");
    await page.getByTestId("tx-account").selectOption("__new_account__");
    await page.getByTestId("tx-new-account").fill("e2e-tax");
    // A new account has had no instruments: none listed, only "Choose…", "Other instrument…" and "New instrument…".
    const select = page.getByTestId("tx-instrument");
    await expect(select.locator("option")).toHaveCount(3);
    await select.selectOption("__other__");
    await select.selectOption("PLKRK0000713");
    await page.getByTestId("tx-amount").fill("100");
    await page.getByTestId("tx-tax").fill("19");
    await page.getByTestId("tx-note").fill("E2E coupon");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction added.");

    const row = page.locator('tr[data-testid="transaction-row"]').filter({ hasText: "e2e-tax" });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("tx-amount-cell")).toHaveText(/81,00\s*zł/);
    await expect(row.getByTestId("tx-note-cell")).toHaveText(/^E2E coupon · Tax paid: 19,00\s*zł$/);

    await row.click();
    await expect(page.getByTestId("tx-amount")).toHaveValue("100");
    await expect(page.getByTestId("tx-tax")).toHaveValue("19");
    await expect(page.getByTestId("tx-note")).toHaveValue("E2E coupon");
    await page.getByTestId("tx-tax").fill("20");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction updated.");
    await expect(row.getByTestId("tx-amount-cell")).toHaveText(/80,00\s*zł/);
    await expect(row.getByTestId("tx-note-cell")).toHaveText(/Tax paid: 20,00\s*zł$/);

    await row.click();
    await page.getByTestId("tx-delete").click();
    await page.getByTestId("tx-delete-confirm").click();
    await expect(row).toHaveCount(0);
  });

  test("editing shows the transaction's account while the accounts are still loading", async ({ page }) => {
    await page.goto("/#/transactions");
    const row = page.getByTestId("transaction-row").filter({ hasText: "2025-02-05" }).filter({ hasText: "broker" });
    await expect(row).toHaveCount(1);
    // A fresh page: /accounts answers late (as with a long history).
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/accounts", async (route) => {
      await held;
      await route.continue();
    });
    await page.reload();
    await row.click();
    const select = page.getByTestId("tx-account");
    await expect(select).toHaveValue("broker");
    await expect(select.locator("option:checked")).toHaveText("broker"); // not "New account…"
    release();
    await expect(select.locator("option")).not.toHaveCount(2);
    await expect(select.locator("option:checked")).toHaveText("broker");
    await page.keyboard.press("Escape");
  });

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
    // A long note on two lines: the field takes several lines.
    const note = "E2E test\nA second line, long enough to wrap in the table if it were shown in full: it isn't, only its start.";
    await expect(page.getByTestId("tx-note")).toHaveJSProperty("tagName", "TEXTAREA");
    await page.getByTestId("tx-note").fill(note);
    await page.getByTestId("tx-save").click();
    await expect(form).toBeHidden();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction added.");
    const row = page.locator('tr[data-testid="transaction-row"]').filter({ hasText: "e2e-test" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("2099-03-04");
    await expect(row).toContainText("250,00 zł");
    // The note: one line, cut short; all of it on hover.
    const noteCell = row.getByTestId("tx-note-cell");
    await expect(noteCell).toHaveAttribute("title", note);
    const dateCell = (await row.locator("td").first().boundingBox())!;
    expect((await noteCell.boundingBox())!.height).toBeLessThanOrEqual(dateCell.height + 1);
    expect(await noteCell.evaluate((td) => td.scrollWidth > td.clientWidth)).toBe(true);

    // Edit: the form opens with its values; a new amount replaces the old.
    await row.click();
    await expect(page.getByTestId("tx-amount")).toHaveValue("250");
    await expect(page.getByTestId("tx-note")).toHaveValue(note);
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

  test("a retail bond buy has 'Interest from': it follows the date until set, and editing the row keeps it", async ({ page }) => {
    // Dated far ahead in its own account, as above.
    await page.goto("/#/transactions");
    await expect(page.getByTestId("transaction-row").first()).toBeVisible();
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("BUY");
    await page.getByTestId("tx-account").selectOption("ike"); // has had DS0432 and EDO0935 (the list shows the account's own)
    await page.getByTestId("tx-instrument").selectOption({ label: "DS0432 · Obligacje skarbowe DS0432 (stałe 1,75 %)" });
    await expect(page.getByTestId("tx-interest-from")).toHaveCount(0); // a listed bond: its coupon periods decide
    await page.getByTestId("tx-instrument").selectOption("PL0000118402"); // EDO0935
    const from = page.getByTestId("tx-interest-from");
    await page.getByTestId("tx-date").fill("2099-03-15");
    await expect(from).toHaveValue("2099-03-15");
    await page.getByTestId("tx-date").fill("2099-03-14");
    await expect(from).toHaveValue("2099-03-14"); // follows the date
    await from.fill("2099-03-16");
    await page.getByTestId("tx-date").fill("2099-03-15");
    await expect(from).toHaveValue("2099-03-16"); // set by hand: stays
    await page.getByTestId("tx-account").selectOption("__new_account__");
    await page.getByTestId("tx-new-account").fill("e2e-interest");
    await page.getByTestId("tx-quantity").fill("5");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction added.");

    const row = page.locator('tr[data-testid="transaction-row"]').filter({ hasText: "e2e-interest" });
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").first()).toHaveAttribute("title", "Interest from 2099-03-16");
    await expect(row.getByTestId("tx-interest-mark")).toBeVisible();

    // Editing only the note keeps the interest start (it used to be reset to the date).
    await row.click();
    await expect(page.getByTestId("tx-interest-from")).toHaveValue("2099-03-16");
    await page.getByTestId("tx-note").fill("E2E interest start");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction updated.");
    await expect(row.locator("td").first()).toHaveAttribute("title", "Interest from 2099-03-16");

    // Back to the date: no mark.
    await row.click();
    await page.getByTestId("tx-interest-from").fill("2099-03-15");
    await page.getByTestId("tx-save").click();
    await expect(page.getByTestId("tx-toast")).toContainText("Transaction updated.");
    await expect(row.getByTestId("tx-interest-mark")).toHaveCount(0);

    await row.click();
    await page.getByTestId("tx-delete").click();
    await page.getByTestId("tx-delete-confirm").click();
    await expect(row).toHaveCount(0);
  });

  test("suggests a bond buy's amount and finds a new treasury series by code; the server's objections show", async ({ page }) => {
    await page.goto("/#/transactions");
    await page.getByTestId("tx-add").click();
    await page.getByTestId("tx-type").selectOption("BUY");
    await page.getByTestId("tx-account").selectOption("ike"); // has had DS0432 and EDO0935 (the list shows the account's own)
    await page.getByTestId("tx-instrument").selectOption({ label: "DS0432 · Obligacje skarbowe DS0432 (stałe 1,75 %)" });
    await page.getByTestId("tx-quantity").fill("10");
    await page.getByTestId("tx-price").fill("80,5");
    await expect(page.getByTestId("tx-amount")).toHaveValue("8050"); // 10 × 80.5% × 1000
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
    await expect(page.getByTestId("tx-amount")).toHaveValue("1920"); // 2 × 96% × 1000 EUR
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
    expect(groupOrder).toEqual(["account-bonds", "account-broker", "account-eur", "account-foreign", "account-ibkr", "account-ike"]);
    // each account ends with its cash
    await expect(table.locator('tr[data-testid="cash-row"][data-account="broker"]')).toContainText("5 420,86");
    const broker = table.locator('tr[data-testid="holding-row"][data-account="broker"]');
    await expect(broker).toHaveCount(2);
    expect(await broker.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "IZ0836"]);
    await expect(broker.nth(0).locator("td").nth(4)).toHaveText(/^\d+,\d{2}$/); // accrued interest per bond
    await expect(broker.nth(1).locator("td").nth(4)).toHaveText(/^\d+,\d{2}$/);
    const ike = table.locator('tr[data-testid="holding-row"][data-account="ike"]');
    await expect(ike).toHaveCount(3);
    expect(await ike.locator("td:first-child strong").allTextContents()).toEqual(["DS0432", "EDO0935", "SAMPLE-APARTMENT"]);
    await expect(ike.first().locator("td").nth(2)).toHaveText("5");
    await expect(ike.nth(1).locator("td").nth(1)).toHaveText(/^Retail bond/); // and its hold-or-sell badge
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
    await expect(page.getByTestId("cash-row")).toHaveCount(8); // 5 accounts in PLN, eur in PLN, EUR and USD
  });

  test("filters by asset class; the asset types follow the class", async ({ page }) => {
    await page.goto("/#/holdings");
    const rows = page.getByTestId("holding-row");
    await expect(rows).toHaveCount(10);
    // in the order of the bar: account, class, type, instrument
    expect(await page.locator(".filters select, .filters input").evaluateAll((ss) => ss.map((s) => s.getAttribute("data-testid")))).toEqual(["filter-account", "filter-class", "filter-type", "filter-text"]);
    await page.getByTestId("filter-type").selectOption({ label: "ETF" });
    await expect(rows).toHaveCount(1);
    // bonds: no cash, only bond types; the ETF type is dropped
    await page.getByTestId("filter-class").selectOption({ label: "Bonds" });
    await expect(page).toHaveURL(/class=BONDS/);
    await expect(page).not.toHaveURL(/type=/);
    await expect(rows).toHaveCount(7);
    await expect(page.getByTestId("cash-row")).toHaveCount(0);
    await expect(page.getByTestId("filters-summary")).toHaveText("7 of 10 holdings");
    expect(await page.getByTestId("filter-type").locator("option").allTextContents()).toEqual(["All", "Corporate bond", "Foreign bond", "Listed bond", "Retail bond"]);
    await page.getByTestId("filter-class").selectOption({ label: "Shares" });
    await expect(rows).toHaveCount(1);
    // cash: the cash rows and the foreign cash
    await page.getByTestId("filter-class").selectOption({ label: "Cash" });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-isin", "ZZWALUTYEUR0");
    await expect(page.getByTestId("cash-row")).toHaveCount(8);
    await page.getByTestId("filters-reset").click();
    await expect(page.getByTestId("filter-class")).toHaveValue("");
    await expect(rows).toHaveCount(10);
  });

  test("on a phone: the search and Filters on one line; account and class, then type and Show closed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/holdings");
    await expect(page.getByTestId("holding-row")).toHaveCount(10);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const [search, toggle] = [await box("filter-text"), await box("filters-toggle")];
    expect(Math.abs(search.y + search.height / 2 - (toggle.y + toggle.height / 2))).toBeLessThan(3);
    await page.getByTestId("filters-toggle").click();
    const [acc, cls, type, closed] = [await box("filter-account"), await box("filter-class"), await box("filter-type"), await box("show-closed")];
    expect(Math.abs(acc.y - cls.y)).toBeLessThan(2);
    expect(type.y).toBeGreaterThan(acc.y + acc.height);
    expect(Math.abs(type.y + type.height / 2 - (closed.y + closed.height / 2))).toBeLessThan(3);
    expect(closed.x + closed.width).toBeLessThanOrEqual(390);
    await page.getByTestId("filter-class").selectOption({ label: "Bonds" });
    await page.getByTestId("show-closed").click();
    await page.getByTestId("filters-toggle").click();
    await expect(page.getByTestId("filters-toggle")).toHaveText("Filters · 2");
    await expect(page.getByTestId("filters-reset")).toHaveText("Clear");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe("free-text filter", () => {
  test("holdings and prices: instruments whose name or code contains the text, case and accents ignored; in the URL", async ({ page }) => {
    await page.goto("/#/holdings");
    await expect(page.getByTestId("holding-row")).toHaveCount(10);
    await page.getByTestId("filter-text").fill("INFLACJA"); // IZ0836: "… indeksowane inflacją"
    await expect(page.getByTestId("holding-row")).toHaveCount(1);
    await expect(page.getByTestId("holding-row").locator("td:first-child strong")).toHaveText("IZ0836");
    await expect(page.getByTestId("cash-row")).toHaveCount(0); // cash isn't an instrument
    await expect(page.getByTestId("filters-summary")).toHaveText("1 of 10 holdings");
    await expect(page).toHaveURL(/q=INFLACJA/);
    await page.getByTestId("filters-reset").click();
    await expect(page.getByTestId("filter-text")).toHaveValue("");
    await expect(page.getByTestId("holding-row")).toHaveCount(10);

    await page.goto("/#/prices");
    await page.getByTestId("filter-text").fill("kruk");
    await expect(page.getByTestId("filters-summary")).toHaveText("1 of 7 instruments");
    await expect(page.getByTestId("price-KRU0827")).toBeVisible();
    await page.getByTestId("filter-text").fill("nothing like this");
    await expect(page.getByTestId("prices-table")).toContainText("No instruments match the filters.");
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
    await expect(page.getByTestId("price-KRU0827").locator("td").nth(3)).toHaveText(/^\d+,\d{2}%$/); // corporate bond: clean, % of nominal
    await expect(page.getByTestId("price-SPXS").locator("td").nth(3)).toHaveText(/^\d+,\d{2} EUR$/); // ETF: in its currency
    const manual = page.getByTestId("price-SAMPLE-APARTMENT");
    await expect(manual.locator("td").nth(3)).toHaveText("950,00 PLN");
    await expect(manual.locator("td").nth(4)).toHaveText(/2026-09-30\s*manual/);
    // Retail bond: its interest rate instead of a market price, the previous year's rate in "1 year"
    const edo = page.getByTestId("price-EDO0935");
    await expect(edo.locator("td").nth(3)).toHaveText("5,00% p.a.");
    await expect(edo.locator("td").nth(4)).toHaveText("calculated");
    await expect(edo.locator("td").nth(5)).toHaveText("6,00% before");
    const ds = page.getByTestId("price-DS0432");
    await expect(ds.locator("td").nth(3)).toHaveText(/^\d+,\d{2}%$/); // clean price, % of nominal
    await expect(ds.locator("td").nth(4)).toHaveText(/^\d{4}-\d{2}-\d{2}/);
    await expect(ds.locator("td").nth(5)).toHaveText(/%$/);

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
    // An IZ bond also shows its indexed nominal: a second line on a right-hand axis
    await expect(page.getByTestId("price-chart").locator("path.recharts-line-curve")).toHaveCount(2);
    await expect(page.getByTestId("price-title")).toContainText("dashed: indexed nominal per bond");

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
    // asset class: a column (by the rule here)
    await expect(page.getByTestId("price-SPXS").getByTestId("price-class")).toHaveText("Shares");
    await expect(page.getByTestId("price-DS0432").getByTestId("price-class")).toHaveText("Bonds");
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
    await page.getByTestId("filter-class").selectOption({ label: "Bonds" });
    await expect(page.getByTestId("prices-table")).toContainText("No instruments match the filters.");
    await expect(page).toHaveURL(/class=BONDS/);
    await page.getByTestId("filter-class").selectOption({ label: "Shares" });
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

  test("the cog in a chart panel opens the instrument's settings (asset class); back returns to the panel", async ({ page }) => {
    await page.goto("/#/prices?chart=IE00B3YCGJ38");
    await expect(page.getByTestId("price-title")).toContainText("SPXS");
    await page.getByTestId("instrument-settings").click();
    await expect(page).toHaveURL(/#\/instrument\?isin=IE00B3YCGJ38&from=prices/);
    await expect(page.getByTestId("instrument-title")).toContainText("SPXS");
    await expect(page.getByTestId("instrument-facts")).toContainText("IE00B3YCGJ38");
    await expect(page.getByTestId("asset-class-select")).toHaveValue("SHARES");
    await expect(page.getByTestId("asset-class-select").locator("option:checked")).toHaveText("Shares (rule)");
    // an ETF: no values by hand, no coupon periods; not in the menu
    await expect(page.getByTestId("instrument-values")).toHaveCount(0);
    await expect(page.getByTestId("instrument-coupons")).toHaveCount(0);
    await expect(page.getByTestId("nav-instrument")).toHaveCount(0);
    await page.getByTestId("instrument-back").click();
    await expect(page).toHaveURL(/#\/prices\?chart=IE00B3YCGJ38/);
    await expect(page.getByTestId("chart-panel")).toBeVisible();
    // from Holdings too, and back there
    await page.goto("/#/holdings?chart=IE00B3YCGJ38");
    await page.getByTestId("instrument-settings").click();
    await expect(page).toHaveURL(/from=holdings/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/holdings\?chart=IE00B3YCGJ38/);
    await expect(page.getByTestId("chart-panel")).toBeVisible();
  });

  test("an asset valued by hand takes a new value in its settings, and the value can be deleted", async ({ page }) => {
    await page.goto("/#/prices?chart=ZZSAMPLEAPA0");
    await expect(page.getByTestId("price-title")).toContainText("SAMPLE-APARTMENT");
    await page.getByTestId("instrument-settings").click();
    await expect(page.getByTestId("instrument-title")).toContainText("SAMPLE-APARTMENT");
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
    await page.goto("/#/instrument?isin=PL0000113783");
    await expect(page.getByTestId("instrument-title")).toContainText("DS0432");
    await expect(page.getByTestId("instrument-class")).toBeVisible();
    await expect(page.getByTestId("instrument-values")).toHaveCount(0);
  });

  test("a corporate bond's coupon periods are in its settings; a period is added, given a rate and deleted", async ({ page }) => {
    await page.goto("/#/prices?chart=PLKRK0000713");
    await expect(page.getByTestId("price-title")).toContainText("KRU0827");
    await page.getByTestId("instrument-settings").click();
    await expect(page.getByTestId("instrument-title")).toContainText("KRU0827");
    const table = page.getByTestId("coupon-periods");
    // The sample's periods (data/coupons.sample.json), newest first; the sample coupon fits its period's rate.
    const feb = table.locator('[data-testid="coupon-period"][data-start="2026-02-12"]');
    await expect(feb).toContainText("8,86%");
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
    await expect(added.getByTestId("coupon-rate")).toContainText("7,50%");
    await expect(added.getByTestId("coupon-rate")).toContainText("yours");
    await added.getByTestId("coupon-delete").click();
    await added.getByTestId("coupon-delete").click();
    await expect(page.getByTestId("tx-toast")).toContainText("period from 2032-01-01 deleted");
    await expect(added).toHaveCount(0);
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
    await expect(dsRows.nth(0).locator("td").nth(1)).toHaveText(/^└ broker/); // and its hold-or-sell badge
    await expect(dsRows.nth(0).locator("td").nth(2)).toHaveText("20");
    await expect(dsRows.nth(1).locator("td").nth(2)).toHaveText("5");
    await page.getByTestId("expand-DS0432").click();
    await expect(dsRows).toHaveCount(0);

    // Cash: one row (every account summed), expands to one row per account
    await expect(page.getByTestId("instrument-cash").locator("td").nth(1)).toHaveText("▸ 6 accounts");
    await expect(page.getByTestId("cash-row")).toHaveCount(0);
    await page.getByTestId("expand-cash").click();
    await expect(page.getByTestId("cash-row")).toHaveCount(8); // eur: one per currency

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

test.describe("holdings XIRR and grouped by class", () => {
  test("XIRR per position, account, instrument and the total, from the positions' own flows (cash left out); by class: shares, bonds, cash, other", async ({ page }) => {
    await page.goto("/#/holdings");
    const table = page.getByTestId("holdings-by-account");
    await expect(table.locator("th").nth(9)).toHaveText("XIRR");
    await expect(table.locator("th").nth(9)).toHaveAttribute("title", /cash left out/);
    const pct = /^[-−+]?\d[\d\s]*(,\d+)?\s*%$/;
    const apartment = table.locator('tr[data-testid="holding-row"][data-account="ike"][data-isin="ZZSAMPLEAPA0"]');
    await expect(apartment.getByTestId("xirr")).toHaveText(pct);
    await expect(apartment.getByTestId("xirr")).toHaveText(/^\+/); // worth 950 + 12,50 income for 900
    for (const id of ["account-broker", "account-ike", "holdings-total"]) await expect(page.getByTestId(id).getByTestId("xirr")).toHaveText(pct);
    await expect(page.getByTestId("cash-row").first().getByTestId("xirr")).toHaveCount(0); // cash has none
    await expect(table.locator('tr[data-testid="holding-row"][data-account="ibkr"]').filter({ hasText: "Cash" }).getByTestId("xirr")).toHaveCount(0); // foreign cash neither

    // Filtered to one account, the total is that account's
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(page.getByTestId("holdings-total")).toHaveCount(0); // one group: no total row
    const ikeXirr = await page.getByTestId("account-ike").getByTestId("xirr").textContent();
    await page.getByTestId("group-by").getByRole("button", { name: "Instrument" }).click();
    await expect(page.getByTestId("holdings-total").getByTestId("xirr")).toHaveText(ikeXirr!);
    await page.getByTestId("filters-reset").click();

    // By class: one group per class in the asset mix's order; cash holds the accounts' cash and foreign cash, no XIRR
    await page.getByTestId("group-by").getByRole("button", { name: "Class" }).click();
    await expect(page).toHaveURL(/group=class/);
    await expect(page.getByTestId("class-BONDS")).toBeVisible();
    const order = await table.locator('tr[data-testid^="class-"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(order).toEqual(["class-SHARES", "class-BONDS", "class-CASH", "class-OTHER"]);
    await expect(table.locator("th").nth(1)).toHaveText("Account");
    await expect(page.getByTestId("class-SHARES")).toContainText("Shares · 1");
    await expect(page.getByTestId("class-BONDS").getByTestId("xirr")).toHaveText(pct);
    await expect(page.getByTestId("class-CASH").getByTestId("xirr")).toHaveCount(0);
    await expect(page.getByTestId("cash-row")).toHaveCount(8); // every account's cash, eur one per currency
    const spxs = table.locator('tr[data-testid="holding-row"][data-account="foreign"]');
    await expect(spxs.locator("td").nth(1)).toHaveText("foreign");
    // The class total is the same as the account total
    await page.getByTestId("group-by").getByRole("button", { name: "Account" }).click();
    const byAccount = await page.getByTestId("holdings-total").locator("td").nth(1).textContent();
    await page.getByTestId("group-by").getByRole("button", { name: "Class" }).click();
    await expect(page.getByTestId("holdings-total").locator("td").nth(1)).toHaveText(byAccount!);
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

  test("the position's transactions open next to its chart, collapsed by default, and stay open from one row to the next", async ({ page }) => {
    await page.goto("/#/holdings");
    await page.locator('tr[data-testid="holding-row"][data-account="broker"][data-isin="PL0000113783"]').click();
    const toggle = page.getByTestId("position-tx-toggle");
    await expect(toggle).toHaveText("Transactions3");
    await expect(toggle.getByTestId("position-tx-count")).toHaveText("3");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("position-tx")).toHaveCount(0);
    await toggle.click();
    const rows = page.getByTestId("position-tx-row");
    await expect(rows).toHaveCount(3); // broker's DS0432 only: the buy and two coupons, newest first
    expect(await rows.locator("td:first-child").allTextContents()).toEqual(["2026-04-27", "2025-04-28", "2025-02-05"]);
    await expect(rows.nth(2)).toContainText("Buy");
    await expect(rows.nth(2).locator("td").nth(2)).toHaveText("20");
    await expect(page.getByTestId("holding-chart")).toBeVisible(); // side by side with the chart
    const chart = (await page.getByTestId("holding-chart").boundingBox())!;
    const list = (await page.getByTestId("position-tx").boundingBox())!;
    expect(list.x).toBeGreaterThan(chart.x + chart.width - 1);

    // Across accounts (grouped by instrument): all of them, with the account.
    await page.goto("/#/holdings?group=instrument");
    await page.getByTestId("instrument-DS0432").click();
    await expect(page.getByTestId("position-tx-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("position-tx-row")).toHaveCount(4);
    await expect(page.getByTestId("position-tx").locator("th").nth(1)).toHaveText("Account");

    // On a phone they take the chart's place (and the range buttons'), without the price column.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("holding-chart")).toHaveCount(0);
    await expect(page.getByTestId("holding-range")).toHaveCount(0);
    await expect(page.getByTestId("position-tx-row")).toHaveCount(4);
    await expect(page.getByTestId("position-tx").getByRole("columnheader", { name: "Price" })).toBeHidden();
    const table = (await page.getByTestId("position-tx").boundingBox())!;
    expect(table.x + table.width).toBeLessThanOrEqual(390);
    await page.getByTestId("position-tx-toggle").click();
    await expect(page.getByTestId("holding-chart")).toBeVisible();
    // The valuation date and "Update prices" (only its icon) on the title's row.
    await expect(page.getByTestId("holdings-date")).toHaveText(/^as of \d{4}-\d{2}-\d{2}$/, { useInnerText: true }); // "Valuation" hidden
    const title = (await page.locator(".view-title").boundingBox())!;
    const update = (await page.getByTestId("refresh-prices").boundingBox())!;
    expect(update.y).toBeLessThan(title.y + title.height);
    expect(update.x + update.width).toBeLessThanOrEqual(390);
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

// The sample has no closed position: the API's answer gets a made-up one (a bond written off in an old account).
const OLD_BOND = "PLZZOLDBOND1";
const closedPosition = {
  account: "old-broker",
  isin: OLD_BOND,
  code: "OLD0513",
  name: "Old bond (made up)",
  type: "BOND_CORPORATE",
  currency: "PLN",
  firstDate: "2012-03-01",
  closedDate: "2013-05-31",
  quantity: 7,
  proceeds: 0,
  cost: 700,
  peakQuantity: 7,
  peakCost: 700,
  gain: -700,
  gainPct: -100,
  couponsReceived: 50,
};
const withClosed = (path: string) => (url: URL) => url.pathname.endsWith(path) && url.searchParams.get("closed") === "1";

test.describe("show closed", () => {
  test("holdings: closed positions greyed after the open ones, with the realised gain, not in the sums; their chart ranges count back from the close", async ({ page }) => {
    await page.route(withClosed("/holdings"), async (route) => {
      const res = await fetchFresh(route);
      const body = await res.json();
      expect(body.closed).toEqual([]); // the sample's own: none
      // Its flows: bought for 700, written off (nothing came back).
      const flows = { ...body.flows, [`old-broker|${OLD_BOND}`]: [["2012-03-01", -700], ["2013-05-31", 0]] };
      await route.fulfill({ response: res, json: { ...body, flows, closed: [closedPosition] } });
    });
    let historyAsked: URL | undefined;
    await page.route(
      (url) => url.pathname.endsWith("/holdings/history") && url.searchParams.get("isin") === OLD_BOND,
      async (route) => {
        historyAsked = new URL(route.request().url());
        await route.fulfill({ json: [{ date: "2012-03-01", value: 700, cost: 700, quantity: 7 }, { date: "2013-05-30", value: 350, cost: 700, quantity: 7 }] });
      },
    );
    await page.goto("/#/holdings");
    const totalBefore = await page.getByTestId("holdings-total").locator("td").nth(1).textContent();
    await expect(page.getByTestId("closed-row")).toHaveCount(0);
    const toggle = page.getByTestId("show-closed");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveClass(/active/);
    await expect(page.getByTestId("filters-summary")).toHaveText("10 of 10 holdings + 1 closed");
    const row = page.getByTestId("closed-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveClass(/closed/);
    await expect(page.getByTestId("closed-old-broker")).toContainText("Closed · 1");
    await expect(page.getByTestId("closed-old-broker").locator("td").nth(2)).toHaveText(""); // no summed cost
    await expect(page.getByTestId("closed-old-broker").locator("td").nth(3)).toHaveText(/^[-−]700,00\s*zł$/);
    await expect(row.getByTestId("closed-date")).toHaveText("closed 2013-05-31");
    await expect(row.locator("td").nth(1)).toHaveText("Corporate bond");
    await expect(row.locator("td").nth(2)).toHaveText("7");
    await expect(row.locator("td").nth(6)).toHaveText("700,00 zł");
    await expect(row.locator("td").nth(7)).toHaveText(/^[-−]700,00\s*zł$/);
    await expect(row.getByTestId("xirr")).toHaveText(/^[-−]100(,0+)?\s*%$/); // written off
    await expect(page.getByTestId("closed-old-broker").getByTestId("xirr")).toHaveText(/^[-−]100(,0+)?\s*%$/);
    await expect(row.locator("td").nth(10)).toHaveText("50,00 zł");
    // The account with only a closed position is a group of its own, after the others; the total is unchanged.
    const groups = await page.getByTestId("holdings-by-account").locator("tr.account-group").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(groups.at(-2)).toBe("account-ike");
    expect(groups.at(-1)).toBe("account-old-broker");
    await expect(page.getByTestId("holdings-total").locator("td").nth(1)).toHaveText(totalBefore!);

    // Its chart: the ranges count back from the close; ALL is the time it was held.
    await row.click();
    await expect(page).toHaveURL(/chart=PLZZOLDBOND1&chartAccount=old-broker/);
    await expect(page.getByTestId("chart-panel-title")).toContainText("held 2012-03-01 – 2013-05-31");
    await expect(page.getByTestId("holding-chart").locator("path.recharts-area-area")).toHaveCount(2);
    await expect.poll(() => historyAsked?.searchParams.get("from")).toBe("2012-05-31"); // 1Y before the close
    expect(historyAsked?.searchParams.get("to")).toBe("2013-05-31");
    await page.getByTestId("holding-range").getByRole("button", { name: "ALL" }).click();
    await expect.poll(() => historyAsked?.searchParams.get("from")).toBe("2012-03-01");
    await page.getByTestId("holding-range").getByRole("button", { name: "1Y" }).click();
    await page.keyboard.press("Escape");

    // Grouped by instrument: at the end, with the account; filters apply.
    await page.getByTestId("group-by").getByRole("button", { name: "Instrument" }).click();
    await expect(page.getByTestId("closed-instruments")).toContainText("Closed · 1");
    await expect(row.locator("td").nth(1)).toHaveText("old-broker");
    await page.getByTestId("filter-type").selectOption("ETF");
    await expect(page.getByTestId("closed-row")).toHaveCount(0);
    await page.getByTestId("filters-reset").click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true"); // the toggle isn't a filter: it stays
    // Grouped by class: at the end of its class.
    await page.getByTestId("group-by").getByRole("button", { name: "Class" }).click();
    await expect(page.getByTestId("closed-class-BONDS")).toContainText("Closed · 1");
    await expect(row.locator("td").nth(1)).toHaveText("old-broker");

    // One switch for Holdings and Prices while the app is open; a reload resets it.
    await page.getByTestId("nav-prices").click();
    await expect(page.getByTestId("show-closed")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("nav-holdings").click();
    await expect(page.getByTestId("closed-row")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("show-closed")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("closed-row")).toHaveCount(0);
  });

  test("prices: instruments held no more greyed after the others, with their last price; their chart ranges count back from the last trade", async ({ page }) => {
    const oldRow = { isin: OLD_BOND, code: "OLD0513", name: "Old bond (made up)", type: "BOND_CORPORATE", currency: "PLN", price: 48.5, priceDate: "2013-05-30", stale: false, manual: true, yearAgo: { date: "2012-05-30", price: 97 }, change1y: -0.5, closed: { firstDate: "2012-03-01", lastDate: "2013-05-31" }, assetClass: "BONDS" };
    await page.route(withClosed("/prices"), async (route) => {
      const res = await fetchFresh(route);
      const body = (await res.json()) as { code: string; closed?: unknown }[];
      expect(body.filter((r) => r.closed)).toEqual([]); // the sample's own: none
      await route.fulfill({ response: res, json: [...body, oldRow] });
    });
    let pricesAsked: URL | undefined;
    await page.route(`**/instruments/${OLD_BOND}/prices**`, async (route) => {
      pricesAsked = new URL(route.request().url());
      await route.fulfill({ json: [{ isin: OLD_BOND, venue: "MANUAL", date: "2012-03-01", close: 100, traded: true, currency: "PLN" }, { isin: OLD_BOND, venue: "MANUAL", date: "2013-05-30", close: 48.5, traded: true, currency: "PLN" }] });
    });
    await page.route(`**/instruments/${OLD_BOND}/transactions`, (route) => route.fulfill({ json: [] }));
    await page.goto("/#/prices");
    await expect(page.getByTestId("price-OLD0513")).toHaveCount(0);
    await page.getByTestId("show-closed").click();
    await expect(page.getByTestId("filters-summary")).toHaveText("7 of 7 instruments + 1 closed");
    const row = page.getByTestId("price-OLD0513");
    await expect(row).toHaveClass(/closed/);
    await expect(row.getByTestId("closed-flag")).toHaveText("closed 2013-05-31");
    await expect(row.locator("td").nth(4)).not.toContainText("stale");
    await expect(row.locator("td").nth(5)).toHaveText(/^[-−]50\s*%$/);
    const codes = await page.getByTestId("prices-table").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")));
    expect(codes.at(-1)).toBe("price-OLD0513"); // after the held ones
    await expect(page.getByTestId("prices-date")).not.toContainText("2013"); // "as of" the held ones

    // The ranges count back from a month after the last trade; ALL from a month before the first.
    await row.click();
    await expect.poll(() => pricesAsked?.searchParams.get("from")).toBe("2012-07-01");
    expect(pricesAsked?.searchParams.get("to")).toBe("2013-07-01");
    await page.getByTestId("price-range").getByRole("button", { name: "ALL" }).click();
    await expect.poll(() => pricesAsked?.searchParams.get("from")).toBe("2012-01-30");
  });
});

test.describe("buy, hold or sell", () => {
  test("every bond against the alternative if held and if bought, a verdict each; a row opens its breakdown; Holdings links to it", async ({ page }) => {
    await page.goto("/#/");
    const nav = page.getByTestId("nav-holdsell");
    await expect(nav).toContainText("Buy, hold or sell");
    await nav.click();
    await expect(page).toHaveURL(/#\/hold-sell/);
    await expect(page.getByRole("heading", { name: "Buy, hold or sell" })).toBeVisible();
    await expect(page.getByTestId("hs-mode")).toHaveCount(0); // one table, no switch
    const rows = page.getByTestId("hs-row");
    // The sample's bonds: DS0432 and the Bund in two accounts each, IZ0836, EDO0935, KRU0827.
    await expect(rows).toHaveCount(7);
    await expect(page.getByTestId("hs-cpi")).toHaveValue(/^\d+,\d{2}$/);
    for (const v of await rows.getByTestId("hs-verdict").allTextContents()) expect(["buy more", "hold", "sell", "matures soon"]).toContain(v);
    // Sells first, then buys, holds, maturing soon.
    const order = ["SELL", "BUY", "HOLD", "MATURES"];
    const decisions = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-decision")));
    expect(decisions.map((d) => order.indexOf(d!))).toEqual([...decisions.map((d) => order.indexOf(d!))].sort((x, y) => x - y));
    await expect(page.getByTestId("hs-summary")).toContainText("7 bond positions");
    // Both yields on a listed bond's row
    const ds = page.locator('[data-testid="hs-row"][data-code="DS0432"]').first();
    await expect(ds.getByTestId("hs-yield")).toHaveText(/\d%/);
    await expect(ds.getByTestId("hs-bought")).toHaveText(/\d%/);
    // A row's breakdown, in the URL: the sale today, the flows kept, one more bought today, the notes
    const iz = page.locator('[data-testid="hs-row"][data-code="IZ0836"]');
    await iz.click();
    await expect(page).toHaveURL(/row=broker/);
    const flows = page.getByTestId("hs-flows");
    await expect(flows).toContainText("2036-08-25");
    await expect(flows.locator("tbody tr").nth(-2)).toContainText("redemption");
    await expect(page.getByTestId("bm-cost")).toContainText("Accrued interest");
    await expect(page.getByTestId("bm-cost")).toContainText("Over the alternative");
    await expect(page.getByTestId("hs-breakdown")).toContainText("IZ indexation at CPI");
    expect(await page.getByTestId("hs-breakdown").locator(".hs-notes").evaluate((ul) => parseFloat(getComputedStyle(ul).paddingLeft))).toBeLessThan(24);
    await iz.click();
    await expect(page.getByTestId("hs-breakdown")).toHaveCount(0);
    // A retail row: if bought = the series of its kind on offer
    await page.locator('[data-testid="hs-row"][data-code="EDO0935"]').click();
    await expect(page.getByTestId("bm-bought")).toContainText("on offer");
    // Holdings: a badge on bond rows, linking to the row here.
    await page.goto("/#/holdings");
    const badge = page.locator('[data-testid="holding-row"][data-isin="PL0000117024"]').getByTestId("hs-badge");
    await expect(badge).toHaveText(/^(buy more|hold|sell|matures soon)$/);
    await badge.click();
    await expect(page).toHaveURL(/#\/hold-sell\?row=broker%23PL0000117024/);
    await expect(page.getByTestId("hs-breakdown")).toBeVisible();
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
    // GUS's own inflation figures, first: 12 months, per year, since December
    await expect(page.getByTestId("indicator-group-Inflation").locator("xpath=following-sibling::tr[1]")).toHaveAttribute("data-testid", "indicator-cpi-yoy");
    await expect(page.getByTestId("indicator-cpi-yoy").locator("td").nth(1)).toHaveText(/^-?\d+,\d%$/);
    const annual = page.getByTestId("indicator-cpi-annual");
    await expect(annual).toContainText("Inflation per year");
    await expect(annual.locator("td").nth(2)).toHaveText(/^\d{4}$/); // the latest whole year
    await annual.click();
    await expect(page.getByTestId("indicator-chart")).toHaveAttribute("data-points", "5"); // 5Y: five years
    await expect(page.getByTestId("indicator-chart").locator(".recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.getByTestId("indicator-cpi-ytd")).toContainText("Inflation since December");

    await mom.click();
    await expect(page).toHaveURL(/#\/indicators\?chart=cpi-mom$/);
    await expect(mom).toHaveClass(/selected/);
    await expect(page.getByTestId("indicator-title")).toContainText("Inflation, month on month");
    await expect(page.getByTestId("indicator-chart")).toHaveAttribute("data-points", "60"); // 5Y default: 60 months
    await expect(page.getByTestId("indicator-chart").locator(".recharts-bar-rectangle").first()).toBeVisible(); // (a 0.0% month draws no bar)

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
  test("opens the first note when you come to Notes, and the one open last time when you come back", async ({ page }) => {
    const stamp = Date.now();
    const ids: string[] = [];
    await page.goto("/#/notes");
    for (const title of [`E2E older ${stamp}`, `E2E newer ${stamp}`]) {
      await page.getByTestId("note-new").click();
      await page.getByTestId("note-title-input").fill(title);
      await page.getByTestId("note-body-input").fill("text");
      await page.getByTestId("note-save").click();
      await expect(page.getByTestId("note-title")).toHaveText(title);
      ids.push(new URL(page.url()).hash.match(/note=([a-f0-9]+)/)![1]!);
    }
    const [older, newer] = ids as [string, string];

    // A fresh page: nothing remembered, so the first note (the last changed) opens
    await page.goto("/#/");
    await page.reload();
    await page.getByTestId("nav-notes").click();
    await expect(page).toHaveURL(new RegExp(`#/notes\\?note=${newer}$`));
    await expect(page.getByTestId("note-title")).toHaveText(`E2E newer ${stamp}`);

    // Another view and back: the note open when leaving
    await page.getByTestId("note-item").filter({ hasText: `E2E older ${stamp}` }).click();
    await page.getByTestId("nav-holdings").click();
    await page.getByTestId("nav-notes").click();
    await expect(page).toHaveURL(new RegExp(`#/notes\\?note=${older}$`));
    await expect(page.getByTestId("note-title")).toHaveText(`E2E older ${stamp}`);

    for (const id of [older, newer]) {
      await page.goto(`/#/notes?note=${id}`);
      await page.getByTestId("note-delete").click();
      await page.getByTestId("note-delete-confirm").click();
      await expect(page).toHaveURL(/#\/notes$/);
    }
  });

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
    await expect(page.getByTestId("note-body-input")).toBeHidden(); // saved: the editor (with its own preview) closed
    await expect(page.getByTestId("note-rendered")).toHaveText("Just text now"); // the saved text at once, not the old one
    await expect(page.getByTestId("note-rendered").locator("em")).toHaveText("text");
    await page.reload();
    await expect(page.getByTestId("note-rendered")).toHaveText("Just text now");

    await page.getByTestId("note-delete").click();
    await page.getByTestId("note-delete-confirm").click();
    await expect(page).toHaveURL(/#\/notes$/);
    await expect(page.getByTestId("note-item").filter({ hasText: title })).toHaveCount(0);
  });
});

// The sample has no sales: the API's answer is made up (one sale across two buys, a redemption in an IKE, a write-off).
const salesResponse = {
  sales: [
    { id: "s3", type: "WRITE_OFF", account: "old-broker", isin: "PLZZOLDBOND1", code: "OLD0513", name: "Old bond (made up)", instrumentType: "BOND_CORPORATE", date: "2026-02-01", quantity: 3, proceeds: 0, cost: 300, gain: -300, gainPct: -100, pit: false, notPit: "write-off", pairs: [{ buyDate: "2024-02-01", quantity: 3, cost: 300, proceeds: 0, gain: -300, days: 731 }] },
    {
      id: "s1",
      type: "SELL",
      account: "broker",
      isin: "PL0000113783",
      code: "DS0432",
      name: "DS0432",
      instrumentType: "BOND_LISTED",
      date: "2025-05-15",
      quantity: 100,
      proceeds: 10300,
      cost: 9958,
      gain: 342,
      gainPct: 3.43,
      pit: true,
      pairs: [
        { buyDate: "2023-03-10", quantity: 60, cost: 5910, proceeds: 6180, gain: 270, days: 797 },
        { buyDate: "2024-06-02", quantity: 40, cost: 4048, proceeds: 4120, gain: 72, days: 347 },
      ],
    },
    { id: "s2", type: "REDEMPTION", account: "ike", isin: "PL0000113783", code: "DS0432", name: "DS0432", instrumentType: "BOND_LISTED", date: "2025-02-05", quantity: 5, proceeds: 520, cost: 500, gain: 20, gainPct: 4, pit: false, notPit: "IKE/IKZE", pairs: [{ buyDate: "2024-01-05", quantity: 5, cost: 500, proceeds: 520, gain: 20, days: 397 }] },
  ],
  years: [{ year: 2025, count: 1, proceeds: 10300, cost: 9958, gain: 342 }],
};

test.describe("sales", () => {
  test("the PIT-38 summary per year; sales newest first, folding out into their FIFO buys; filters in the URL", async ({ page }) => {
    await page.route("**/sales", async (route) => {
      const res = await fetchFresh(route);
      expect(await res.json()).toEqual({ sales: [], years: [] }); // the sample's own: none
      await route.fulfill({ response: res, json: salesResponse });
    });
    await page.goto("/");
    await page.getByTestId("nav-sales").click();
    await expect(page).toHaveURL(/#\/sales$/);
    await expect(page.getByRole("heading", { name: "Sales", level: 2 })).toBeVisible();

    const pit = page.getByTestId("pit-row");
    await expect(pit).toHaveCount(1);
    await expect(pit.locator("td").first()).toHaveText("2025");
    await expect(page.getByTestId("pit-gain")).toHaveText("342,00 zł");

    const rows = page.getByTestId("sale-row");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-id")))).toEqual(["s3", "s1", "s2"]);
    await expect(page.getByTestId("filters-summary")).toHaveText("3 of 3 sales · gain 62,00 zł");
    await expect(page.getByTestId("sale-not-pit")).toHaveText(["write-off", "IKE/IKZE"]);

    // A sale across two buys folds out into them, with the days each was held.
    await expect(page.getByTestId("sale-pair")).toHaveCount(0);
    await page.locator('[data-testid="sale-row"][data-id="s1"]').click();
    await expect(page).toHaveURL(/sale=s1/);
    const pairs = page.getByTestId("sale-pair");
    await expect(pairs).toHaveCount(2);
    await expect(pairs.first()).toContainText("bought 2023-03-10");
    await expect(pairs.first()).toContainText("797 days");
    await expect(pairs.nth(1)).toContainText("4 048,00 zł");

    // A year in the summary filters the list.
    await pit.click();
    await expect(page).toHaveURL(/year=2025/);
    await expect(rows).toHaveCount(2);
    await page.getByTestId("filter-account").selectOption("ike");
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("filters-summary")).toHaveText("1 of 3 sales · gain 20,00 zł");
    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(3);
  });

  test("on a phone: two-line rows, the pairs listed under the sale", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.route("**/sales", (route) => route.fulfill({ json: salesResponse }));
    await page.goto("/#/sales");
    const pit = page.getByTestId("pit-row");
    await expect(pit).toContainText("costs");
    expect(await page.getByTestId("pit").evaluate((p) => p.scrollWidth <= p.clientWidth)).toBe(true); // three columns, costs under proceeds
    const row = page.locator('[data-testid="sale-row"][data-id="s1"]');
    await expect(row).toContainText("2025-05-15 · broker · sale of 100");
    await row.getByRole("button").click();
    await expect(page.getByTestId("sale-pair")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("cash flows", () => {
  test("deposits and withdrawals per account and month of a year; a row folds out; the year in the URL", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-cashflows").click();
    await expect(page).toHaveURL(/#\/cash-flows$/);
    await expect(page.getByRole("heading", { name: "Cash flows", level: 2 })).toBeVisible();

    await page.getByTestId("cf-year").selectOption("2025");
    await expect(page).toHaveURL(/year=2025/);
    const closed = page.locator('[data-testid="cf-row"][data-account="closed"]');
    await expect(closed.getByTestId("cf-year-net")).toHaveText("-20");
    await expect(page.getByTestId("cf-total")).toBeVisible();

    await closed.click();
    await expect(page).toHaveURL(/account=closed/);
    await expect(page.getByTestId("cf-deposits")).toContainText("1 000");
    await expect(page.getByTestId("cf-withdrawals")).toContainText("1 020");
  });

  test("the spreadsheet link: made in the app, shown once as an IMPORTDATA formula, revoked after asking", async ({ page }) => {
    await page.goto("/#/cash-flows?year=2025");
    const state = page.getByTestId("cf-feed-state");
    await expect(state).toBeVisible();
    // A link left by an earlier run: revoke it first.
    if (await page.getByTestId("cf-revoke").isVisible()) {
      await page.getByTestId("cf-revoke").click();
      await page.getByTestId("cf-confirm").click();
    }
    await expect(state).toHaveText("No link.");

    await page.getByTestId("cf-create").click();
    const formula = page.getByTestId("cf-formula");
    await expect(formula).toHaveValue(/^=IMPORTDATA\("https?:\/\/.+\/feeds\/cash-flows\.csv\?year=2025&token=[A-Za-z0-9_-]{43}"\)$/);
    await expect(state).toContainText("not used yet");
    const url = /IMPORTDATA\("(.+)"\)/.exec(await formula.inputValue())![1]!;
    const csv = await page.request.get(url);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("closed,0,0,1000,0,0,0,-1020,0,0,0,0,0,-20");

    // Revoking asks first; then the link reads nothing.
    await page.getByTestId("cf-revoke").click();
    await expect(page.getByTestId("cf-confirm")).toHaveText("Revoke");
    await page.getByTestId("cf-confirm").click();
    await expect(state).toHaveText("No link.");
    await expect(formula).toHaveCount(0);
    expect((await page.request.get(url)).status()).toBe(404);
  });

  test("on a phone: two-line rows, the months under the open one", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/#/cash-flows?year=2025");
    const closed = page.locator('[data-testid="cf-row"][data-account="closed"]');
    await expect(closed).toContainText("in 1 000,00 zł");
    await closed.getByRole("button").click();
    await expect(page.getByTestId("cf-months").locator("li")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("sticky filters and header (Holdings, Prices)", () => {
  // The table may scroll sideways (a phone, a narrow window): a copy of its header floats under the filters instead.
  for (const [view, id] of [
    ["holdings", "holdings-by-account"],
    ["prices", "prices-table"],
  ] as const)
    for (const width of [1280, 390])
      test(`${view} at ${width} px: scrolled down, the filters stay at the top and the header right under them, its columns over the table's`, async ({ page }) => {
        await page.setViewportSize({ width, height: 420 });
        await page.goto(`/#/${view}`);
        await expect(page.getByTestId(id).locator("tbody tr").nth(3)).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 400));
        const tools = (await page.getByTestId(`${view}-toolbar`).boundingBox())!;
        const top = width < 720 ? (await page.locator(".sidebar").boundingBox())!.height : 0;
        expect(Math.abs(tools.y - top)).toBeLessThan(3);
        if (width < 720) expect(tools.height).toBeLessThan(100); // the search and a "Filters" button, not every dropdown
        const head = page.getByTestId(`${id}-head`);
        expect(Math.abs((await head.boundingBox())!.y - (tools.y + tools.height))).toBeLessThan(3);
        // Scrolled sideways: the header follows the table.
        await page.getByTestId(id).evaluate((t) => (t.parentElement!.scrollLeft = 150));
        const xs = (sel: string) => page.locator(sel).evaluateAll((ths) => ths.map((th) => Math.round(th.getBoundingClientRect().x)));
        // Both read on every try: the table's columns can still change width while data arrives.
        await expect
          .poll(async () => {
            const [floating, table] = [await xs(`[data-testid=${id}-head] th`), await xs(`[data-testid=${id}] thead th`)];
            return floating.join() === table.join() ? "aligned" : `header ${floating} vs table ${table}`;
          })
          .toBe("aligned");
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
});

test.describe("sorting by a column", () => {
  test("prices: a header click sorts, again reverses, a third goes back; kept in the URL; empty values last", async ({ page }) => {
    await page.goto("/#/prices");
    const codes = () => page.getByTestId("prices-table").locator("tbody tr td:first-child strong").allTextContents();
    const byCode = ["DE0001102523", "DS0432", "EDO0935", "IZ0836", "KRU0827", "SAMPLE-APARTMENT", "SPXS"];
    await expect(page.getByTestId("prices-table").locator("tbody tr")).toHaveCount(7);
    expect(await codes()).toEqual(byCode);

    await page.getByTestId("sort-instrument").click();
    await expect(page).toHaveURL(/#\/prices\?sort=instrument$/);
    await expect(page.getByTestId("prices-table").getByRole("columnheader", { name: /Instrument/ })).toHaveAttribute("aria-sort", "ascending");
    expect(await codes()).toEqual(byCode);

    await page.getByTestId("sort-instrument").click();
    await expect(page).toHaveURL(/#\/prices\?sort=-instrument$/);
    await expect.poll(codes).toEqual([...byCode].reverse());

    await page.getByTestId("sort-instrument").click();
    await expect(page).toHaveURL(/#\/prices$/);
    await expect.poll(codes).toEqual(byCode);

    // "1 year" starts with the highest; instruments without a year of history come last either way.
    await page.getByTestId("sort-change").click();
    await expect(page).toHaveURL(/#\/prices\?sort=-change$/);
    const changes = await page.getByTestId("prices-table").locator("tbody tr td:nth-child(6)").allTextContents();
    // A change reads "+1,23%"; "–" (none) and a retail bond's "6,00% before" (its rate, not a change) have no value.
    const values = changes.map((t) => (/^[+−-]?[\d\s]+,\d+\s%$/.test(t.trim()) ? Number(t.replace(/[^\d,−-]/g, "").replace(",", ".").replace("−", "-")) : null));
    const known = values.filter((v): v is number => v !== null);
    expect(known).toEqual([...known].sort((a, b) => b - a));
    expect(values.slice(known.length).every((v) => v === null)).toBe(true);

    // The sort survives a reload and a filter.
    await page.goto("/#/prices?sort=-instrument&type=BOND_LISTED");
    await expect.poll(codes).toEqual(["IZ0836", "DS0432"]);
  });
});

test.describe("catalyst view", () => {
  // The screen as the API serves it (int holds no Catalyst data): three listed bonds and a stale one.
  const liq = (level: string, traded30: number) => ({ level, traded30, traded90: traded30, medianTurnover30: 25_000, trades30: 12, medianSpread30: 0.4, bid: { price: 100, volume: 50 }, daysToSell10k: 2 });
  const row = (code: string, over: Record<string, unknown>) => ({
    isin: `PL${code}`.padEnd(11, "0") + "1",
    code,
    segment: "corporate",
    currency: "PLN",
    markets: ["GPW ASO"],
    maturity: "2029-08-12",
    nominal: 1000,
    issuer: "Kruk S.A.",
    coupon: { kind: "FLOATING", base: "WIBOR 3M", margin: 0.033 },
    couponText: "zmienne WIBOR 3M + 3.3%",
    date: "2026-11-05",
    market: "GPW ASO",
    price: 101,
    lastTraded: "2026-11-05",
    accruedInterest: 5.1,
    years: 2.75,
    yieldGross: 0.075,
    yieldNet: 0.061,
    projected: true,
    alternative: { label: "TOS1129 (retail, 3 y)", yieldNet: 0.039 },
    vsAlternative: 0.022,
    premium: 0.029,
    premiumBasis: "wz",
    liquidity: liq("high", 0.9),
    flags: [],
    ...over,
  });
  const DIMS = ["Debt Burden", "Debt Service", "Liquidity", "Profitability", "Asset Coverage", "Refinancing"];
  const signals = { state: "scored", ruleSet: "collector", confidence: "high", latestPeriodEnd: "2025-12-31", dimensions: DIMS.map((name) => ({ name, signal: name === "Asset Coverage" ? "red" : "green", ...(name === "Debt Burden" ? { arrow: "up" } : {}) })) };
  const screen = {
    date: "2026-11-05",
    computedAt: "2026-11-05T20:00:00Z",
    curve: { fixed: [{ years: 1, value: 0.04, code: "PS1127" }, { years: 5, value: 0.055, code: "DS1031" }], wz: [] },
    rows: [
      // Kruk: linked, AI analysis on, scored (red only in asset coverage). Abc: linked, AI analysis off.
      row("KRU0829", { entityId: "0000533217", issuerShort: "Kruk", issuerLegal: "Kruk S.A.", aiAnalysis: true, industry: "Finance", scorecard: signals }),
      row("ABC1227", { entityId: "0000000001", issuerShort: "Abc", issuerLegal: "Abc S.A.", aiAnalysis: false, issuer: "Abc S.A.", coupon: { kind: "FIXED", rate: 0.09 }, couponText: "stałe 9%", years: 1.1, yieldNet: 0.074, vsAlternative: 0.035, premium: 0.045, premiumBasis: "fixed-curve", projected: false, liquidity: liq("low", 0.1), nominal: 100 }),
      row("WAW0130", { segment: "municipal", issuer: null, coupon: undefined, couponText: null, yieldNet: null, yieldGross: null, vsAlternative: null, premium: null, liquidity: liq("medium", 0.5), flags: ["no-terms"] }),
      row("OLD0828", { issuer: "Old S.A.", yieldNet: 0.2, liquidity: liq("none", 0), flags: ["stale"] }),
    ],
  };
  let views: { name: string; params: Record<string, string> }[] = [];
  test.beforeEach(async ({ page }) => {
    views = [];
    await page.route("**/catalyst/bonds", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(screen) }));
    await page.route("**/catalyst/bonds/PL*", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ bond: { isin: "x", code: "KRU0829", maturity: "2029-08-12", firstSeen: "2024-01-02", markets: ["GPW ASO"] }, terms: { issuer: "Kruk S.A.", secured: false }, coupons: [{ start: "2020-08-12", end: "2020-11-12", paymentDate: "2020-11-12", rate: 0.07 }, { start: "2020-11-12", end: "2099-11-12", paymentDate: "2099-11-12", rate: 0.0713 }], market: "GPW ASO", sessions: [{ date: "2026-11-04", close: 100.9, trades: 2, turnover: 20000, nominal: 1000 }, { date: "2026-11-05", close: 101, trades: 1, turnover: 10000, nominal: 1000 }], quotes: [{ date: "2026-11-05", bid: { price: 100.8, volume: 50 }, ask: { price: 101.2, volume: 12 } }],
            events: [{ published: "2026-05-04T08:30:00", action: "suspension", reason: "na wniosek emitenta", signal: "routine", from: "2026-05-05T00:00:00", to: null, inForce: false }],
            track: {
              company: null,
              prefix: "KRU",
              since: "2020-01-02",
              counts: { repaid: 1, early: 1, "below-par": 0, "past-maturity": 0, listed: 1, unknown: 0 },
              bonds: [
                { isin: "x", code: "KRU0829", maturity: "2029-08-12", status: "listed", lastSeen: "2026-11-05", lastClose: null, outcome: "listed", inferred: false, note: "trading", flags: [], attention: [] },
                { isin: "y", code: "KRU0226", maturity: "2026-02-10", status: "ended", lastSeen: "2026-02-02", lastClose: 100.1, outcome: "repaid", inferred: true, note: "left at maturity (2026-02-10), last price 100.10", flags: [], attention: [] },
                { isin: "z", code: "KRU0625", maturity: "2025-06-20", status: "ended", lastSeen: "2024-11-05", lastClose: 100.5, outcome: "early", inferred: false, note: "excluded 2024-11-06: przedterminowy wykup obligacji", flags: [], attention: [] },
              ],
              flags: [],
              attention: [],
            },
          }) }),
    );
    await page.route("**/catalyst/views", async (r) => {
      if (r.request().method() === "PUT") views = (JSON.parse(r.request().postData() ?? "{}") as { views: typeof views }).views;
      await r.fulfill({ contentType: "application/json", body: JSON.stringify({ views }) });
    });
    // The companies: Kruk (scored, one year) and Abc (AI analysis off). Writes are recorded.
    writes = [];
    review = "parsed";
    abcAi = false;
    await page.route(/\/catalyst\/entities/, async (r) => {
      const url = new URL(r.request().url());
      const method = r.request().method();
      const body = (data: unknown) => r.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      if (method === "PUT") {
        const data = JSON.parse(r.request().postData() ?? "{}") as { status?: string; on?: boolean };
        writes.push(`${url.pathname.replace(/^.*\/catalyst/, "")} ${JSON.stringify(data)}`);
        if (data.status) review = data.status;
        if (url.pathname.endsWith("/0000000001/ai")) abcAi = data.on ?? false;
        return body(url.pathname.endsWith("/ai") ? { aiAnalysis: { on: data.on, by: "test", at: "2026-11-08T10:00:00Z" } } : { review: { status: data.status } });
      }
      if (url.pathname.endsWith("/catalyst/entities")) return body({ entities: [company("0000533217", "Kruk", true, "2026-11-02T09:00:00Z"), company("0000000001", "Abc", abcAi, null)] });
      if (url.pathname.includes("/years/")) return body({ period: "2025-12-31#group", currency: "PLN", presentedUnit: 1000, figures: { revenue: { value: 2_900_000_000, source: ["Revenue"] } }, lines: [{ statement: "income", order: 0, label: "Revenue", value: 2_900_000_000, page: 12 }, { statement: "income", order: 1, label: "Cost of sales", value: -900_000_000, page: 12 }] });
      if (url.pathname.endsWith("/0000000001")) return body(detail(company("0000000001", "Abc", abcAi, null), { state: "no-report", ruleSet: "general" }, []));
      return body(
        detail(
          company("0000533217", "Kruk", true, "2026-11-02T09:00:00Z"),
          {
            state: "scored",
            ruleSet: "collector",
            scorecard: { dimensions: DIMS.map((name) => ({ name, signal: name === "Asset Coverage" ? "red" : "green", metrics: [{ name: `${name} metric`, value: 1, formattedValue: "1.0×", signal: name === "Asset Coverage" ? "red" : "green" }] })), confidence: { level: "high", periodEnd: "2025-12-31", yearsBehind: 0, years: 3, missing: [], thinDimensions: [], facts: [] } },
            source: { format: "esef", scope: "group", latestPeriodEnd: "2025-12-31", years: 3, interim: { periodEnd: "2026-06-30", months: 6, label: "H1 2026", ttm: ["revenue"], comparative: "H1 2025" } },
            refinancing: { bonds: [{ isin: "x", name: "KRU0829", maturityDay: "2029-08-12", currency: "PLN", amount: 100_000_000 }], report: { periodEnd: "2025-12-31", scope: "group", currency: "PLN", cash: 400_000_000, due12: 0, due24: 0, listed: 100_000_000 }, signal: "green", notes: [] },
          },
          [{ period: "2025-12-31#group", periodStart: "2025-01-01", periodEnd: "2025-12-31", months: 12, scope: "group", currency: "PLN", column: "current", reportPeriodEnd: "2025-12-31", figures: { revenue: { value: 2_900_000_000, source: ["Revenue"] }, cash: { value: 400_000_000, source: ["Cash"] } }, review: { status: review }, filing: { key: "k", sha256: "abc", format: "esef", checks: [] }, enteredBy: "you", importedAt: "2026-11-03T10:00:00Z", lines: 2 }],
        ),
      );
    });
  });
  test.beforeEach(async ({ page }) => {
    await page.route("**/catalyst/work", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ kind: "judgement", who: "agent", entityId: "0000533217", name: "Kruk", detail: "no judgement yet" }, { kind: "lender-kind", who: "you", entityId: "0000533217", name: "Kruk", detail: "a Finance company of no known kind" }] }) }));
    await page.route("**/catalyst/checklist**", async (r) => {
      if (r.request().method() === "PUT") writes.push(`${new URL(r.request().url()).pathname.replace(/^.*\/catalyst/, "")} ${r.request().postData()}`);
      await r.fulfill({ contentType: "application/json", body: JSON.stringify({ checklist: [{ entityId: "0000000001", krs: "0000000001", year: 2025, scope: "group", where: "KRS repository, KRS 0000000001", status: "missing", by: "agent", at: "2026-11-08T10:00:00Z" }] }) });
    });
    agentToken = null;
    await page.route("**/catalyst/agent-token", async (r) => {
      const method = r.request().method();
      if (method === "POST") agentToken = { createdAt: "2026-11-08T10:00:00Z", lastUsedAt: null };
      if (method === "DELETE") agentToken = null;
      await r.fulfill({ status: method === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify(method === "POST" ? { token: "T".repeat(43), createdAt: "2026-11-08T10:00:00Z" } : { token: agentToken }) });
    });
  });
  let agentToken: { createdAt: string; lastUsedAt: string | null } | null = null;
  let writes: string[] = [];
  let review = "parsed";
  let abcAi = false;
  const company = (entityId: string, shortName: string, on: boolean, judgedAt: string | null) => ({
    entityId,
    shortName,
    legalName: `${shortName} S.A.`,
    country: "PL",
    krs: entityId,
    industry: "Finance",
    financeRuleSet: null,
    ruleSetOverride: null,
    aiAnalysis: { on },
    businessSummary: null,
    website: null,
    financialsEntityId: null,
    names: [`${shortName} S.A.`],
    bonds: 1,
    listed: 1,
    judgedAt,
  });
  const detail = (c: ReturnType<typeof company>, analysis: unknown, years: unknown[]) => ({
    company: c,
    analysis,
    years,
    filings: [],
    analyses: c.judgedAt ? [{ at: c.judgedAt, markdown: "# Kruk\n\n- Kruk S.A.\n\n| Dimension | Signal |\n|---|---|\n| Debt service | green |\n\n**Judgement:** Debt service is comfortable.\n\nWatch the next bond.", by: "agent", source: "agent" }] : [],
    documents: [{ sha256: "d".repeat(64), fileName: "audit.pdf", kind: "audit", date: "2026-03-31", title: "Auditor's report FY2025", size: 1000, by: "agent (claude)", at: "2026-11-08T10:00:00Z" }],
    collected: [],
    names: [],
    bonds: [],
    track: { company: c.shortName, prefix: null, since: "2020-01-02", counts: { repaid: 2, early: 0, "below-par": 0, "past-maturity": 0, listed: 1, unknown: 0 }, bonds: [], flags: [], attention: [] },
  });

  test("in the menu; every listed bond but the stale ones, the best net yield first", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-catalyst").click();
    await expect(page).toHaveURL(/#\/catalyst$/);
    await expect(page.getByRole("heading", { name: "Catalyst", level: 2 })).toBeVisible();
    await expect(page.getByTestId("catalyst-date")).toContainText("2026-11-05");
    const rows = page.getByTestId("catalyst-table").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-code")))).toEqual(["ABC1227", "KRU0829", "WAW0130"]);
    await expect(page.getByTestId("filters-summary")).toContainText("3 of 4 bonds (+ 1 stale, hidden)");
    const kru = rows.filter({ hasText: "KRU0829" });
    await expect(kru).toContainText("6,10%");
    await expect(kru).toContainText("+2,2%");
    await expect(kru).toContainText("WIBOR 3M".replace("WIBOR ", "W"));
    await expect(rows.filter({ hasText: "WAW0130" })).toContainText("no terms yet");

    await page.getByTestId("catalyst-stale").click();
    await expect(rows).toHaveCount(4);
  });

  test("filters and the sort are in the URL; a view saves them", async ({ page }) => {
    await page.goto("/#/catalyst");
    const rows = page.getByTestId("catalyst-table").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await page.getByTestId("catalyst-nom").selectOption("100");
    await expect(rows).toHaveCount(1); // only ABC1227 has a nominal of 100
    await page.getByTestId("catalyst-nom").selectOption("");
    await page.getByTestId("catalyst-liq").selectOption("medium");
    await expect(rows).toHaveCount(2); // KRU0829 (high) and WAW0130 (medium), not ABC1227 (low)
    await expect(page).toHaveURL(/liq=medium/);
    await page.getByTestId("sort-premium").click();
    await expect(page).toHaveURL(/sort=-premium/);
    await page.getByTestId("catalyst-view-new").click();
    await page.getByTestId("catalyst-view-name").fill("Liquid, small");
    await page.getByTestId("catalyst-view-save").click();
    await expect.poll(() => views.map((v) => [v.name, v.params["liq"], v.params["sort"]])).toEqual([["Liquid, small", "medium", "-premium"]]);
    await page.getByTestId("filters-reset").click();
    await expect(rows).toHaveCount(3);
    await page.getByTestId("catalyst-view").selectOption("Liquid, small");
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(/view=Liquid/);
    // Changing a view's filters and saving them into it, without retyping its name.
    await page.getByTestId("catalyst-liq").selectOption("high");
    await expect(page.getByTestId("catalyst-view")).toContainText("Liquid, small (changed)");
    await page.getByTestId("catalyst-view-update").click();
    await expect.poll(() => views.map((v) => [v.name, v.params["liq"]])).toEqual([["Liquid, small", "high"]]);
    await expect(page.getByTestId("catalyst-view-update")).toHaveCount(0);
  });

  test("the view's companies: only these or all but these; other companies' bonds on demand; saved with the view", async ({ page }) => {
    await page.goto("/#/catalyst");
    const rows = page.getByTestId("catalyst-table").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    // ＋ by Kruk's name: only Kruk's bonds; the others that pass the filters on demand, greyed.
    await rows.filter({ hasText: "KRU0829" }).hover();
    await rows.filter({ hasText: "KRU0829" }).getByTestId("catalyst-co-toggle").click();
    await expect(page).toHaveURL(/co=0000533217/);
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("catalyst-co")).toContainText("Only Kruk");
    await expect(page.getByTestId("catalyst-others")).toContainText("2 bonds from other companies match the other filters");
    await page.getByTestId("catalyst-others-toggle").click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "ABC1227" })).toHaveClass(/outside/);
    await rows.filter({ hasText: "ABC1227" }).getByTestId("catalyst-co-toggle").click();
    await expect(page).toHaveURL(/co=0000533217%2C0000000001/);
    // All but these: the bonds of every other company (here the one not linked).
    await page.getByTestId("catalyst-co").click();
    await expect(page.getByTestId("catalyst-co-list").locator("li")).toHaveCount(2);
    await page.getByTestId("catalyst-co-except").click();
    await expect(page).toHaveURL(/cm=out/);
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("catalyst-others")).toHaveCount(0);
    await page.getByTestId("catalyst-co-clear").click();
    await expect(page).not.toHaveURL(/co=|cm=/);
    await expect(rows).toHaveCount(3);
    // Added from the search; saved into a view.
    await page.getByTestId("catalyst-co-search").fill("kru");
    await page.getByTestId("catalyst-co-add").click();
    await expect(rows).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("catalyst-co-pop")).toHaveCount(0);
    await page.getByTestId("catalyst-view-new").click();
    await page.getByTestId("catalyst-view-name").fill("Kruk only");
    await page.getByTestId("catalyst-view-save").click();
    await expect.poll(() => views.map((v) => [v.name, v.params["co"]])).toEqual([["Kruk only", "0000533217"]]);
    // The issuer dialog takes it off the list too.
    await rows.filter({ hasText: "KRU0829" }).getByTestId("catalyst-issuer").click();
    await expect(page.getByTestId("issuer-view-toggle")).toHaveText("In this view");
    await page.getByTestId("issuer-view-toggle").click();
    await expect(page).not.toHaveURL(/co=/);
  });

  test("a row opens its panel: price and liquidity, the yield's make-up, the coupons", async ({ page }) => {
    await page.goto("/#/catalyst");
    await page.getByTestId("catalyst-table").locator("tbody tr").filter({ hasText: "KRU0829" }).click();
    await expect(page.getByTestId("catalyst-panel-title")).toContainText("KRU0829");
    const liquidity = page.getByTestId("catalyst-liquidity");
    await expect(liquidity).toContainText("Buy at (ask)101,20 · 12 bonds offered");
    await expect(liquidity).toContainText("Sell at (bid)100,80 · 50 bonds wanted");
    await page.getByTestId("catalyst-tab-yield").click();
    await expect(page.getByTestId("catalyst-yield-facts")).toContainText("TOS1129 (retail, 3 y)");
    await page.getByTestId("catalyst-tab-coupons").click();
    const periods = page.getByTestId("catalyst-coupons").locator("tbody tr");
    await expect(periods).toHaveCount(2);
    // The latest period first, and it's the current one.
    await expect(periods.first()).toContainText("2099-11-12");
    await expect(periods.first()).toHaveClass(/current/);
    await expect(periods.nth(1)).not.toHaveClass(/current/);
    await expect(page).toHaveURL(/tab=coupons/);
    await page.getByTestId("catalyst-tab-track").click();
    await expect(page.getByTestId("catalyst-track-summary")).toContainText("Bonds coded KRU… since2020-01");
    await expect(page.getByTestId("catalyst-track-summary")).toContainText("Repaid1Redeemed early1");
    await expect(page.getByTestId("catalyst-events")).toContainText("2026-05-04 suspended (na wniosek emitenta)");
    await expect(page.getByTestId("catalyst-track").locator("tbody tr")).toHaveCount(3);
  });

  test("the chart: the filtered bonds against the State's curve", async ({ page }) => {
    await page.goto("/#/catalyst?chart=1");
    await expect(page.getByTestId("catalyst-chart").locator(".recharts-scatter-symbol, .recharts-symbols, circle")).not.toHaveCount(0);
  });

  test("on a phone: three-line rows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/catalyst");
    await expect(page.getByTestId("catalyst-row")).toHaveCount(3);
    await page.getByTestId("catalyst-row").first().getByRole("button").click();
    await expect(page.getByTestId("catalyst-panel-title")).toBeVisible();
  });

  test("the issuer column: six dots, AI analysis off by default; filtered by the scorecard", async ({ page }) => {
    await page.goto("/#/catalyst");
    const rows = page.getByTestId("catalyst-table").locator("tbody tr");
    await expect(rows.filter({ hasText: "KRU0829" }).getByTestId("issuer-dots").locator(".cat-dot")).toHaveCount(6);
    await expect(rows.filter({ hasText: "KRU0829" }).locator(".cat-dot.red")).toHaveCount(1);
    await expect(rows.filter({ hasText: "ABC1227" }).getByTestId("issuer-ai-off")).toHaveText("AI analysis off");
    // No red in debt service and refinancing: Kruk (red only in asset coverage); "no red" at all: nobody.
    await page.getByTestId("catalyst-sc").selectOption("nored-sr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("KRU0829");
    await expect(page).toHaveURL(/sc=nored-sr/);
    await page.getByTestId("catalyst-sc").selectOption("nored");
    await expect(rows.first()).toContainText("No bonds match the filters.");
  });

  test("the issuer dialog: scorecard, judgement, a year marked hand-checked, the lines behind a figure", async ({ page }) => {
    await page.goto("/#/catalyst");
    await page.getByTestId("catalyst-table").locator("tbody tr").filter({ hasText: "KRU0829" }).getByTestId("catalyst-issuer").click();
    await expect(page).toHaveURL(/issuer=0000533217/);
    const dialog = page.getByTestId("issuer-dialog");
    await expect(dialog.getByTestId("issuer-name")).toHaveText("Kruk");
    await expect(dialog.getByTestId("issuer-dimension")).toHaveCount(6);
    await expect(dialog.getByTestId("issuer-source")).toContainText("ESEF, group accounts, FY2025 and 2 earlier + H1 2026 (TTM to 2026-06-30, unaudited) · judgement 2026-11-02");
    await expect(dialog.getByTestId("issuer-source-interim")).toContainText("+ H1 2026 (TTM to 2026-06-30, unaudited)");
    // The summary is the "Judgement:" paragraph, not the header.
    await expect(dialog.getByTestId("issuer-judgement")).toHaveText("Judgement: Debt service is comfortable.");
    await expect(dialog.getByTestId("issuer-bonds").locator("tbody tr")).toHaveCount(1);
    await dialog.getByTestId("issuer-tab-financials").click();
    await expect(page).toHaveURL(/itab=financials/);
    await expect(dialog.getByTestId("issuer-years")).toContainText("2 900,0");
    await dialog.getByTestId("issuer-year-check").click();
    await expect.poll(() => writes).toEqual([`/entities/0000533217/years/${encodeURIComponent("2025-12-31#group")} {"status":"hand-checked"}`]);
    await expect(dialog.getByTestId("issuer-year-review")).toContainText("hand-checked");
    await dialog.getByTestId("issuer-years").getByRole("button", { name: "2 900,0" }).click();
    await expect(dialog.getByTestId("issuer-lines")).toContainText("Revenue, FY2025");
    await expect(dialog.getByTestId("issuer-lines").locator("tbody tr")).toHaveCount(1);
    // Judgements render as GitHub Markdown (a table); other documents are listed with the statements.
    await dialog.getByTestId("issuer-tab-judgements").click();
    await expect(dialog.getByTestId("issuer-judgements").locator("table")).toHaveCount(1);
    await dialog.getByTestId("issuer-tab-documents").click();
    await expect(dialog.getByTestId("issuer-other-documents")).toContainText("Auditor's report FY2025");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/issuer=/);
  });

  test("the issuer dialog while the company loads: its summary's shape, pulsing", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/catalyst\/entities\/0000533217$/, async (r) => {
      await held;
      await r.fallback();
    });
    await page.goto("/#/catalyst?issuer=0000533217");
    const dialog = page.getByTestId("issuer-dialog");
    await expect(dialog.getByTestId("issuer-loading")).toBeVisible();
    release();
    await expect(dialog.getByTestId("issuer-judgement")).toBeVisible();
    await expect(dialog.getByTestId("issuer-loading")).toHaveCount(0);
  });

  test("AI analysis off: shown in place of the scorecard, enabled from the dialog", async ({ page }) => {
    await page.goto("/#/catalyst?issuer=0000000001");
    const dialog = page.getByTestId("issuer-dialog");
    await expect(dialog.getByTestId("issuer-ai-off-callout")).toContainText("AI analysis off");
    await dialog.getByTestId("issuer-ai-enable").click();
    await expect.poll(() => writes).toEqual(['/entities/0000000001/ai {"on":true}']);
    await expect(dialog.getByTestId("issuer-ai-switch")).toBeChecked();
  });

  test("the issuers view: one row per company, its switch, a row opens the dialog", async ({ page }) => {
    await page.goto("/#/catalyst");
    await page.getByTestId("catalyst-tab-issuers").click();
    await expect(page).toHaveURL(/#\/catalyst\/issuers$/);
    const rows = page.getByTestId("issuers-table").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Kruk" })).toContainText("2026-11-02");
    await expect(rows.filter({ hasText: "Abc" }).getByTestId("issuer-ai-off")).toBeVisible();
    await page.getByTestId("issuers-ai").selectOption("on");
    await expect(rows).toHaveCount(1);
    await page.getByTestId("issuers-ai").selectOption("");
    // The box shows the saved state: it's ticked once the switch is stored.
    await rows.filter({ hasText: "Abc" }).getByTestId("issuers-ai-switch").click();
    await expect.poll(() => writes).toEqual(['/entities/0000000001/ai {"on":true}']);
    await expect(rows.filter({ hasText: "Abc" }).getByTestId("issuers-ai-switch")).toBeChecked();
    await rows.filter({ hasText: "Kruk" }).click();
    await expect(page.getByTestId("issuer-dialog").getByTestId("issuer-name")).toHaveText("Kruk");
    await page.getByTestId("issuer-dialog").getByTestId("issuer-show-bonds").click();
    await expect(page).toHaveURL(/#\/catalyst\?co=0000533217/);
    await expect(page.getByTestId("catalyst-table").locator("tbody tr")).toHaveCount(1);
  });

  test("the yield headings explain themselves: an 'i' that opens on hover or a tap, without sorting", async ({ page }) => {
    await page.goto("/#/catalyst");
    await page.getByTestId("info-yield").hover();
    await expect(page.getByTestId("info-yield-text")).toContainText("after the 19% tax");
    await page.getByTestId("info-premium").click();
    await expect(page.getByTestId("info-premium-text")).toContainText("the State's floating bonds (WZ)");
    await expect(page).not.toHaveURL(/sort=/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("info-premium-text")).toHaveCount(0);
    await page.getByTestId("info-vsalt").click();
    await expect(page.getByTestId("info-vsalt-text")).toContainText("safe alternative");
  });

  test("the agent's token: made in the settings, shown once, with the login command; revoked after a confirmation", async ({ page }) => {
    await page.goto("/#/catalyst");
    await page.getByTestId("catalyst-settings-toggle").click();
    const panel = page.getByTestId("agent-token");
    await expect(panel.getByTestId("agent-token-state")).toHaveText("No token.");
    await panel.getByTestId("agent-token-create").click();
    await expect(panel.getByTestId("agent-token-value")).toHaveValue("T".repeat(43));
    await expect(panel).toContainText("npx catalyst login --stage");
    await expect(panel.getByTestId("agent-token-state")).toContainText("not used yet");
    await panel.getByTestId("agent-token-revoke").click();
    await panel.getByTestId("agent-token-confirm").click();
    await expect(panel.getByTestId("agent-token-state")).toHaveText("No token.");
    await expect(panel.getByTestId("agent-token-value")).toHaveCount(0);
  });

  test("the issuers view: what needs doing per company, and the reports checklist", async ({ page }) => {
    await page.goto("/#/catalyst/issuers");
    const kruk = page.getByTestId("issuers-table").locator("tbody tr").filter({ hasText: "Kruk" });
    await expect(kruk.getByTestId("issuers-work-cell")).toContainText("2 · yours");
    await page.getByTestId("issuers-work").selectOption("you");
    await expect(page.getByTestId("issuers-table").locator("tbody tr")).toHaveCount(1);
    await page.getByTestId("issuers-tab-checklist").click();
    await expect(page).toHaveURL(/tab=checklist/);
    const row = page.getByTestId("checklist-row");
    await expect(row).toContainText("Abc");
    await expect(row).toContainText("2025");
    await row.getByTestId("checklist-status").selectOption("downloaded");
    await expect.poll(() => writes).toEqual(['/checklist/0000000001/2025/group {"status":"downloaded"}']);
  });

  test("on a phone: the issuer dialog takes the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/catalyst?issuer=0000533217");
    const dialog = page.getByTestId("issuer-dialog");
    await expect(dialog.getByTestId("issuer-name")).toHaveText("Kruk");
    const box = await dialog.boundingBox();
    expect(box?.width).toBe(390);
  });
});
