# PortfolioTracker – design notes

A simple personal portfolio tracker. **You enter your own transactions** (buys, sells, coupons, redemptions, fees); the app collects prices, values the portfolio every day and shows it as a table and charts.

Asset types: Polish treasury and corporate bonds (GPW / Catalyst), Polish retail treasury bonds (obligacje detaliczne), UCITS ETFs on EU exchanges, EU government bonds at IBKR, plus manually valued assets and cash.

Status (2026-10-10): **design + PoC** (`poc/gpw-history`). **Current focus: Polish bonds.**

| Document | Contents |
|---|---|
| [data-sources.md](data-sources.md) | Where each price comes from, per holding; IZ indexation; accrued interest |
| [data-storage.md](data-storage.md) | DynamoDB single-table design: items, keys, access patterns |
| [ingestion.md](ingestion.md) | Scheduled daily jobs, valuation, data quality rules |
| [backfill.md](backfill.md) | How history is loaded: triggers and order per source |
| [ui.md](ui.md) | Visualisation: holdings table and charts |

## Scope

| Phase | Contents |
|---|---|
| **1 – Polish bonds** (now) | Treasury bonds on GPW (fixed and inflation-linked IZ), Catalyst corporate bonds, retail bonds (EDO, COI, ROD); transactions import; daily valuation incl. accrued interest; table + charts |
| 2 – ETFs | EODHD end-of-day prices and backfill; later "live" (15-min delayed) quotes |
| 3 – IBKR, FX | IBKR Flex (EU government bonds), NBP exchange rates |

## Architecture

```
                         ┌──────────────────────────── AWS (SST v4) ────────────────────────────┐
sst.aws.Cron ────────────┼─► Lambda eod-gpw        18:30   treasury bonds, daily all-bonds XLS   │
                         ├─► Lambda eod-catalyst   18:30   corporate bonds, page snapshot        │
                         │                         (+20:30, 23:00 retry, 07:15 recheck)          ├──► DynamoDB (sst.aws.Dynamo)
                         ├─► Lambda monthly        16th    CPI, IZ reference index, retail rates  │        ▲   │ stream
                         └─► Lambda valuation      22:30 + 07:30                                 │        │   ▼
                                                                                                 │   Lambda backfill  ◄── manual (sst shell / CLI)
S3 upload imports/… ──────────► Lambda import (Bossa / Cbonds / MF files, transactions) ──────────┤
                                                                                                 │
every job ──► S3 raw archive (sst.aws.Bucket, write-only originals)                              │
                                                                                                 │
React UI (sst.aws.StaticSite) ──► sst.aws.ApiGatewayV2 ──► Lambda api ───────────────────────────┘
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
| Table / charts | TanStack Table / Recharts | 9.2.8 / 3.10.1 |
| Tests | Vitest | 5.0.3 |

Repo layout:

```
packages/core   parsers (GPW, Catalyst), IZ ratio, accrued interest, retail bonds, valuation – pure functions, tested
packages/jobs   Lambda handlers (cron, backfill, import, api) + scripts for sst shell
packages/web    Vite + React UI
sst.config.ts
Docs/
```

## Key decisions

1. **DynamoDB on-demand is the only database.** Price history, transactions, reference data and daily snapshots. No idle cost, no cold start; Aurora Serverless was rejected because polling keeps it awake. Volume is tiny.
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
| EODHD (phase 2 only) | ≈ $20 |

## Open decisions / to verify

Phase 1:
- [ ] Your holdings and transactions (export of the sheet) and retail bond series with purchase dates.
- [ ] Terms of each corporate bond held: fixed or floating, rate/margin, coupon dates, nominal.
- [ ] Source of floating coupon rates per period: manual entry vs scraping the Catalyst interest tables.
- [ ] Bossa EOD files: log in and check whether Catalyst bonds are included (corporate backfill).
- [ ] Catalyst scraper PoC (cells don't line up with headers; read by position).
- [ ] SST `Cron`: check whether schedules can use Europe/Warsaw or only UTC (times would shift by an hour with DST).
- [ ] Confirm that GUS's monthly CPI m/m (one decimal) equals the `WR_k` in the MF calculator for recent months.
- [ ] Confirm the Catalyst page still shows D-1 at 07:15 on a weekday (seen on a Saturday only).
- [x] GPW archive: full history per bond, or one file per day for all treasury bonds; no "last N" option (PoC, 2026-10-10).
- [x] Corporate bonds: not in the GPW archive; gpwcatalyst.pl lists all corporate bonds, snapshot only.
- [x] IZ indexed nominal and accrued interest: computed with the Ministry's method; exact match with published values.
- [x] IaC: SST v4.

Later phases:
- [ ] EODHD: confirm the EOD plan includes the delayed live endpoint and enough daily calls.
- [ ] ISIN + venue for every ETF.
- [ ] IBKR Flex: when the daily statement for day D becomes available.
