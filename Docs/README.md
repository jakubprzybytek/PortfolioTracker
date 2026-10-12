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
| 3 – IBKR, FX | IBKR Flex (EU government bonds), NBP exchange rates |

## Architecture

```
                         ┌──────────────────────────── AWS (SST v4) ────────────────────────────┐
sst.aws.Cron ────────────┼─► Lambda eod-gpw        18:30   treasury bonds, daily all-bonds XLS   │
                         ├─► Lambda eod-catalyst   18:30   corporate bonds, page snapshot        │
                         │                         (+20:30, 23:00 retry, 07:15 recheck)          ├──► DynamoDB: market, transactions, holdings
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
2. **Transactions are entered by you.** Start with a file import (CSV/JSON uploaded to S3); add a form later if needed. Coupon payments you enter are also used to check the calculated accrued interest.
3. **Accrued interest is computed, not fetched.** It comes from each bond's terms. The only external input is the coupon rate per period of floating-rate corporate bonds (see data-sources.md).
4. **ISIN is the internal key.** Each source's code/ticker is a mapping on the instrument.
5. **Store raw, unadjusted prices**; events (coupons, redemptions, splits, dividends) are stored separately.
6. **One code path for daily and backfill.** Every source adapter is `fetch → archive → parse → validate → upsert`; only the trigger and date range differ.
7. **Every job is idempotent and repairs gaps** over a look-back window. The exception is Catalyst corporate bonds: their only daily source is a snapshot, so a missed day can't be re-fetched.
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
- [ ] `prod`: re-import MF calculator and instruments into the new tables (backfill runs again); then drop the old `Table` (still declared in `sst.config.ts` for `prod` only, linked to nothing; removing the block leaves it in AWS because of `removal: retain`, so delete it in the console afterwards).
- [ ] Load `prod`: MF calculator, `data/instruments.json`, and your real transactions (export of the sheet), plus retail bond series with purchase dates. `int` and `dev` hold `data/transactions.sample.json` (made-up).
- [x] Retail bonds valued per lot from the rates in the MF retail file (no CPI needed).
- [ ] `sst dev` runs Lambdas locally, so scheduled jobs only run while it's up; use `npm run deploy -- --stage dev` for unattended collection.
- [ ] Terms of each corporate bond held: fixed or floating, rate/margin, coupon dates, nominal.
- [ ] Source of floating coupon rates per period: manual entry vs scraping the Catalyst interest tables.
- [ ] Bossa EOD files: log in and check whether Catalyst bonds are included (corporate backfill).
- [ ] Catalyst scraper PoC (cells don't line up with headers; read by position). The reference sheet's offsets and its instruments-list page (nominal + accrued interest) are in data-sources.md.
- [ ] Check the bossa.pl website quote JSON (`_cat_bonds`) as a daily source for Catalyst bonds (data-sources.md).
- [x] SST: `CronV2` (EventBridge Scheduler) takes `timezone: "Europe/Warsaw"`.
- [x] GUS monthly CPI m/m equals the MF calculator's `WR_k` (31 of 32 months 2024-01…2026-08; January differs by design, see data-sources.md). Source: the GUS CSV, no key (BDL has yearly CPI only).
- [ ] Confirm the Catalyst page still shows D-1 at 07:15 on a weekday (seen on a Saturday only).
- [x] GPW archive: full history per bond, or one file per day for all treasury bonds; no "last N" option (PoC, 2026-10-10).
- [x] Corporate bonds: not in the GPW archive; gpwcatalyst.pl lists all corporate bonds, snapshot only.
- [x] IZ indexed nominal and accrued interest: computed with the Ministry's method; exact match with published values.
- [x] IaC: SST v4.
- [x] Custom domains per stage and CD (int → tests → prod → tag); first release `v0.1` on 2026-10-11.

Later phases:
- [x] ETF source: Yahoo chart API works from Lambda for all 10 ETFs in the sheet, full daily history (data-sources.md). EODHD stays the fallback.
- [x] ETFs: Yahoo prices (history converted back to traded prices with the recorded splits: Yahoo has no split event for SPXS.AS), NBP rates since 2002, valuation in PLN, the sheet's ETF transactions (buys, sells, dividends, the SPXS 100:1 split). Bossa Zagranica and IKE Bossa are complete.
- [ ] ISIN + venue for every ETF.
- [ ] IBKR Flex: when the daily statement for day D becomes available.
