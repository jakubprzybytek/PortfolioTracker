# PortfolioTracker – design notes

A simple personal portfolio tracker. **You enter your own transactions** (buys, sells, coupons, redemptions, fees); the app collects prices, values the portfolio every day and shows it as a table and charts.

Asset types: Polish treasury and corporate bonds (GPW / Catalyst), Polish retail treasury bonds (obligacje detaliczne), UCITS ETFs on EU exchanges, EU government bonds at IBKR, plus manually valued assets and cash.

Status (2026-10-23, `v0.135`): **the whole portfolio is in production** at https://portfoliotracker.albedoonline.com: every account and asset type from the reference sheet, priced daily (GPW, BiznesRadar, Yahoo, onvista, the Ministry's retail rates, NBP), valued every day with accrued interest (corporate bonds too, from their coupon periods), with today's prices on demand ("Update prices"), and judged against inflation and benchmarks (WIG, MSCI World, 40/60 World/EDO) in Performance. Transactions are entered in the app. Every push to `main` goes through `int` to `prod` automatically. What's left: "Outstanding work" below. See the root [README](../README.md) for how to run it.

| Document | Contents |
|---|---|
| [data-sources.md](data-sources.md) | Where each price comes from, per holding; IZ indexation; accrued interest |
| [data-storage.md](data-storage.md) | DynamoDB tables (`market`, `transactions`, `holdings`): items, keys, access patterns |
| [ingestion.md](ingestion.md) | Scheduled daily jobs, valuation, data quality rules |
| [backfill.md](backfill.md) | How history is loaded: triggers and order per source |
| [ui.md](ui.md) | Visualisation: holdings table and charts |
| [Development.md](Development.md) | Running locally, checking changes in the browser, tests, continuous delivery (every change goes to prod; when to ask first) |
| [nfr-analysis.md](nfr-analysis.md) | Non-functional review (observability, resilience, performance, security, durability, maintainability): findings and a suggested order of work |
| [reference/ReferenceFeatures.md](reference/ReferenceFeatures.md) | Feature inventory of the Google Sheets tracker the app reproduces (with its Apps Script code) |

## Scope

| Phase | Contents |
|---|---|
| 1 – Polish bonds | Done: treasury bonds on GPW (fixed and inflation-linked IZ), Catalyst corporate bonds, retail bonds (EDO, COI, ROD); transactions (import, then the app's form); daily valuation incl. accrued interest; table + charts |
| 2 – ETFs | Done: Yahoo end-of-day prices and backfill (EODHD as paid fallback); NBP FX; today's prices on demand ("Update prices": ETFs and every listed bond) |
| 3 – IBKR, FX | Done: foreign bonds (Börse Stuttgart closes via onvista; IBKR's mark prices via Flex for US T-bills), cash per currency, NBP rates; IBKR's history from its activity statements. Later: IBKR Flex for new trades |

## Architecture

```
                    ┌──────────────────────────── AWS (SST v4) ─────────────────────────────┐
CronV2 (Warsaw) ────┼─► eod-etf       19:00 (+07:00)    ETFs (Yahoo)                         │
                    ├─► eod-catalyst  19:30 (+08:00)    corporate bonds (BiznesRadar)        │
                    ├─► eod-gpw       20:30, 22:00 (+07:15 final)  treasury bonds (GPW XLS)  ├─► DynamoDB: market,
                    ├─► eod-bonds     22:10 (+07:10)    IBKR bonds (onvista, Stuttgart)      │   transactions, holdings
                    ├─► coupons       09:00             coupon periods (obligacje.pl)        │
                    ├─► fx            12:30, 16:30      NBP table A                          │
                    ├─► monthly       16th 10:00        CPI, IZ index, retail rates          │
                    ├─► export        1st 04:00         backup → S3 exports/<date>/          │
                    └─► valuation     22:30, 07:30 ──┐                                       │
                                                     ▼                                       │
  import, backfill, fx, monthly, coupons, api, live ──► ValuationQueue (FIFO, one at a time) ──► valuation
                                                     └─ 3 failures → ValuationDeadLetter     │
S3 upload imports/… ──► import (instruments, transactions, MF files) ──► backfill (history)  │
every job ──► S3 raw archive (write-only originals)                                          │
                                                                                             │
<stage>.portfoliotracker.albedoonline.com (Router/CloudFront)   login: Cognito (shared pool) │
   ├─ /*     ──► React UI (StaticSite)                                                       │
   └─ /api/* ──► ApiGatewayV2 ──► api ───────────────────────────────────────────────────────┘
                                  └─ POST /prices/refresh ──► live (today's quotes) ──► ValuationQueue
```

## Stack

Latest versions as of 2026-10-10; check `npm view <pkg> version` before adding anything new.

| Part | Choice | Version |
|---|---|---|
| Infra-as-code | SST | 4.17.2 |
| Language | TypeScript, Node 24 | 7.0.2 |
| Data | DynamoDB + S3 via `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` | 3.1149.0 |
| XLS parsing | SheetJS (`xlsx`, vendored tarball from cdn.sheetjs.com) | 0.20.3 |
| UI | Vite + React | 8.3.4 / 19.3.0 |
| Charts | Recharts (table is plain React: TanStack Table v9 has a new API not worth adopting for one table) | 3.10.1 |
| Tests | Vitest / Playwright | 5.0.3 / 1.64.0 |

Repo layout:

```
packages/core   parsers (GPW, Catalyst), IZ ratio, accrued interest, retail bonds, valuation – pure functions, tested
packages/jobs   Lambda handlers (daily jobs, live, valuation, backfill, import, export, api) + source clients
packages/web    Vite + React UI
sst.config.ts
Docs/
```

## Delivery

GitHub Actions on `main`: deploy `int` → integration + E2E tests → tag `v0.N` → deploy `prod` from the tag (see the root README).

| Stage | Deployed by | Data | URL |
|---|---|---|---|
| `prod` | CD, after `int` passes | yours (starts empty) | https://portfoliotracker.albedoonline.com |
| `int` | CD, every push to `main` | sample data, re-seeded by the tests | https://int.portfoliotracker.albedoonline.com |
| `dev` | you (`npm run dev -- --stage dev` or `npm run deploy -- --stage dev`) | sample data | https://dev.portfoliotracker.albedoonline.com |

Each stage has one domain: the site at `/`, the API at `/api/*` (CloudFront Router, same origin). Versions are minor tags `v0.1`, `v0.2`, …; the deployed version shows in the page footer.

## Key decisions

1. **DynamoDB on-demand is the only database.** No idle cost, no cold start; Aurora Serverless was rejected because polling keeps it awake. Volume is tiny.
   Three tables by lifecycle: `market` (instruments, prices, reference data; rebuildable), `transactions` (your input; the only irreplaceable data) and `holdings` (snapshots computed by valuation). See [data-storage.md](data-storage.md).
2. **Transactions are entered by you.** The history came from file imports (the spreadsheet, converted; IBKR from its activity statements); new ones are added in the app ("Add transaction" form on Transactions, Docs/ui.md), which is now the record. Sources: data-sources.md, "Where transactions come from". Coupon payments you enter are also used to check the calculated accrued interest.
3. **Accrued interest is computed, not fetched.** It comes from each bond's terms. Corporate bonds keep their interest periods with a rate each: the dates and the current rate come from obligacje.pl, past rates from your coupons or typed in; a period without a rate gives no accrued interest (see data-sources.md).
4. **ISIN is the internal key.** Each source's code/ticker is a mapping on the instrument.
5. **Store raw, unadjusted prices**; events (coupons, redemptions, splits, dividends) are stored separately.
6. **One code path for daily and backfill.** Every source adapter is `fetch → archive → parse → validate → upsert`; only the trigger and date range differ.
7. **Every job is idempotent and repairs gaps** over a look-back window (Catalyst bonds too: BiznesRadar's history page covers the last ~50 sessions).
8. **Keep every downloaded original in S3** (write-only) so parsers can be fixed and re-run.
9. **Values are recorded from day one.** Where no free history exists, the app's own database becomes the history.

## Estimated running cost

| Item | Monthly |
|---|---|
| DynamoDB (≈ 10k writes, few k reads, < 1 GB) | < $0.10 |
| Lambda, EventBridge, HTTP API, static site | ≈ $0 (free tier) |
| S3 raw archive | < $0.10 |
| EODHD (only if Yahoo gets blocked) | ≈ $20 |

## Open decisions / to verify

Phase 1:
- [x] Split the single DynamoDB table into `market`, `transactions` and `holdings` (data-storage.md), with per-function table links.
- [x] Load `prod`: MF calculator, `data/instruments.json`, and your real transactions (export of the sheet), plus retail bond series with purchase dates. `int` and `dev` hold `data/transactions.sample.json` (made-up).
- [x] Retail bonds valued per lot from the rates in the MF retail file (no CPI needed).
- [x] `sst dev` runs Lambdas locally, so scheduled jobs only run while it's up; use `npm run deploy -- --stage dev` for unattended collection.
- [x] Terms of each corporate bond held: ISIN and nominal (`data/private/catalyst.json`); coupon periods and rates in the app (2026-10-14).
- [x] Catalyst corporate bonds: prices from BiznesRadar (history + daily), valued at clean price × nominal; terms (ISIN, nominal) from obligacje.pl into `data/private/catalyst.json`. Redeemed bonds (gone from every quote page) are priced from your own trades. The accounts holding them are complete; their cash matches the sheet to the grosz.
- [x] Bossa: the public EOD files (`/pub/`) are gone (only CFD reports left); the quote JSON (`_cat_bonds`, with ISINs) is frozen at 2026-10-02 (NOL3 outage).
- [x] SST: `CronV2` (EventBridge Scheduler) takes `timezone: "Europe/Warsaw"`.
- [x] GUS monthly CPI m/m equals the MF calculator's `WR_k` (31 of 32 months 2024-01…2026-08; January differs by design, see data-sources.md). Source: the GUS CSV, no key (BDL has yearly CPI only).
- [x] GPW archive: full history per bond, or one file per day for all treasury bonds; no "last N" option (PoC, 2026-10-10).
- [x] Corporate bonds: not in the GPW archive; gpwcatalyst.pl lists all corporate bonds, snapshot only.
- [x] IZ indexed nominal and accrued interest: computed with the Ministry's method; exact match with published values.
- [x] IaC: SST v4.
- [x] Custom domains per stage and CD (int → tests → prod → tag); first release `v0.1` on 2026-10-11. Since 2026-10-18: int → tests → tag, then `prod` (and until 2026-10-23 `test`) deploy from the tag.

Later phases:
- [x] ETF source: Yahoo chart API works from Lambda for all 10 ETFs in the sheet, full daily history (data-sources.md). EODHD stays the fallback.
- [x] ETFs: Yahoo prices (history converted back to traded prices with the recorded splits: Yahoo has no split event for SPXS.AS), NBP rates since 2002, valuation in PLN, the sheet's ETF transactions (buys, sells, dividends, the SPXS 100:1 split). The ETF accounts are complete.
- [x] Cost basis FIFO (as the reference sheet and Polish tax): a sale takes the oldest lots first; each sale's matched cost and proceeds are kept for a closed-positions view. Checked against the sheet: every comparable position equal to the grosz.
- [x] ISIN + venue for every ETF (`data/private/etfs.json`, checked against FT).
- [x] Currencies all equal (2026-10-13): amounts and fees in the currency paid, `EXCHANGE`, cash per account and currency, PLN at NBP D-1 (Polish tax), accounts with their own currency (IBKR: EUR, its summary in EUR too). IBKR history re-converted from the sheet: cash per currency equal to its currency positions.
- [x] "Add transaction" form: add, edit, delete transactions in the app; new instruments by kind (treasury series by code, ETF by ticker, corporate bond, hand-valued asset). From 2026-10-13 the app, not the spreadsheet, is where transactions are entered.
- [x] IBKR from the sheet: currency positions (EUR, USD) and foreign zero-coupon bonds with calculated prices; IBKR is complete (cash per currency, bond quantities and costs equal to the sheet). All 753 sheet rows convert; every account is complete.
- [x] IBKR from its activity statements (2026-10-13): `scripts/ibkr-statements-to-transactions.ts`; the account's history rebuilt from IBKR's own records (cash per currency and cost basis equal to the statements; missing commissions, a coupon and interest added; one T-bill's ISIN corrected).
- [x] Monthly backup (`Export` job), values of hand-valued assets entered in the app, "Recalculating the valuation…" after every change (2026-10-14).
- [x] IBKR bonds priced from Börse Stuttgart closes via onvista (2026-10-14), within 0.015 of IBKR's marks; US T-bills stay calculated.
- [x] Today's prices on demand (2026-10-14): "Update prices" (until 2026-10-15 "Refresh") next to the valuation date fetches the current quotes of ETFs, IBKR bonds, Catalyst and treasury bonds and revalues today; Holdings and Prices show each price's time, or the date of an older one.
- [x] Accrued interest of corporate bonds (2026-10-14): interest periods per bond (first day, record day, payment day, rate) from obligacje.pl each morning (`coupons` job: new periods and the current rate, never replacing a stored one), past rates from the coupons you received (accepted with a click) or typed in, in the bond's chart panel ("Coupon periods"); coupons checked against the rate.
- [x] Valuation queue hardening (2026-10-14): a dead-letter queue after 3 failures; a revaluation drops the days of positions that are gone; the old single `Table` deleted from `prod`.
- [x] Revaluations write only what changed (2026-10-15): a day that comes out as stored is not written again, and of a changed day only the positions that moved get their position day rewritten (`{ force: true }` writes all). A full run had written ~64k units (~$0.045 per run and stage).
- [x] Notes (2026-10-15): free notes in Markdown in their own view (list by last change, edit with a live preview), in the monthly backup (`notes.json`).
- [x] Drawdown and allocation over time on the Dashboard (2026-10-15): drawdown on the time-weighted return (deposits and withdrawals don't count), shares/bonds/cash/other stacked to 100 % per day; both follow the portfolio chart's range.
- [x] IZ nominal on the price chart (2026-10-15): an inflation-linked bond's chart also shows its indexed nominal per bond (dashed, PLN, right-hand axis), so the months of negative CPI show as dips three months later.
- [x] Write-offs (2026-10-16): a `WRITE_OFF` transaction (the issuer defaulted, nothing came back) closes the units at 0; their cost is a realised loss, cash doesn't move.
- [x] Closed positions (2026-10-16): "Show closed" in Holdings and Prices adds the positions and instruments held no more, greyed, with their realised gain and coupons, and charts over the time they were held (gaps between holding periods at zero).
- [x] Finding things (2026-10-16): an "Instrument" text filter in Holdings and Prices; a position's transactions in its chart panel ("Transactions (n)"); Account first among the Transactions filters, notes on one line.
- [x] Phones (2026-10-17): Transactions as a list of two-line rows, filters in rows of two, the valuation date and "Update prices" on the title's row, the position's transactions in place of its chart; long transaction lists drawn 200 rows at a time.
- [x] Stage `test` (2026-10-16): the history before the app (2008–2022, accounts closed before it) converted from the history spreadsheet (`scripts/history-sheet-to-import.ts`, removed 2026-10-29) and imported; deployed by CD since 2026-10-17. Removed on 2026-10-23 (the history won't go to prod); it can be rebuilt from its spreadsheet (data/README.md, "History before the app").
- [x] Asset class per instrument (2026-10-18): set by hand where the rule (by type, "bond" in an ETF's name) is wrong; the allocation charts follow.
- [x] Instrument view (2026-10-18): the cog (⚙) in a chart panel (Prices, Holdings) opens one view with the instrument's properties: asset class, values entered by hand, coupon periods (until then separate buttons in the panel).
- [x] Chart panel controls (2026-10-18): one row with the title (range as a segmented control, as "Group by", everywhere; Transactions with a count badge, an icon up to 480 px; ⚙; ✕), all the same height; on a phone the controls on the row below the title.
- [x] Hold or sell (2026-10-18): every bond kept to maturity against sold today with the money in the retail bond on offer, after tax and fees; its own view, a badge in Holdings.
- [x] Sales (2026-10-20): a Sales view, every disposal with its FIFO buys, and the PIT-38 summary per year (road map 9).
- [x] XIRR per position, account, instrument and class in Holdings (2026-10-20), from the positions' own cash flows (cash left out), and Group by Class (road map 20).
- [x] Performance view (2026-10-21): the Dashboard keeps where things stand now (cards, now with the year so far against inflation, profit breakdown, asset mix, portfolio value, accounts, allocation); returns by year, return and inflation, growth of 100 zł, drawdown and allocation over time moved to Performance (its own range, in the URL); the jobs table to a Status page (linked from the menu's foot and the failed-jobs banner).
- [x] Returns by year against inflation (2026-10-21): a Dashboard table per calendar year (start, put in, end, profit, time-weighted return, inflation December on December from GUS, real return, XIRR) and the whole history a year; a pair of bars per year with the real return as a dot; the growth of 100 zł against CPI over the chart's range (road map 10, its CPI part).
- [x] Benchmarks (2026-10-23, road map 10): WIG (GPW archive) and MSCI World (IWDA.AS, Yahoo, EUR at NBP) fetched daily by a `benchmarks` job into `BENCH#<id>` (apart from the instruments), a 40/60 MSCI World/EDO mix computed by the API (the EDO series on sale on the first day, held; weights kept daily) and an "inflation + 2 %" line: lines on the growth of 100 zł, tinted columns right after Return in Returns by year (ui.md, "Performance").
- [x] Buy, hold or sell (2026-10-23): Hold or sell and Buy more merged into one view: per bond position the yield if held (from what a sale brings) and if bought (from what one more costs: last price, accrued interest, commission), both after tax against the same alternative, and one verdict: sell, hold, buy more, or matures soon (under 3 months); the breakdown adds real yield, spread, duration and weight (ui.md, "Buy, hold or sell").
- [x] Performance in two parts (2026-10-23): By year (the whole history) and Over time (the range picker next to its heading); Returns by year drops the money columns and XIRR on narrower screens instead of scrolling sideways, and its header is the same while loading.
- [x] Stage `test` removed (2026-10-23): the 2008–2022 history won't go to prod (road map 22 dropped); everything on it came from the files the "Transactions 2008-2022" sheet rebuilds (data/README.md). CD deploys `prod` only, a plain job.
- [x] Valuation speed with a long history (2026-10-17/18, measured on `test`: 6,792 days since 2008): the Dashboard charts read a ~250-byte chart point per day instead of whole snapshots ("ALL" had read 13 MB in ~5 s); the valuation walks the transactions once and compares days by fingerprint (computing all days 7.1 s → 0.3 s), writes in batches, merges requests waiting together and starts from the earliest day a change touches (a forced rewrite 182 s → 13.5 s; a run with nothing to write 77 s → ~2 s).

## Outstanding work (2026-10-23)

The app holds the whole portfolio (every account and asset type from the sheet) and new transactions are entered in it; IBKR matches its statements to the cent. Compared with the sheet on 2026-10-13 (before IBKR was rebuilt): quantities, cash, costs, net deposits, income and fees equal; values differ only where noted below (−0.08 % in total). Done: 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24. Dropped: 22. Open: 10 (its money-weighted variant), 11 (IBKR trades; its prices done), 25, and the non-functional review's list (nfr-analysis.md: "Day 1" done on 2026-10-15, "Week 1" and "Later" open). Suggested next: the non-functional review's "Week 1" list, and refilling the gaps the `quality` job found (AYE2).

### Correctness and accuracy
1. ~~Foreign bonds at IBKR are priced by calculation~~ Done (2026-10-14): the EUR bonds are priced from Börse Stuttgart's closes (onvista, `eod-bonds`), within 0.015 of IBKR's marks; the calculated prices had been up to 1 % off. US T-bills (none held now) stay calculated.
2. ~~Accrued interest of listed treasury bonds~~ Done (2026-10-15): listed treasury and Catalyst corporate bonds carry accrued interest (and IZ their indexed nominal) to the settlement day, T+2, as gpwcatalyst.pl and the sheet; it had been to the valuation day (IZ0836: 3,09 instead of 3,33 PLN per bond on 2026-10-15). Settlement days from a Polish holiday calendar (data-sources.md).
3. ~~Corporate bonds are valued clean~~ Done (2026-10-14): coupon periods with a rate each (obligacje.pl, your coupons, or typed in); a period without a rate is flagged "no rate" and valued clean.
4. ~~Holdings row charts after an edit or a delete~~ Done (2026-10-14): a revaluation removes the days of positions that are gone; the days left by earlier edits were cleaned up on `prod` (1,856, all from the IBKR rebuild).
5. ~~Dashboard cards vs the chart~~ Done (2026-10-13): Total, Cash, Net deposits, Profit cards; the profit split into unrealised, realised, income, fees, currency and other; unrealised and realised per account.
6. ~~The monthly job revalues retail bonds for nothing~~ Done (2026-10-28): it compared each retail bond's terms with the stored ones as JSON text, and DynamoDB returns a stored map's keys in its own order, so every retail bond (31 on prod) counted as changed on every run: its instrument rewritten and a revaluation queued. Now compared whatever the key order (`canonicalJson`), as are an instrument import's splits, price path and source ids (a false change there started a backfill).

### Missing compared with the sheet
7. ~~Update the value of a hand-valued asset~~ Done (2026-10-14): "Edit values" in its chart panel (Prices, Holdings), values listed and deletable (ui.md).
8. ~~Targets and rebalancing~~ Done (2026-10-18): a target share and a band per class (shares, bonds, cash, other) in the Dashboard's asset mix (ticks on its bar; the legend gives each class's share, its target and the difference), and a calculator folding out under "Rebalance" switching between "New money" (a deposit split across the classes below target, nothing sold) and "Sell and buy" (every class to its target) (ui.md, "Targets").
9. ~~Closed positions~~ Done (2026-10-20): realised gain per account (Dashboard), per closed position ("Show closed" in Holdings, 2026-10-16), and a **Sales** view: every sale, redemption and write-off folding out into the buys FIFO matched it against (cost, share of the proceeds, days held), and per year a PIT-38 summary (proceeds, costs, profit at NBP D-1; outside IKE/IKZE, without write-offs and retail bonds) (ui.md, "Sales"). Not done: the sheet's dividends assigned to each pair.
10. **Benchmarks** (mostly done), as the sheet's Benchmarki tab. CPI done (2026-10-21): returns by year against inflation and the growth of 100 zł against CPI, now in Performance (ui.md, "Performance"). Indices and CPI + a margin done (2026-10-23): WIG (GPW archive) and MSCI World (IWDA.AS, Yahoo) as lines on the growth of 100 zł and columns in Returns by year, plus an "inflation + 2 %" line and a 40/60 MSCI World/EDO mix (2026-10-23, computed from IWDA and the EDO series on sale on the first day, rebalanced daily); a fixed list, stored apart from the instruments by a `benchmarks` job (ui.md, "Performance"). Left, not planned now: the sheet's money-weighted variant (your own deposits put into the benchmark instead), and a benchmark following your own targets (the 40/60 is fixed). Sources checked: GPW's archive has every GPW index (WIG since 1991, WIG20TR, mWIG40TR, sWIG80TR since 2017); Yahoo has world ETFs (IWDA.AS EUR since 2009, CSPX.L, ACWI.L, V80A.DE) but its Polish indices are short; Stooq is blocked.
11. **IBKR Flex Web Service** (prices done). Mark prices done (2026-10-28): a daily `eod-ibkr` job reads IBKR's positions statement (Flex Query 1688199: Open Positions and Prior Period Positions; token in the `IbkrFlexToken` secret, dev and prod) and stores IBKR's mark price for every instrument priced from IBKR (venue `IBKR`: the US T-bill US912797WJ22, until then calculated), the trade day at the trade price (IBKR reports from settlement); it also compares the onvista closes of the EUR bonds with IBKR's marks and lists positions at IBKR the app doesn't know (data-sources.md, "IBKR Flex Web Service"). Left, not planned: IBKR trades without downloading statements (the same service, a query with trades and cash; needs a duplicate check against what's entered in the app).
12. ~~More charts: income per year~~ Done (2026-10-23): "Income by year" in Performance's By year part, next to Return and inflation (coupons, dividends and interest stacked per year, PLN at NBP D-1), rather than on the Dashboard, which shows where things stand now (ui.md, "Performance"). (Drawdown and allocation over time done on 2026-10-15.)
13. ~~Asset class per instrument~~ Done (2026-10-18): a "Class" column and filter in Prices and a "Class" select in the instrument's settings (the cog in its chart panel); one class per instrument (shares, bonds, cash, other), the rule (by type, "bond" in an ETF's name) unless set by hand; a change revalues the instrument's history.
24. ~~Cash flows and the spreadsheet feed~~ Done (2026-10-20): a **Cash flows** view (the sheet's "Wpłaty/wypłaty" tab): deposits, withdrawals and their balance per account and month of a year, in PLN at NBP D-1; and a link (`IMPORTDATA`) that serves the same figures as CSV, laid out as the tab's summary, to the spreadsheet that imported the tab. The link's token is made, replaced and revoked in the app (ui.md, "Cash flows" and "Access"). Not carried over: the tab's per-account class split and the IKE/IKZE limits.
20. ~~XIRR per account, per asset class and per instrument~~ Done (2026-10-20): with cash, from deposits and withdrawals, on the Dashboard (card and Accounts table, `core/valuation/accounts.ts`); without cash, from the positions' own cash flows (buys, sales, redemptions, coupons, dividends, fees, PLN at NBP D-1) plus their value today, in Holdings: per position, account header, instrument in several accounts, class and the total (of what the filters show), and per closed position over the time it was held. Computed on the fly: `GET /holdings` sends each position's flows, the browser sums any set of rows (`core/valuation/xirr.ts`). Holdings' **Group by Class** (shares, bonds, cash, other) came with it (ui.md, "Holdings").

### Operations and housekeeping
14. ~~`prod`: drop the old `Table`~~ Done (2026-10-14): it was empty; removed from `sst.config.ts` and deleted in AWS.
15. ~~`prod`: the "EUR cash" / "USD cash" instruments~~ Done (2026-10-14): marked inactive (no transaction uses them).
16. ~~Alerts on failed jobs~~ Done (2026-10-23): e-mail through an SNS topic on prod: a job that starts failing or works again (one message per change, from `runJob`), and CloudWatch alarms on the valuation's errors or timeouts and on the dead-letter queue. Not covered: other jobs timing out, a schedule that stops firing (ingestion.md, "Failure handling").
17. ~~Data-quality checks~~ Done (2026-10-23): a daily `quality` job checks the last year of every held quoted instrument for missing prices, prices that stopped, jumps and bond prices out of range; the report is on the Status page, new issues are e-mailed (ingestion.md, "Data quality rules"). A check of prod's prices on 2026-10-23 found 22 issues (Yahoo holes on two days, a month without AYE2 prices). Still by hand: spot checks against a second source and month-end values against broker statements (done for IBKR's cash and costs, 2026-10-13).
18. ~~Monthly export of `transactions` to S3~~ Done (2026-10-14): the `Export` job backs up accounts, instruments, prices entered by hand and transactions to `exports/<date>/` on the 1st, in the import formats (data-storage.md, restore: data/README.md).
21. ~~Responsiveness when switching views~~ Done (2026-10-15): `useApi` goes through SWR, so a view visited before shows its last data at once and refetches it in the background (placeholders only the first time); a save or a finished valuation refetches what's on screen. **Reload** in the menu frame refetches the current view without asking the server for anything new; its icon turns while any request is under way. The "Refresh" button next to the valuation date is now **Update prices**, with its own icon (ui.md).
22. ~~History import to `prod`~~ Dropped (2026-10-23): the history before the app (2008–2022) won't be imported to `prod`; prod's history starts with its own transactions (2022-03). Stage `test`, which held it, was removed the same day; the spreadsheet can rebuild it (data/README.md, "History before the app").
23. ~~Valuation speed with a long history~~ Done (2026-10-18): chart points, one pass over the transactions, batched writes, merged requests (done list above).
25. ~~Leftovers from work in progress~~ Done (2026-10-29): reviewed read-only first (prod checked: no account incomplete, every snapshot with its accounts, every chart point with a fingerprint), then removed: accounts marked incomplete (the flag, its greyed rows and notes, cash and totals that left them out; the sample's `etf` account), the one-off converter of the reference sheet (`fromSheet.ts`, `scripts/sheet-to-transactions.ts`, their tests; in git history), the instruments' unused `live` flag, `querySnapshots` and `scanPositionDays` (nothing called them), `poc/`, and the old calculated prices (`PX#CALC`, 1,564 rows) of the three IBKR bonds now quoted (US912797WJ22, DE0001102523, FR0014003513). Kept: calculated prices for retail bonds and redeemed IBKR bonds, the history and IBKR statement converters (they rebuild data). Removed too (2026-10-29): `history-sheet-to-import.ts`, as the "Transactions 2008-2022" sheet and its converter replaced it.
26. ~~Non-functional review~~ Done (2026-10-29): every finding of nfr-analysis.md worked through but MFA (by choice): a watchdog and JSON logs, timeouts on every request, a versioned files bucket and a separate backups bucket, security headers (CSP), an audit trail of transaction edits, views loaded on demand, ETags, Biome in CI, the API as a route table, Warsaw dates, contrast and a table under the portfolio chart. The status of each finding: nfr-analysis.md, "Status".

### Beyond the sheet
19. ~~Hold or sell a bond~~ Done (2026-10-18): a "Hold or sell" view: every bond position kept to maturity against sold today (early redemption for retail bonds, with the Ministry's fee) with the money in the retail bond on offer with the nearest term (or a rate you set), after tax (none in IKE/IKZE); yield if held, the alternative's yield, the difference in PLN at maturity, hold / sell / about the same; a breakdown per position; assumptions (CPI, WIBOR, NBP rate, commission) kept; a badge on Holdings' bond rows (ui.md, "Buy, hold or sell"; since 2026-10-23 with "if bought" and a buy-more verdict). All kinds: listed fixed and IZ, retail, corporate (fixed and floating), IBKR. Later: a CPI or WIBOR path per year instead of one flat rate; a listed DS of similar maturity as the alternative.
