# PortfolioTracker – design notes

A simple personal portfolio tracker. **You enter your own transactions** (buys, sells, coupons, redemptions, fees); the app collects prices, values the portfolio every day and shows it as a table and charts.

Asset types: Polish treasury and corporate bonds (GPW / Catalyst), Polish retail treasury bonds (obligacje detaliczne), UCITS ETFs on EU exchanges, EU government bonds at IBKR, plus manually valued assets and cash.

Status (2026-10-11): **phase 1 in production as `v0.1`** at https://portfoliotracker.albedoonline.com (treasury bonds on GPW: import, backfill, daily jobs, valuation, API, dashboard; unit, integration and E2E tests). Every push to `main` goes through `int` to `prod` automatically. Retail bond calculator exists in `core` but isn't wired in yet (needs your series). See the root [README](../README.md) for how to run it.

| Document | Contents |
|---|---|
| [data-sources.md](data-sources.md) | Where each price comes from, per holding; IZ indexation; accrued interest |
| [data-storage.md](data-storage.md) | DynamoDB tables (`market`, `transactions`, `holdings`): items, keys, access patterns |
| [ingestion.md](ingestion.md) | Scheduled daily jobs, valuation, data quality rules |
| [backfill.md](backfill.md) | How history is loaded: triggers and order per source |
| [ui.md](ui.md) | Visualisation: holdings table and charts |
| [reference/ReferenceFeatures.md](reference/ReferenceFeatures.md) | Feature inventory of the Google Sheets tracker the app reproduces (with its Apps Script code) |

## Scope

| Phase | Contents |
|---|---|
| **1 – Polish bonds** (now) | Treasury bonds on GPW (fixed and inflation-linked IZ), Catalyst corporate bonds, retail bonds (EDO, COI, ROD); transactions import; daily valuation incl. accrued interest; table + charts |
| 2 – ETFs | Yahoo end-of-day prices and backfill (EODHD as paid fallback); NBP FX; later "live" (15-min delayed) quotes |
| 3 – IBKR, FX | Done: foreign bonds (calculated prices), cash per currency, NBP rates; IBKR's history from its activity statements. Later: IBKR Flex for new trades and mark prices |

## Architecture

```
                         ┌──────────────────────────── AWS (SST v4) ────────────────────────────┐
sst.aws.Cron ────────────┼─► Lambda eod-gpw  20:30, 22:00   treasury bonds, daily all-bonds XLS   │
                         ├─► Lambda eod-catalyst   19:30   corporate bonds (BiznesRadar)         │
                         │                         (+08:00 next morning)                         ├──► DynamoDB: market, transactions, holdings
                         ├─► Lambda monthly        16th    CPI, IZ reference index, retail rates  │        ▲
                         └─► Lambda valuation      22:30 + 07:30                                 │        │
                                                                                                 │   Lambda backfill  ◄── manual (sst shell / CLI)
                                                                                                 │        ▲ new instruments
S3 upload imports/… ──────────► Lambda import (Bossa / Cbonds / MF files, transactions) ──────────┤────────┘
                                                                                                 │
every job ──► S3 raw archive (sst.aws.Bucket, write-only originals)                              │
                                                                                                 │
<stage>.portfoliotracker.albedoonline.com (sst.aws.Router/CloudFront)   login: Cognito (shared pool) │
   ├─ /*     ──► React UI (sst.aws.StaticSite)                                                  │
   └─ /api/* ──► sst.aws.ApiGatewayV2 ──► Lambda api ─────────────────────────────────────────┘
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
packages/jobs   Lambda handlers (cron, backfill, import, api) + scripts for sst shell
packages/web    Vite + React UI
sst.config.ts
Docs/
```

## Delivery

GitHub Actions on `main`: deploy `int` → integration + E2E tests → deploy `prod` → tag `v0.N` (see the root README).

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
3. **Accrued interest is computed, not fetched.** It comes from each bond's terms. The only external input is the coupon rate per period of floating-rate corporate bonds (see data-sources.md).
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
- [x] Terms of each corporate bond held: ISIN and nominal (`data/private/catalyst.json`); rates and coupon dates aren't needed while values are clean (see Outstanding work).
- [x] Catalyst corporate bonds: prices from BiznesRadar (history + daily), valued at clean price × nominal; terms (ISIN, nominal) from obligacje.pl into `data/private/catalyst.json`. Redeemed bonds (gone from every quote page) are priced from your own trades. The accounts holding them are complete; their cash matches the sheet to the grosz.
- [x] Bossa: the public EOD files (`/pub/`) are gone (only CFD reports left); the quote JSON (`_cat_bonds`, with ISINs) is frozen at 2026-10-02 (NOL3 outage).
- [x] SST: `CronV2` (EventBridge Scheduler) takes `timezone: "Europe/Warsaw"`.
- [x] GUS monthly CPI m/m equals the MF calculator's `WR_k` (31 of 32 months 2024-01…2026-08; January differs by design, see data-sources.md). Source: the GUS CSV, no key (BDL has yearly CPI only).
- [x] GPW archive: full history per bond, or one file per day for all treasury bonds; no "last N" option (PoC, 2026-10-10).
- [x] Corporate bonds: not in the GPW archive; gpwcatalyst.pl lists all corporate bonds, snapshot only.
- [x] IZ indexed nominal and accrued interest: computed with the Ministry's method; exact match with published values.
- [x] IaC: SST v4.
- [x] Custom domains per stage and CD (int → tests → prod → tag); first release `v0.1` on 2026-10-11.

Later phases:
- [x] ETF source: Yahoo chart API works from Lambda for all 10 ETFs in the sheet, full daily history (data-sources.md). EODHD stays the fallback.
- [x] ETFs: Yahoo prices (history converted back to traded prices with the recorded splits: Yahoo has no split event for SPXS.AS), NBP rates since 2002, valuation in PLN, the sheet's ETF transactions (buys, sells, dividends, the SPXS 100:1 split). The ETF accounts are complete.
- [x] Cost basis FIFO (as the reference sheet and Polish tax): a sale takes the oldest lots first; each sale's matched cost and proceeds are kept for a closed-positions view. Checked against the sheet: every comparable position equal to the grosz.
- [x] ISIN + venue for every ETF (`data/private/etfs.json`, checked against FT).
- [x] Currencies all equal (2026-10-13): amounts and fees in the currency paid, `EXCHANGE`, cash per account and currency, PLN at NBP D-1 (Polish tax), accounts with their own currency (IBKR: EUR, its summary in EUR too). IBKR history re-converted from the sheet: cash per currency equal to its currency positions.
- [x] "Add transaction" form: add, edit, delete transactions in the app; new instruments by kind (treasury series by code, ETF by ticker, corporate bond, hand-valued asset). From 2026-10-13 the app, not the spreadsheet, is where transactions are entered.
- [x] IBKR from the sheet: currency positions (EUR, USD) and foreign zero-coupon bonds with calculated prices; IBKR is complete (cash per currency, bond quantities and costs equal to the sheet). All 753 sheet rows convert; every account is complete.
- [x] IBKR from its activity statements (2026-10-13): `scripts/ibkr-statements-to-transactions.ts`; the account's history rebuilt from IBKR's own records (cash per currency and cost basis equal to the statements; missing commissions, a coupon and interest added; one T-bill's ISIN corrected).

## Outstanding work (2026-10-14)

The app holds the whole portfolio (every account and asset type from the sheet) and new transactions are entered in it; IBKR matches its statements to the cent. Compared with the sheet on 2026-10-13 (before IBKR was rebuilt): quantities, cash, costs, net deposits, income and fees equal; values differ only where noted below (−0.08 % in total). Suggested order: 19, 8.

### Correctness and accuracy
1. **Foreign bonds at IBKR are priced by calculation** (constant yield from the trades to 100 % at maturity), not quoted; the sheet's price for one of them differs by about 1 %. Mark prices from IBKR Flex (11) would settle it.
2. **Accrued interest of listed treasury bonds:** a few grosz per bond below the sheet's for IZ0836 (the sheet likely counts to settlement, T+2). Check which convention to follow.
3. **Corporate bonds are valued clean,** without accrued interest (a choice: all are floating WIBOR + margin and WIBOR history isn't free); about 0.1 % of the portfolio below the sheet. Options: rates from the coupons received, or hand-entered rates. gpwcatalyst.pl (the sheet's source) stopped answering from here on 2026-10-12; recheck before relying on it.
4. ~~Holdings row charts after an edit or a delete~~ Done (2026-10-14): a revaluation removes the days of positions that are gone; the days left by earlier edits were cleaned up on `prod` (1,856, all from the IBKR rebuild).
5. ~~Dashboard cards vs the chart~~ Done (2026-10-13): Total, Cash, Net deposits, Profit cards; the profit split into unrealised, realised, income, fees, currency and other; unrealised and realised per account.
6. **The monthly job** refreshes one retail series on every run and revalues although nothing changed.

### Missing compared with the sheet
7. ~~Update the value of a hand-valued asset~~ Done (2026-10-14): "Edit values" in its chart panel (Prices, Holdings), values listed and deletable (ui.md).
8. **Targets and rebalancing:** target share per asset class (the sheet has them), target vs actual next to the asset mix, amount to buy or sell.
9. **Closed positions:** realised gain is shown as a total (Dashboard, per account); still missing: the list of closed positions and sales, and per year a PIT-38 summary (proceeds, costs, profit at NBP D-1).
10. **Benchmarks** on the portfolio chart (CPI + margin, indices), as the sheet's Benchmarki tab.
11. **IBKR Flex Web Service:** IBKR trades and mark prices without typing them or downloading statements (needs a Flex Query and a token).
12. **More Dashboard charts:** income per year, drawdown, allocation over time.
13. **Asset class per instrument:** bond ETFs are recognised by "Bond" in the name; an explicit setting would be safer (gold, mixed funds).

### Operations and housekeeping
14. **`prod`: drop the old `Table`** (declared in `sst.config.ts` for `prod` only, linked to nothing; removing the block leaves it in AWS because of `removal: retain`, so delete it in the console afterwards).
15. ~~`prod`: the "EUR cash" / "USD cash" instruments~~ Done (2026-10-14): marked inactive (no transaction uses them).
16. **Alerts on failed jobs** (e-mail via SNS); today a failure only shows on the Dashboard.
17. **Data-quality checks** from the backfill plan (backfill.md): price gaps per instrument, spot checks against a second source, month-end values against broker statements (done for IBKR's cash and costs, 2026-10-13).
18. ~~Monthly export of `transactions` to S3~~ Done (2026-10-14): the `Export` job backs up accounts, instruments, prices entered by hand and transactions to `exports/<date>/` on the 1st, in the import formats (data-storage.md, restore: data/README.md).

### Beyond the sheet
19. **Hold or sell a bond:** is a bond worth selling now rather than holding it to maturity? Once owned, what was paid doesn't matter: compare the **yield if held** (what it still pays from today: coupons and 100 % at maturity, after tax, against what selling it would bring today) with an **alternative** for the same period, after the cost of switching.
    - Per bond (Holdings, the row's panel): yield if held; net amount if sold today (price + accrued interest − commission − tax due now); the alternative's yield; the difference in PLN at the bond's maturity, "hold" or "sell". A column to sort bonds by it.
    - "Sell" by kind: listed treasury and corporate bonds at the market price (corporates: often a thin bid); retail bonds by early redemption (nominal + interest − the Ministry's fee per bond); IBKR bonds at IBKR's price.
    - Tax: in a taxable account a sale at a gain pays 19 % now instead of at maturity (counts against selling); none in IKE/IKZE (from the account).
    - Assumptions (a small settings screen): a CPI path (IZ and retail bonds: EDO, COI, ROD), a WIBOR path (floating corporates, WZ), the alternative: by default the current retail offer nearest the remaining term (rates and margins already in the Ministry file), or a listed treasury bond of similar maturity, or a rate you set.
    - Order: retail bonds and fixed-rate DS (all data in place) → IZ and corporate bonds (need the corporates' margins and coupon dates, item 3) → IBKR bonds (need real quotes: their prices are calculated from the purchase, so the yield would always equal the purchase yield; item 11 or Bundesbank).
