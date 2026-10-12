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
| `live-quotes` | every 15 min, 09:00–17:45 | EODHD delayed live (ETFs with `live = true`), optional EUR/PLN | `INST#…/LIVE`, `FX#EUR/LIVE` |
| `fx` | 12:30, 16:30; also after importing a foreign-currency instrument | NBP table A: EUR, USD and every instrument currency, from the day after the last stored rate (first run: from 2002); revalues the affected days when older rates arrive for a held currency | `FX#<ccy>/<date>` |
| `eod-gpw` | 18:30 | GPW archive daily XLS, all treasury bonds in one file (+ one file per missing day in the look-back; full history per bond weekly as a check) | `PX#XWAR#…` provisional |
| `eod-catalyst` | 19:30, and 08:00 Tue–Sat | BiznesRadar per bond (`sourceIds.biznesradar`): the first history page (last ~50 sessions, final; it lags a day) + today's quote (provisional), 2 s between requests. Full history per bond on import (backfill, ~16 pages) | `PX#CATALYST#…` |
| `eod-etf` | 19:00, and 07:00 Tue–Sat | Yahoo chart API, last 14 days of every ETF (`sourceIds.yahoo`). A stored close that would move by more than 20 % isn't overwritten (looks like an unrecorded split; reported in the job note). Full history per ETF on import (backfill), split-adjusted history converted back with the instrument's `splits` | `PX#<venue>#…` final |
| `valuation` | 22:30 | DynamoDB only | retail bond `PX#CALC#…`, `PORTFOLIO/SNAP#<date>`, `SNAP#LATEST` |
| `eod-ibkr` | 07:00 (next day) | IBKR Flex statement for the previous day | `PX#IBKR#…` final, transactions, cash |
| `recheck` | 07:15 (next day) | re-runs `eod-gpw` for D-1 | overwrites, sets `status = final` |
| `valuation` | 07:30 (next day) | DynamoDB only | final snapshot for D-1 |
| `monthly` | 16th, 10:00, retry daily until success (any day) | GUS CPI (monthly CSV); new retail bond series / rate resets; next IZ reference index `W(n)`; cross-check against the MF index ratio page | `CPI/<month>`, `CPI_REF/<month>`, `SERIES#…/RATE#…` |

The jobs group into a few short windows a day. With DynamoDB this doesn't matter for cost; it keeps the schedule easy to follow.

## Live quotes

- **Scope:** only instruments with `live = true` (the ETFs). One EODHD request with all tickers per poll; each ticker counts as a call, e.g. 10 ETFs × ~36 polls ≈ 360 calls/day.
- **Guard:** the job exits immediately if today is in `CAL#<venue>` as a holiday, or if the venue is outside trading hours.
- **Writes:** overwrite `LIVE`; skip the write if `quote_time` didn't change.
- **Read path:** the `api` Lambda returns the latest snapshot with live prices swapped in where `LIVE.quote_time` is newer than the snapshot's price date. Bonds and retail bonds keep their last end-of-day value.
- **Optional later:** poll only while the app is open (stale-while-revalidate in the `api` Lambda) instead of on a schedule, if API calls become a constraint.

## Valuation job

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
