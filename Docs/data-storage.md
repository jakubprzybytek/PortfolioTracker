# Data storage

One DynamoDB table, on-demand capacity, plus an S3 bucket used only as a raw-file archive.

## Table `portfolio`

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String | Partition key |
| `SK` | String | Sort key |
| `GSI1PK` | String | Sparse: set only on items that must be listed by type |
| `GSI1SK` | String | |
| `ttl` | Number | Optional, epoch seconds |

Settings: point-in-time recovery **on** (35-day restore window, a few cents a month at this size), deletion protection **on**.

Index `GSI1` (`GSI1PK`, `GSI1SK`), projection ALL. Used for "list all instruments" and "all live quotes".

## Conventions

- **Dates** are ISO `YYYY-MM-DD` in the **venue's local calendar** (trade date), so they sort correctly as strings.
- **Timestamps** are ISO 8601 UTC (`fetched_at`, `updated_at`).
- **Numbers** are DynamoDB Numbers, handled as decimals in code (never floats).
- **Currency** is stored on every price item; nothing is converted at write time.
- **Bond prices** are stored as clean price in % of nominal; accrued interest is stored separately per bond in currency.
- Every item written by a job carries `source` and `fetched_at`.

## Items

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

`status` (`pending` / `done` / `no_history` / `failed`), `source`, `from`, `to`, `rows`, `updated_at`, `note`. Written by the `backfill` and `import` Lambdas; shown in the UI.

### Retail bond rate periods

```
PK = SERIES#<series>        SK = RATE#<period_start>
```

`period_start`, `period_end`, `rate`, `basis` (`FIXED` / `CPI+margin`), `cpi_ref` (month used).

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

### Accounts and transactions

```
PK = ACCT#<account>         SK = META                           broker, currency, name
PK = ACCT#<account>         SK = TX#<YYYY-MM-DD>#<tx_id>        type, isin, quantity, price, amount, fee, currency, fx_rate, source
```

`type`: `BUY`, `SELL`, `DIVIDEND`, `COUPON`, `REDEMPTION`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`.
`tx_id` is deterministic (broker id, or a hash of the row), so imports can be re-run safely.

### Portfolio snapshots

```
PK = PORTFOLIO              SK = SNAP#<YYYY-MM-DD>
PK = PORTFOLIO              SK = SNAP#LATEST
```

Written by the valuation job: per holding `quantity`, `price`, `price_date`, `value_ccy`, `value_pln`, `cost_pln`; totals per account and per asset type. The UI's history chart and dashboard come from these items.
Items stay small: about 25 holdings, well under the 400 KB item limit.

### Job runs

```
PK = JOB#<job_name>         SK = RUN#<started_at>    status, items_written, gaps_found, errors, ttl (90 days)
```

## Access patterns

| Need | Operation |
|---|---|
| Dashboard | `Get PORTFOLIO/SNAP#LATEST` + `Query GSI1 GSI1PK=LIVE`; the api Lambda swaps in live prices where newer |
| Portfolio value over time | `Query PK=PORTFOLIO, SK between SNAP#<from> and SNAP#<to>` |
| Price chart for one instrument | `Query PK=INST#<isin>, SK between PX#<venue>#<from> and PX#<venue>#<to>` |
| All instruments (jobs, UI) | `Query GSI1 GSI1PK=INSTRUMENT` |
| Transactions of an account | `Query PK=ACCT#<acct>, SK begins_with TX#` |
| FX for a tax calculation | `Query PK=FX#EUR, SK <= <date>, ScanIndexForward=false, Limit=1` (previous business day) |
| Retail bond rate on a date | `Query PK=SERIES#<s>, SK <= RATE#<date>, ScanIndexForward=false, Limit=1` |
| Gap check | `Query PK=INST#<isin>, SK begins_with PX#<venue>#` over the look-back window, compared with the calendar |

## S3 raw archive

```
s3://<bucket>/raw/<source>/<YYYY>/<MM>/<DD>/<file>       e.g. raw/gpw/2026/10/09/obligacje_skarbowe.xls.gz
```

- Every job saves the original response (XLS, JSON, HTML) gzipped before parsing.
- Lifecycle: move to Glacier Instant Retrieval after 90 days.
- Nothing reads from it except a reprocessing script.

## Sizing

| Data | Items |
|---|---|
| Daily prices: 25 instruments × 250 days × 20 years | ≈ 125,000 |
| Live quotes | ≈ 15 (overwritten) |
| Snapshots | ≈ 250/year |
| Transactions | hundreds |

Total < 100 MB. A 10-year chart query reads about 2,500 items (≈ 500 KB, 1 page plus a few).

## Backup / export

- PITR covers mistakes in the last 35 days.
- Monthly: DynamoDB export to S3 (Parquet/JSON), also usable for ad-hoc analysis with DuckDB locally.
