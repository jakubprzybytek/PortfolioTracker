# Data storage

Three DynamoDB tables, all on-demand capacity, plus an S3 bucket used only as a raw-file archive.

| Table | Contents | Written by | Can be rebuilt? |
|---|---|---|---|
| `market` | Instruments, daily prices (incl. today's refreshed quotes), events, coupon periods of corporate bonds, retail-bond rates, CPI, FX, calendar, backfill status, job runs | Scheduled jobs, backfill, import (instruments) | Yes: re-fetch, or reprocess the S3 archive (the only source for past Catalyst snapshots) |
| `transactions` | Accounts, transactions; later also allocation targets and multi-asset splits | You: the app's form, file imports (the sheet once, IBKR statements) | **No.** This is the only data that exists nowhere else (IBKR's can be rebuilt from its statements) |
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
| Monthly export to S3 | instruments, prices entered by hand | yes | no |

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
| `isin`, `name`, `type` | `IE00B3RBWM25`, "Vanguard FTSE All-World", `ETF` / `BOND_LISTED` / `BOND_CORPORATE` / `BOND_RETAIL` / `BOND_IBKR` / `FUND_MANUAL` / `CURRENCY` (foreign cash as a position, from the old PLN-only bookings; accounts in several currencies hold cash per currency instead) / `CASH` |
| `currency`, `venue` | `EUR`, `XAMS` (MIC of the listing prices come from: `XAMS` Euronext Amsterdam, `XETR` Xetra, `XWAR` GPW) |
| `sourceIds` | `{ "yahoo": "VWRL.AS" }`, `{ "gpw": "<CODE>" }`, later `{ "ibkr_conid": "…" }` |
| `nominal` | Corporate bonds (`BOND_CORPORATE`, no terms): nominal per bond (1000 or 100); prices are clean % of it; value = clean % × nominal + accrued interest from its coupon periods |
| `pricePath` | Foreign bonds at IBKR (`BOND_IBKR`, `nominal` 1000) without a quote (`venue = CALC`: US T-bills, matured bonds): known prices `[{ date, price }]` (% of nominal: your trades, redemption at maturity); the backfill writes a price per weekday in between at a constant yield. Quoted ones have `venue = XSTU`, `sourceIds.onvista = "STU"` |
| `splits` | ETFs: `[{ "date": "2025-12-15", "ratio": 100 }]`: from `date` on one unit became `ratio` units. Prices are stored as traded; charts and the 1-year change divide earlier prices by later splits (`core/prices/splits.ts`) |
| `assetClass` | `SHARES` / `BONDS` / `CASH` / `OTHER`, only when set by hand and different from the rule (by type; an ETF with "bond" in its name = bonds; `assetClassOf` in `core/valuation/history.ts`). The valuation copies it into the day's holdings (`assetClass` there too), so the allocation charts (`byClass`) follow it; changing it revalues the instrument from its first transaction |
| `live` | Not used: which instruments "Update prices" covers follows from their price source (ingestion.md, "Live prices") |
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

Not a separate item: "Update prices" writes today's quote as today's price item (`PX#<venue>#<today>`, `status = provisional`, `quoteTime` = when the source set it; holdings and price rows carry it on as `priceTime`), which the evening close overwrites (ingestion.md, "Live prices"). The valuation then values today as usual, so every view reads one shape and history keeps one price per day. (Planned before: a `LIVE` item per instrument swapped in by the api Lambda.)

### Corporate / bond events

```
PK = INST#<ISIN>            SK = EV#<YYYY-MM-DD>#<DIV|SPLIT|COUPON|REDEMPTION>
```

`ex_date`, `pay_date`, `amount`, `currency`, `ratio` (splits), `source`.

### Coupon periods (corporate bonds)

```
PK = INST#<ISIN>            SK = COUPON#<start>
```

`start`, `end` (exclusive: the next period's start), `recordDate`, `paymentDate`, `datesSource`, `rate` (annual, e.g. 0.0713; absent: no accrued interest that period), `rateSource` (`manual` / `obligacje.pl` / `coupons`), `otherRate` (`{ rate, source, seenAt }`: obligacje.pl showed another rate, not used until you accept it). One item per period. Rates you set or accepted exist nowhere else: the monthly `Export` includes them (`coupons.json`).

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
```

### Exchange calendar

```
PK = CAL#<venue>            SK = <YYYY-MM-DD>       type = HOLIDAY | HALF_DAY, note
```

Planned, not filled yet: entered by hand once a year, for gap repair (a holiday isn't a gap).

### Job runs

```
PK = JOB#<job_name>         SK = RUN#<startedAt>     job, startedAt, finishedAt, status (ok / failed), itemsWritten, note, ttl (90 days)
```

One item per finished run, written by `runJob` (`jobs/lib/context.ts`) around each job's body: `ok` with what the job returns (`itemsWritten`, `note`), or `failed` with the error in `note` (the error is rethrown, so each Lambda retry is a run of its own). A run still going, or one cut off by a timeout, leaves no item. DynamoDB TTL deletes runs after 90 days. Read only as the latest run of a job (query newest first, limit 1): `GET /status` (the Dashboard's Jobs table and its failed-jobs banner) and the rate limit on "Update prices" (the last `live` run).

## Table `transactions`

### Accounts

```
PK = ACCT#<account>         SK = META
GSI1PK = ACCOUNT            GSI1SK = <account>
```

`account`, `incomplete` (kinds of assets not tracked yet, e.g. `["ETFs"]`; absent = complete), `updatedAt`. Imported from `imports/accounts/` (written by the sheet converter). An incomplete account's cash is shown but not added to the total.

### Transactions

```
PK = ACCT#<account>         SK = TX#<YYYY-MM-DD>#<tx_id>
GSI1PK = TX                 GSI1SK = <YYYY-MM-DD>#<tx_id>
```

`type`, `isin`, `quantity`, `price`, `amount`, `fee`, `currency`, `fxRate`, `ratio`, `toAmount`, `toCurrency`, `note`, `source`.

`type`: `BUY`, `SELL`, `COUPON`, `REDEMPTION`, `WRITE_OFF`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`, `DIVIDEND`, `SPLIT`, `EXCHANGE`. `WRITE_OFF`: units lost to a default (`quantity`, `amount` 0), closed at 0.
**Currencies: all equal.** `amount` and `fee` are in `currency`, the currency actually paid or received (PLN, EUR, USD …); cash is kept per account and currency. Paid in PLN for an instrument in another currency (ETFs at Bossa): `price` in the instrument's currency, `amount` and `fee` in PLN, `fxRate` = the broker's PLN per unit. Paid in the instrument's currency (IBKR): `amount` and `fee` in it, no `fxRate`. `EXCHANGE`: `amount` (negative) and `fee` leave in `currency`, `toAmount` arrives in `toCurrency` (the broker's rate is their ratio). In PLN, every transaction counts at the NBP mid rate of the business day before it (D-1, as Polish tax): purchase costs (FIFO lots keep that PLN cost and the cost as paid), sales, income, deposits; the broker's spread shows in the account's profit (money in vs value), not in a position's gain. Accounts have an optional `baseCurrency` (IBKR: EUR): their summary is also given in it. `SPLIT`: `ratio` (units after per unit before), `amount` 0; the position's quantity × `ratio`, cost unchanged. `DIVIDEND` counts as income received, like coupons.
`valueDate` (optional): retail bonds, when interest starts if not the transaction date. Retail positions are valued per lot (each buy; sales take the oldest lots first).

**Same-day order:** buys before sales (then the rest), so a sale of what was bought the same day (currency at IBKR) isn't clipped.

**Cost basis: FIFO.** Positions keep their open lots (one per buy, oldest first); a sale or redemption takes the oldest lots first, a partly sold lot keeping its cost per unit, and records the matched cost and the proceeds (`core/valuation/positions.ts`). A split multiplies every lot's units. Same as the reference sheet and Polish tax (PIT-38).

**Cash** of an account = Σ of its transactions' cash effects: BUY = `amount` (the trade value) minus `fee`; every other type's `amount` already is the cash effect (SELL: received, net of the fee). Computed by the valuation (`core/valuation/cash.ts`), not stored per transaction.

**Assets without an ISIN** (manually valued, e.g. a property fund share) get a private id in ISIN format with the ISO user-assigned prefix `ZZ` (`ZZRZESZOW000`), which no real ISIN uses. Their prices are `PX#MANUAL#<date>` items, entered in the app ("Edit values", `source: "app"`) or from `imports/prices/`. Being your input, they're in the monthly backup.
`tx_id` is deterministic (broker id, or a hash of the row), so imports can be re-run safely. `GSI1` lists all transactions across accounts in date order, which is what valuation replays.

### Notes

```
PK = NOTE#<note_id>         SK = META
GSI1PK = NOTE               GSI1SK = <note_id>
```

`id` (random), `title`, `body` (Markdown), `createdAt`, `updatedAt`. Written in the app (Notes view); `GSI1` lists them all. Your input, so here and in the monthly backup.

### Settings

```
PK = SETTING#<name>         SK = META
```

`value`, `updatedAt`: choices made in the app that aren't data, e.g. `holdSell` (the Hold or sell assumptions: `cpi`, `wibor`, `nbpRate`, `alternative`, `altRate`, `commission`). Deleted to go back to the defaults. Not in the monthly backup (set again in a minute).

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

Written by the valuation job: `accounts` (per account: `cash`, `incomplete`), `totals.cash` (complete accounts only), and one holding per **account and instrument** (the same bond in two accounts is two holdings), sorted by account then code. Per holding `account`, `quantity`, `price`, `price_date`, `nominal`, `accrued_interest`, `value_per_unit`, `value`, `cost`, `coupons_received`, `gain`; totals; values per asset type. The UI's history chart, dashboard and Holdings view come from these items. Snapshots written before 2026-10-11 have no `account`; only `SNAP#LATEST` is read per holding, and every valuation run rewrites it.
Items stay small: about 25 holdings, well under the 400 KB item limit.

### History points

```
PK = HISTORY                SK = <YYYY-MM-DD>
```

`date`, `totals`, `byType`, `byClass` (value per asset class: SHARES, BONDS, CASH, OTHER), `fingerprint` (of the day's snapshot as written: a revaluation that gets the same skips the day without reading its snapshot; ingestion.md, "Only what changed is written"): the part of a day's snapshot the Dashboard's charts use, without the holdings (~250 bytes instead of ~2–20 KB). Written by the valuation in the day's position-day batch, when the point is new or differs from the stored one: a range valued before points existed gets them from its next run over it. Read by `GET /portfolio/history` (`netDeposits` is computed there from the transactions, so it can't go stale). All 6,791 days of the `test` stage (2008→) are ~1.7 MB, two pages, where the snapshots were 13 MB and ~5 s.

### Position history

```
PK = POS#<account>#<isin>   SK = <YYYY-MM-DD>
```

`account`, `isin`, `date`, `quantity`, `value`, `cost`: each position's value on each day, written by the valuation alongside the snapshot (one batch per day, only the positions whose quantity, value or cost changed: ingestion.md, "Only what changed is written"). Read by the Holdings row charts (`GET /holdings/history`); about 15 items a day, so a year of one position is one small query instead of reading 365 snapshots.

## Access per function

Each function links only the tables it needs.

| Function | `market` | `transactions` | `holdings` |
|---|---|---|---|
| `EodGpw`, `RecheckGpw`, `EodEtf`, `EodCatalyst`, `EodBonds` (and their rechecks), `Live`, `Coupons`, `Monthly` | read/write | — | — |
| `Fx` | read/write | read | — |
| `Export` | read | read | — |
| `Backfill` | read/write | — | — |
| `Import` | read/write (instruments, reference index) | read/write | — |
| `Valuation` | read (writes its job run) | read | write |
| `Api` | read | read/write (transactions, notes) | read |

## Access patterns

| Need | Table | Operation |
|---|---|---|
| Dashboard | `holdings` | `Get PORTFOLIO/SNAP#LATEST` (after "Update prices", valued with today's quotes) |
| Portfolio value over time | `holdings` | `Query PK=HISTORY, SK between <from> and <to>` |
| Price chart for one instrument | `market` | `Query PK=INST#<isin>, SK between PX#<venue>#<from> and PX#<venue>#<to>` |
| All instruments (jobs, UI) | `market` | `Query GSI1 GSI1PK=INSTRUMENT` |
| Transactions of an account | `transactions` | `Query PK=ACCT#<acct>, SK begins_with TX#` |
| All transactions in date order (valuation) | `transactions` | `Query GSI1 GSI1PK=TX` |
| All notes (Notes view) | `transactions` | `Query GSI1 GSI1PK=NOTE` |
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
- **Monthly backup** (`Export` job, 1st of the month 04:00): what exists nowhere else, written to `exports/<date>/` in the files bucket, each in its import format (data/README.md): `accounts.json`, `instruments.json` (treasury terms by reference, `"mf"` / `"mf-retail"`, resolved again on import), `prices.json` (prices entered by hand), `coupons.json`, `transactions.json` (with their ids and sources, so a restore gives the same rows) and `notes.json`. Restore: upload the files to `imports/<kind>/` in that order (after the MF calculator and retail files). The rest of `market` (prices, rates, CPI) is fetched again by the jobs and the backfill.
- `holdings` isn't backed up: rerun valuation over the needed date range instead.
