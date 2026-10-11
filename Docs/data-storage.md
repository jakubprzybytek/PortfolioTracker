# Data storage

Three DynamoDB tables, all on-demand capacity, plus an S3 bucket used only as a raw-file archive.

| Table | Contents | Written by | Can be rebuilt? |
|---|---|---|---|
| `market` | Instruments, daily prices, live quotes, events, coupon rates, retail-bond rates, CPI, FX, calendar, backfill status, job runs | Scheduled jobs, backfill, import (instruments) | Yes: re-fetch, or reprocess the S3 archive (the only source for past Catalyst snapshots) |
| `transactions` | Accounts, transactions; later also allocation targets and multi-asset splits | You, through the import (later a form) | **No.** This is the only data that exists nowhere else |
| `holdings` | Daily portfolio snapshots | Valuation job only | Yes: recompute from `transactions` + `market` |

## Why three tables

The access patterns never read prices, transactions and holdings in one request; each query hits one partition of one kind. A single table therefore brings no benefit, and separate tables give:

- **Different lifecycles.** `transactions` is the only table that can't be recreated, so it gets the strictest protection and a monthly export. `holdings` is a computed result and can be wiped and recomputed.
- **Isolation.** `int` re-seeds sample transactions on every test run without touching price history, and a bad backfill can't damage transactions.
- **Least privilege.** Each Lambda links only the tables it needs (see [Access per function](#access-per-function)).

On-demand billing is per request and per GB with no per-table fee, so three tables cost the same as one.

**Holdings are derived, never edited.** As in the reference spreadsheet ([reference/ReferenceFeatures.md](reference/ReferenceFeatures.md)), positions follow from transactions. The valuation job is the only writer of `holdings`; any change to transactions or prices is followed by a revaluation.

## Common layout

Every table uses the same key schema, so the same helpers work everywhere:

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String | Partition key |
| `SK` | String | Sort key |
| `GSI1PK` | String | Sparse: set only on items that must be listed by type (`market`, `transactions`) |
| `GSI1SK` | String | |
| `ttl` | Number | Optional, epoch seconds (`market`: job runs) |

Index `GSI1` (`GSI1PK`, `GSI1SK`), projection ALL, on `market` and `transactions`.

| Setting | `market` | `transactions` | `holdings` |
|---|---|---|---|
| Point-in-time recovery | on | on | off |
| Deletion protection (`prod`) | on | on | on |
| TTL attribute | `ttl` | — | — |
| Monthly export to S3 | yes | yes | no |

## Conventions

- **Dates** are ISO `YYYY-MM-DD` in the **venue's local calendar** (trade date), so they sort correctly as strings.
- **Timestamps** are ISO 8601 UTC (`fetched_at`, `updated_at`).
- **Numbers** are DynamoDB Numbers, handled as decimals in code (never floats).
- **Currency** is stored on every price item; nothing is converted at write time.
- **Bond prices** are stored as clean price in % of nominal; accrued interest is stored separately per bond in currency.
- Every item written by a job carries `source` and `fetched_at`.

## Table `market`

### Instrument (reference data)

```
PK = INST#<ISIN>            SK = META
GSI1PK = INSTRUMENT         GSI1SK = <ISIN>
```

| Field | Example |
|---|---|
| `isin`, `name`, `type` | `IE00B3RBWM25`, "Vanguard FTSE All-World", `ETF` / `BOND_LISTED` / `BOND_RETAIL` / `BOND_IBKR` / `FUND_MANUAL` / `CASH` |
| `currency`, `primary_venue` | `EUR`, `XETRA` |
| `source_ids` | `{ "eodhd": "<TICKER>.XETRA", "gpw": "<CODE>", "ibkr_conid": "…" }` |
| `live` | `true` for instruments polled intraday |
| `active` | `false` once sold/matured (jobs skip inactive instruments) |
| bonds only | `nominal` (face value), `coupon_type` (`FIXED` / `FLOATING` / `INDEXED`), `coupon_rate` or `margin` + `reference_rate`, `maturity`, `coupon_schedule` (period start/end, payment date); IZ bonds also `base_ref` (e.g. IZ0836: 194.28509) and `issue_date` |
| retail bonds only | `series` (e.g. `EDO0936`), `first_rate`, `margin`, `redemption_fee` |

The import Lambda starts the backfill of every imported instrument that has no backfill status yet (see backfill.md).

### Daily price

```
PK = INST#<ISIN>            SK = PX#<venue>#<YYYY-MM-DD>
```

| Field | Notes |
|---|---|
| `open`, `high`, `low`, `close` | raw, unadjusted; bonds in % of nominal (clean) |
| `volume`, `turnover`, `trades` | zero volume → `close` is stale |
| `bid`, `ask`, `ref_price` | Catalyst: often the only fair price when nothing traded |
| `last_trade_date` | for illiquid bonds |
| `accrued_interest` | bonds: per bond, in currency |
| `nominal` | bonds: nominal per bond on that date. For inflation-linked IZ bonds this is the **indexed** nominal from the official index ratio / CPI, not GPW's "Cena nominalna" column (unreliable) |
| `value_per_unit` | bonds/retail bonds: price used for valuation (clean % × `nominal` + accrued) |
| `currency`, `source`, `fetched_at` | |
| `status` | `provisional` (evening) → `final` (morning re-check) |
| `flags` | e.g. `["jump"]` from sanity checks |

Retail bonds and manual entries use the same item with `venue = CALC` or `MANUAL`. That way every consumer reads one price shape.

### Live quote

```
PK = INST#<ISIN>            SK = LIVE
GSI1PK = LIVE               GSI1SK = <ISIN>
```

`price`, `change`, `change_pct`, `prev_close`, `currency`, `quote_time` (exchange time of the quote), `fetched_at`, `source`.
The item is overwritten every poll, so history never grows from it.

### Corporate / bond events

```
PK = INST#<ISIN>            SK = EV#<YYYY-MM-DD>#<DIV|SPLIT|COUPON|REDEMPTION>
```

`ex_date`, `pay_date`, `amount`, `currency`, `ratio` (splits), `source`.

### Floating coupon rates (corporate bonds)

```
PK = INST#<ISIN>            SK = COUPON#<period_start>
```

`period_start`, `period_end`, `rate` (annual, e.g. 0.0812), `source` (`manual` / `catalyst`). One item per coupon period; needed for accrued interest of floating-rate bonds.

### Backfill status

```
PK = INST#<ISIN>            SK = BACKFILL
```

`status` (`pending` / `running` / `done` / `no_history` / `failed`), `source`, `from`, `to`, `rows`, `updated_at`, `note`. Written by the `backfill` and `import` Lambdas; shown in the UI.

### Retail bond series

```
PK = SERIES#<series>        SK = META        (e.g. SERIES#EDO0332)
```

Every series of the Ministry retail-bond file (~990 items): `isin`, `kind`, `termMonths`, `periodMonths`, `capitalises`, `rates` (per period, `null` = not published yet), `margin`, `rolloverPrice`, `publishedInterest`, `saleStart`/`saleEnd`, `source`. Rewritten on every import of the file. A retail instrument (`type = BOND_RETAIL`, `venue = CALC`, no prices) carries a copy of its series in `retail`, refreshed by the same import; valuation reads only the instrument.

### Macro series

```
PK = CPI                    SK = <YYYY-MM>          value, source, published_at
PK = CPI_REF                SK = <YYYY-MM>          wr (CPI m/m, e.g. 0.003), w (reference index, 5 dp)   (IZ indexation, see data-sources.md)
PK = FX#<CCY>               SK = <YYYY-MM-DD>       mid, table_no, source        (NBP table A, PLN per unit)
PK = FX#<CCY>               SK = LIVE               mid, fetched_at              (optional intraday rate)
```

### Exchange calendar

```
PK = CAL#<venue>            SK = <YYYY-MM-DD>       type = HOLIDAY | HALF_DAY, note
```

Entered by hand once a year. Used by gap repair (a holiday isn't a gap) and by the live poller (no polling on holidays).

### Job runs

```
PK = JOB#<job_name>         SK = RUN#<started_at>    status, items_written, gaps_found, errors, ttl (90 days)
```

## Table `transactions`

### Accounts

```
PK = ACCT#<account>         SK = META                           broker, currency, name
```

### Transactions

```
PK = ACCT#<account>         SK = TX#<YYYY-MM-DD>#<tx_id>
GSI1PK = TX                 GSI1SK = <YYYY-MM-DD>#<tx_id>
```

`type`, `isin`, `quantity`, `price`, `amount`, `fee`, `currency`, `fx_rate`, `note`, `source`.

`type`: `BUY`, `SELL`, `COUPON`, `REDEMPTION`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`.
`valueDate` (optional): retail bonds, when interest starts if not the transaction date. Retail positions are valued per lot (each buy; sales take the oldest lots first).
`tx_id` is deterministic (broker id, or a hash of the row), so imports can be re-run safely. `GSI1` lists all transactions across accounts in date order, which is what valuation replays.

### Later: settings you enter

```
PK = TARGETS                SK = <asset_class>                  target_pct                    (allocation targets, rebalancing)
PK = MULTI#<ISIN>           SK = META                           split: { <asset_class>: pct } (multi-asset look-through)
```

Both are user input, so they live here rather than in `market`.

## Table `holdings`

### Portfolio snapshots

```
PK = PORTFOLIO              SK = SNAP#<YYYY-MM-DD>
PK = PORTFOLIO              SK = SNAP#LATEST
```

Written by the valuation job: one holding per **account and instrument** (the same bond in two accounts is two holdings), sorted by account then code. Per holding `account`, `quantity`, `price`, `price_date`, `nominal`, `accrued_interest`, `value_per_unit`, `value`, `cost`, `coupons_received`, `gain`; totals; values per asset type. The UI's history chart, dashboard and Holdings view come from these items. Snapshots written before 2026-10-11 have no `account`; only `SNAP#LATEST` is read per holding, and every valuation run rewrites it.
Items stay small: about 25 holdings, well under the 400 KB item limit.

## Access per function

Each function links only the tables it needs.

| Function | `market` | `transactions` | `holdings` |
|---|---|---|---|
| `EodGpw`, `RecheckGpw`, `Monthly` (and later EODHD, IBKR, NBP jobs) | read/write | — | — |
| `Backfill` | read/write | — | — |
| `Import` | read/write (instruments, reference index) | read/write | — |
| `Valuation` | read (writes its job run) | read | write |
| `Api` | read | read | read |

## Access patterns

| Need | Table | Operation |
|---|---|---|
| Dashboard | `holdings` + `market` | `Get PORTFOLIO/SNAP#LATEST` + `Query GSI1 GSI1PK=LIVE`; the api Lambda swaps in live prices where newer |
| Portfolio value over time | `holdings` | `Query PK=PORTFOLIO, SK between SNAP#<from> and SNAP#<to>` |
| Price chart for one instrument | `market` | `Query PK=INST#<isin>, SK between PX#<venue>#<from> and PX#<venue>#<to>` |
| All instruments (jobs, UI) | `market` | `Query GSI1 GSI1PK=INSTRUMENT` |
| Transactions of an account | `transactions` | `Query PK=ACCT#<acct>, SK begins_with TX#` |
| All transactions in date order (valuation) | `transactions` | `Query GSI1 GSI1PK=TX` |
| FX for a tax calculation | `market` | `Query PK=FX#EUR, SK <= <date>, ScanIndexForward=false, Limit=1` (previous business day) |
| Retail bond rate on a date | `market` | `Query PK=SERIES#<s>, SK <= RATE#<date>, ScanIndexForward=false, Limit=1` |
| Gap check | `market` | `Query PK=INST#<isin>, SK begins_with PX#<venue>#` over the look-back window, compared with the calendar |

## S3 raw archive

```
s3://<bucket>/raw/<source>/<YYYY>/<MM>/<DD>/<file>       e.g. raw/gpw/2026/10/09/obligacje_skarbowe.xls.gz
```

- Every job saves the original response (XLS, JSON, HTML) gzipped before parsing.
- Lifecycle: move to Glacier Instant Retrieval after 90 days.
- Nothing reads from it except a reprocessing script.

## Sizing

| Table | Data | Items |
|---|---|---|
| `market` | Daily prices: 25 instruments × 250 days × 20 years | ≈ 125,000 |
| `market` | Live quotes | ≈ 15 (overwritten) |
| `transactions` | Transactions | hundreds (the reference sheet: ≈ 750 in 4 years) |
| `holdings` | Snapshots | ≈ 250/year |

Total < 100 MB. A 10-year chart query reads about 2,500 items (≈ 500 KB, 1 page plus a few).

## Backup / export

- PITR covers mistakes in the last 35 days on `market` and `transactions`.
- Monthly: DynamoDB export of `transactions` and `market` to S3 (Parquet/JSON), also usable for ad-hoc analysis with DuckDB locally.
- `holdings` isn't backed up: rerun valuation over the needed date range instead.
