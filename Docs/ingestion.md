# Data ingestion

All jobs are Lambda functions on a schedule (`sst.aws.Cron`, SST v4). Times below are Warsaw time. To check: whether SST's `Cron` supports a time zone. If it's UTC only, either accept a one-hour shift with DST or define an EventBridge Scheduler schedule with `Europe/Warsaw` directly.

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
| `live` | on demand ("Refresh prices" in the app, `POST /prices/refresh`, at most every 5 min) | today's quote of every instrument with an intraday source: onvista (IBKR bonds), Yahoo (ETFs), BiznesRadar quote page (Catalyst and GPW treasury bonds); then revalues today | `PX#<venue>#<today>` provisional, with `quoteTime` |
| `fx` | 12:30, 16:30; also after importing a foreign-currency instrument | NBP table A: EUR, USD and every instrument currency, from the day after the last stored rate (first run: from 2002); revalues the affected days when older rates arrive for a held currency | `FX#<ccy>/<date>` |
| `eod-gpw` | 20:30 and 22:00 (GPW publishes the day's file after 18:30; today's file missing = "not published yet") | GPW archive daily XLS, all treasury bonds in one file (+ one file per missing day in the look-back; full history per bond weekly as a check) | `PX#XWAR#…` provisional |
| `eod-catalyst` | 19:30, and 08:00 Tue–Sat | BiznesRadar per bond (`sourceIds.biznesradar`): the first history page (last ~50 sessions, final; it lags a day) + today's quote (provisional), 2 s between requests. Full history per bond on import (backfill, ~16 pages) | `PX#CATALYST#…` |
| `eod-etf` | 19:00, and 07:00 Tue–Sat | Yahoo chart API, last 14 days of every ETF (`sourceIds.yahoo`). A stored close that would move by more than 20 % isn't overwritten (looks like an unrecorded split; reported in the job note). Full history per ETF on import (backfill), split-adjusted history converted back with the instrument's `splits` | `PX#<venue>#…` final |
| `eod-bonds` | 22:10, and 07:10 Tue–Sat | onvista per foreign bond at IBKR (`sourceIds.onvista`, Börse Stuttgart): last 14 days of closes (final) + today's quote (provisional; the morning run replaces it with the close). Full history per bond on import (backfill) | `PX#XSTU#…` |
| `valuation` | 22:30 | DynamoDB only | retail bond `PX#CALC#…`, `PORTFOLIO/SNAP#<date>`, `SNAP#LATEST` |
| `eod-ibkr` | 07:00 (next day) | IBKR Flex statement for the previous day | `PX#IBKR#…` final, transactions, cash |
| `recheck` | 07:15 (next day) | re-runs `eod-gpw` for D-1 | overwrites, sets `status = final` |
| `valuation` | 07:30 (next day) | DynamoDB only | final snapshot for D-1 |
| `monthly` | 16th, 10:00, retry daily until success (any day) | GUS CPI (monthly CSV); new retail bond series / rate resets; next IZ reference index `W(n)`; cross-check against the MF index ratio page | `CPI/<month>`, `CPI_REF/<month>`, `SERIES#…/RATE#…` |

The jobs group into a few short windows a day. With DynamoDB this doesn't matter for cost; it keeps the schedule easy to follow.

## Live prices (on demand, 2026-10-14)

- **Trigger:** "Refresh prices" in the app → `POST /prices/refresh` → the `Live` function (async). At most one run every 5 minutes (the API answers 429 with `retryAt`), so the sources aren't asked over and over.
- **What it does** (`jobs/handlers/live.ts`): for every active instrument with an intraday source, today's quote so far, stored as today's **provisional** price in the usual `PX#<venue>#<date>` item: IBKR bonds from onvista (Börse Stuttgart, near real time), ETFs from Yahoo (today's bar, about 15 minutes delayed), Catalyst corporate bonds and GPW treasury bonds (DS, IZ …, the page under their GPW code) from the BiznesRadar quote page: the last trade, 15 minutes delayed, 2 s apart. Each price keeps when the source set it (`quoteTime`: the last trade or quote), shown in the app. An instrument not traded or quoted today is skipped (it keeps the last close); a price already final for today is left alone. Then it queues a revaluation of today, and the evening jobs replace the provisional prices with the closes.
- **Not covered:** retail bonds and hand-valued assets (no market), exchange rates (NBP, once a day). Treasury bonds' end-of-day source stays GPW's file: its close replaces the refreshed price in the evening.
- **Failures:** an instrument whose source fails is listed in the run's note; the run fails only when nothing could be fetched.
- **Later, if wanted:** the same function on a schedule (e.g. hourly in trading hours).

## Valuation job

**One run at a time.** Imports, backfills, the FX job and the monthly job ask for a revaluation by sending a message to the `ValuationQueue` (SQS FIFO, one message group); the valuation function consumes it one message at a time, in order, so each run reads the data as it is when it starts. A direct invocation (the 22:30 and 07:30 schedules, or by hand with `{ from, to, reason }`) only queues its request. Before this, overlapping runs could finish in the wrong order and leave `SNAP#LATEST` without the newest transactions (seen on `int`, 2026-10-13). Reserved concurrency would have been simpler, but the account's limit (50) leaves nothing to reserve. A message that fails 3 times moves to `ValuationDeadLetter` (kept 14 days), so it can't hold up the ones behind it for good; each failure shows on the Dashboard. A run whose range starts after today (a change dated in the future) does nothing.

1. Load instruments, transactions, latest prices (`PX` items ≤ date), FX for the date, CPI and rate periods.
2. **Retail bonds:**
   - Compute the value per bond for each series: 100 PLN + accrued interest according to the rate periods and the compounding rule (EDO compounds yearly, COI/ROD per their terms).
   - Optionally also store the value net of the early-redemption fee and the Belka tax.
   - Write as `PX#CALC#<date>`.
3. **Exchange-traded bonds:** accrued interest per bond from the bond terms (fixed: coupon rate; floating: `COUPON#…` rate of the current period; IZ: `nominal = 1000 × ratio(date)` from `CPI_REF` and `base_ref`). Write into the bond's `PX` item as `nominal`, `accrued_interest`, `value_per_unit` (= clean % × nominal + accrued). A floating bond without the current period's rate gets flagged `missing_coupon_rate` and is valued at clean price only.
4. Positions = sum of transactions per ISIN and account up to the date.
5. Value per position in instrument currency and in PLN (NBP rate of the date, falling back to the latest available).
6. Write `SNAP#<date>` and `SNAP#LATEST`.

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

- Lambda retries: 2 (built in for async invocation), then an on-failure destination → SNS → e-mail.
- CloudWatch alarm on any job's `Errors` metric.
- Scraping etiquette: one request per page, 2–5 s delay between requests during backfill, descriptive User-Agent, cache in S3.

## Secrets

API keys (EODHD and IBKR Flex token, later) are `sst.Secret`s (`sst secret set …`), linked to the functions that need them.
