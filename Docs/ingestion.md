# Data ingestion

All jobs are Lambda functions on a schedule (`sst.aws.CronV2`, EventBridge Scheduler with `timezone: "Europe/Warsaw"`), except `live` (on demand) and the valuation runs requested by other jobs (queued). Times below are Warsaw time.

Backfills and imports use the same adapters with other triggers; see [backfill.md](backfill.md).

## Job structure

Each source is an **adapter** with the same shape. The daily jobs and the backfill scripts reuse it:

```
fetch(date_range, instruments) -> raw files      # HTTP only
archive(raw files)                               # S3 raw/<source>/...
parse(raw files) -> normalized records           # pure function, unit-tested on saved files
validate(records) -> records + flags             # sanity checks, see below
upsert(records)                                  # DynamoDB, idempotent
```

A job run is: pick the instruments (`active = true` and matching source) → run the adapter for today plus the look-back window → write a `JOB#…/RUN#…` item → alert on failure.

## Schedule (Warsaw time, Mon–Fri unless noted)

| Job | When | Source | Writes |
|---|---|---|---|
| `live` | on demand ("Update prices" in the app, `POST /prices/refresh`, at most every 5 min) | today's quote of every instrument with an intraday source: onvista (IBKR bonds), Yahoo (ETFs), BiznesRadar quote page (Catalyst and GPW treasury bonds); then revalues today | `PX#<venue>#<today>` provisional, with `quoteTime` |
| `fx` | 12:30, 16:30; also after importing a foreign-currency instrument | NBP table A: EUR, USD and every instrument currency, from the day after the last stored rate (first run: from 2002); revalues the affected days when older rates arrive for a held currency | `FX#<ccy>/<date>` |
| `eod-gpw` | 20:30 and 22:00 (GPW publishes the day's file after 18:30; today's file missing = "not published yet") | GPW archive daily XLS, all treasury bonds in one file (+ one file per missing day in the look-back; full history per bond weekly as a check) | `PX#XWAR#…` provisional |
| `eod-catalyst` | 19:30, and 08:00 Tue–Sat | BiznesRadar per bond (`sourceIds.biznesradar`): the first history page (last ~50 sessions, final; it lags a day) + today's quote (provisional), 2 s between requests. Full history per bond on import (backfill, ~16 pages) | `PX#CATALYST#…` |
| `eod-etf` | 19:00, and 07:00 Tue–Sat | Yahoo chart API, last 14 days of every ETF (`sourceIds.yahoo`). A stored close that would move by more than 20 % isn't overwritten (looks like an unrecorded split; reported in the job note). Full history per ETF on import (backfill), split-adjusted history converted back with the instrument's `splits` | `PX#<venue>#…` final |
| `eod-bonds` | 22:10, and 07:10 Tue–Sat | onvista per foreign bond at IBKR (`sourceIds.onvista`, Börse Stuttgart): last 14 days of closes (final) + today's quote (provisional; the morning run replaces it with the close). Full history per bond on import (backfill) | `PX#XSTU#…` |
| `coupons` | 09:00 | obligacje.pl page of every corporate bond held: new interest periods and the current period's rate where none is stored (never replacing one; a different rate is kept aside). Revalues from the first period whose rate is new. By hand `{ "all": true }` also covers bonds no longer held | `INST#…/COUPON#<start>` |
| `valuation` | 22:30 | DynamoDB only | retail bond `PX#CALC#…`, `PORTFOLIO/SNAP#<date>`, `SNAP#LATEST` |
| `eod-ibkr` (later, not built) | 07:00 (next day) | IBKR Flex statement for the previous day | transactions, cash |
| `eod-gpw-recheck` | 07:15 (next day) | re-runs `eod-gpw` for D-1 | overwrites, sets `status = final` |
| `valuation` | 07:30 (next day) | DynamoDB only | final snapshot for D-1 |
| `monthly` | 16th, 10:00, retry daily until success (any day) | GUS CPI (monthly CSV: m/m and since December); new retail bond series / rate resets; next IZ reference index `W(n)`; cross-check against the MF index ratio page | `CPI/<month>`, `CPI_REF/<month>`, `CPI_YTD/<month>`, `SERIES#…/RATE#…` |

The jobs group into a few short windows a day. With DynamoDB this doesn't matter for cost; it keeps the schedule easy to follow.

## Live prices (on demand, 2026-10-14)

- **Trigger:** "Update prices" in the app → `POST /prices/refresh` → the `Live` function (async). At most one run every 5 minutes (the API answers 429 with `retryAt`), so the sources aren't asked over and over.
- **What it does** (`jobs/handlers/live.ts`): for every active instrument with an intraday source, today's quote so far, stored as today's **provisional** price in the usual `PX#<venue>#<date>` item: IBKR bonds from onvista (Börse Stuttgart, near real time), ETFs from Yahoo (today's bar, about 15 minutes delayed), Catalyst corporate bonds and GPW treasury bonds (DS, IZ …, the page under their GPW code) from the BiznesRadar quote page: the last trade, 15 minutes delayed, 2 s apart. Each price keeps when the source set it (`quoteTime`: the last trade or quote), shown in the app. An instrument not traded or quoted today is skipped (it keeps the last close); a price already final for today is left alone. Then it queues a revaluation of today, and the evening jobs replace the provisional prices with the closes.
- **Not covered:** retail bonds and hand-valued assets (no market), exchange rates (NBP, once a day). Treasury bonds' end-of-day source stays GPW's file: its close replaces the refreshed price in the evening.
- **Failures:** an instrument whose source fails is listed in the run's note; the run fails only when nothing could be fetched.
- **Later, if wanted:** the same function on a schedule (e.g. hourly in trading hours).

## Valuation job

**One run at a time.** Imports, backfills, the FX job and the monthly job ask for a revaluation by sending a message to the `ValuationQueue` (SQS FIFO, one message group); the valuation function consumes them in order, one run at a time, so each run reads the data as it is when it starts. Requests waiting together (up to 10: a burst of saves, an import of several files, requests queued during a long run) make one run over the union of their ranges (`mergedRange`: from the earliest day any asks for, forced if any is), instead of one full run each. A direct invocation (the 22:30 and 07:30 schedules, or by hand with `{ from, to, reason }`) only queues its request. Before this, overlapping runs could finish in the wrong order and leave `SNAP#LATEST` without the newest transactions (seen on `int`, 2026-10-13). Reserved concurrency would have been simpler, but the account's limit (50) leaves nothing to reserve. A message that fails 3 times moves to `ValuationDeadLetter` (kept 14 days), so it can't hold up the ones behind it for good; each failure shows on the Dashboard. A run whose range starts after today (a change dated in the future) does nothing.

**Where a run starts.** A request gives `from` (a saved or deleted transaction, coupon period or hand-entered value: its date; FX: the earliest new rate; live prices: today) or the instruments whose prices or terms changed (`isins`: a backfill, newly published retail-bond rates), which revalue from the first transaction of those instruments; an instrument never held revalues nothing. An import starts from its file's earliest date (transactions, prices, coupon periods) or, for retail-bond terms, from the refreshed bonds' first transaction; only the MF calculator (reference index) and accounts revalue everything. Without either, any reason but the schedule revalues from the first transaction; the schedule values today. The function has 2 GB (CPU grows with memory: a full run on `test` took 77 s at 512 MB and 16 s at 2 GB before the Ledger, at about the same cost).

1. Load instruments, transactions, latest prices (`PX` items ≤ date), FX for the date, CPI and rate periods.
2. **Retail bonds:**
   - Compute the value per bond for each series: 100 PLN + accrued interest according to the rate periods and the compounding rule (EDO compounds yearly, COI/ROD per their terms).
   - Optionally also store the value net of the early-redemption fee and the Belka tax.
   - Write as `PX#CALC#<date>`.
3. **Exchange-traded bonds:** accrued interest per bond from the bond terms, to the settlement day (T+2) of a sale on the valuation date, as the exchange quotes it (treasury: the MF calculator's terms; IZ: `nominal = 1000 × ratio(T+2)` from `CPI_REF` and `base_ref`), kept in the holding as `nominal`, `accruedInterest`, `valuePerUnit` (= clean % × nominal + accrued). Corporate bonds: clean % × nominal plus the accrued interest of their coupon periods (data-sources.md, "Corporate bonds: coupon periods"); a period without a rate flags the holding `no_coupon_rate` and leaves it at the clean price.
4. Positions = sum of transactions per ISIN and account up to the date. A run over many days walks forward through the transactions once (a `Ledger`: sorted once, positions, cash and retail-bond lots carried from day to day, each day applying only its own transactions) instead of replaying all of them for each day: on `test` (6,792 days, 836 transactions) the replay was ~85% of the computation, 7.1 s of `valuePortfolio`'s 8.1 s locally, now 0.3 s.
5. Value per position in instrument currency and in PLN (NBP rate of the date, falling back to the latest available).
6. Write `SNAP#<date>` and `SNAP#LATEST`, and the position days (`POS#<account>#<isin>`) for the Holdings row charts.

**Only what changed is written.** The run reads the stored chart points of its range first (with the prices, FX and coupon periods, 10 instruments at a time). Each point carries a fingerprint of the day's snapshot as written (`snapshotFingerprint`: a 53-bit hash of its canonical JSON, without `computedAt`), so a day that comes out with the same fingerprint is unchanged without reading its snapshot. Only the days whose fingerprint differs (or that have none yet) get their stored snapshots read, 100 days at a time in one batch: `test` reads ~1.7 MB of points instead of 13 MB of snapshots (~4 s). A day that comes out the same (ignoring `computedAt`) isn't written again, and of a changed day only the positions whose quantity, value or cost changed get their position day rewritten; the day's chart point (`HISTORY`, data-storage.md) is written when it's new or differs, even on an otherwise unchanged day; `SNAP#LATEST` is always written. The writes of each 100 days go out together, 25 items per BatchWrite and 4 at once, the chart points last (a point with a new fingerprint must not stand for a snapshot that wasn't written): a forced rewrite of `test`'s 6,792 days took 182 s writing day by day at 512 MB, 13.5 s now at 2 GB; a full run with nothing to write ~2 s (77 s before). Writes are what a run costs: a full range (from 2022-03-01, ~1,690 days) used to write ~64k units, about $0.045 per run and stage, and on 2026-10-13 runs from imports, backfills and the CD tests cost ~$1.30 in a day. The note says how many days were unchanged and how many stored snapshots were read. `{ force: true }` writes every day, e.g. after a change to what a position day stores.

## Data quality rules

| Check | Action |
|---|---|
| Close moves more than ±20 % (ETF) / ±5 % (bond) with no `EV` item | write with `flags: ["jump"]`, alert |
| Bond price outside 50–150 % of nominal | reject, alert |
| Missing price on a trading day (not in calendar as holiday) | gap: re-fetched by the look-back of the next runs (not possible for Catalyst, see below) |
| Gap older than look-back (10 trading days) | alert; fix with a targeted backfill |
| `eod-catalyst` failed after the 07:15 recheck | alert immediately: that day is lost unless a backfill source has it |
| Catalyst snapshot's last-trade date ≠ expected session date | don't write as that day's price (the page may not have refreshed yet) |
| `last_trade_date` older than 10 days | UI shows the price as stale |
| Parser finds 0 rows or the file format changed | job fails, raw file stays in S3, alert |
| Retail bond calc vs official interest table differs > 0.01 PLN | alert (monthly check) |
| Coupon you entered ≠ computed interest for that payment date (> 0.01 PLN per bond) | flag the transaction and the bond terms for review |
| Floating bond without a rate for the current period | flag `missing_coupon_rate`, show in UI |

## Idempotency and gaps

- The key is `INST#<isin>` + `PX#<venue>#<date>`; a re-run overwrites with the same or a better value.
- A `final` item is only replaced by another `final` item if the values differ (logged).
- Each daily run covers today plus the previous 10 trading days. Missing days are fetched again automatically, so a failed night heals itself.
- **Catalyst corporate bonds** come from BiznesRadar, whose history page repairs any missed day of the last ~50 sessions (gpwcatalyst.pl, a snapshot without archive, isn't used).

## Failure handling

- Every run writes a `JOB#…/RUN#…` item; the Dashboard lists the last run of each job and shows a banner for any that failed.
- Lambda retries: 2 for the scheduled jobs; the valuation queue retries a message 3 times, then moves it to `ValuationDeadLetter`.
- Planned (README item 16): an on-failure destination → SNS → e-mail, and a CloudWatch alarm on the jobs' `Errors` metric. The "alert" actions in the data quality rules above wait for it; until then they show on the Dashboard.
- Scraping etiquette: one request per page, 2–5 s delay between requests during backfill, descriptive User-Agent, cache in S3.

## Secrets

API keys (EODHD and IBKR Flex token, later) are `sst.Secret`s (`sst secret set …`), linked to the functions that need them.
