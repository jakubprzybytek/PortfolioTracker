# Backfill

Backfill uses the same adapters as the daily jobs (`fetch → archive → parse → validate → upsert`), only with a long date range. Because writes are idempotent, any backfill can be re-run.

**How far back:** from the first purchase of each holding (the earliest `TX` per ISIN), or further where it's free. For a chart of something you no longer hold, add the instrument with `active = false`.

## Triggers

| Trigger | When | How |
|---|---|---|
| **Automatic: new instrument** | You import an instrument that has no backfill status yet | The `import` Lambda invokes the `backfill` Lambda for that instrument, from its source's earliest date. (A DynamoDB stream was used before; on a newly created table it missed the first inserts, and re-importing never retried.) |
| **Manual** | First load, filling gaps, after a parser fix | Invoke the same `backfill` Lambda with `{ isin, source, from? }`, from a script run with `sst shell` |
| **File import** | Sources delivered as files: Bossa EOD files, Cbonds export, MF calculator `kalkulatorodsetek.xlsm`, transaction files | Upload to the bucket under `imports/<kind>/…`. The S3 event invokes the `import` Lambda, which parses the file and upserts the rows |
| **Reprocessing** | A parser bug found later | Script via `sst shell` that re-parses the originals in `raw/` and upserts again |

After each backfill or import, the Lambda **queues a valuation re-run from the earliest changed date**, so snapshots and charts include the new history.

**Status per instrument** is stored in `INST#<isin>/BACKFILL` (see data-storage.md). When no source has history (e.g. a Catalyst corporate bond with no import yet), the status is `no_history`, so the gap shows in the UI instead of failing silently.

**Limits:** a Lambda runs for at most 15 minutes. That's enough for every source here (GPW: one request per bond; CPI and MF data: one file each). Anything bigger runs locally via `sst shell` with the same code.

## Order

Reference data and transactions come first, because they define which instruments and which dates are needed.

| # | Step | Source | Cost | Effort |
|---|---|---|---|---|
| 1 | Instruments: ISIN, type, currency, venue, source tickers, bond terms (coupon type, rate/margin, dates, nominal; floating: rate per period) | Sheet + terms of issue / MF calculator / gpwcatalyst.pl | free | manual + import |
| 2 | Exchange calendars (XWAR, XETRA, LSE …) for the backfill years | Exchange holiday lists | free | manual |
| 3 | Transactions and cash | Sheet export (done), IBKR activity statements (done); later IBKR Flex | free | script per format |
| 4 | FX (EUR, USD → PLN) | NBP API, chunks of 93 days | free | script |
| 5 | CPI, IZ reference index, IZ series terms | MF calculator `kalkulatorodsetek.xlsm` (file import) + GUS CPI CSV | free | import |
| 6 | Retail bond rate periods | Terms of issue + CPI → computed; checked against obligacjeskarbowe.pl interest tables | free | script + manual check |
| 7 | ETFs: prices, splits, dividends | EODHD, one paid month (plan kept afterwards for live quotes) | ≈ $20 | script |
| 8 | Treasury bonds on GPW | GPW archive XLS, one file per bond with full history | free | script (PoC done) |
| 9 | Catalyst corporate bonds | Bossa EOD files → Cbonds trial → Biznesradar (see below) | free / trial | depends |
| 10 | EU government bonds at IBKR | onvista (Börse Stuttgart) daily history (done); calculated from the trade prices for US T-bills | free | backfill |
| 11 | Portfolio snapshots | `valuation` job run for every date in the range | free | script |

## Per step

### 1. Instruments
- Build `INST#<ISIN>/META` from the sheet's holdings.
- ETF listings: one ISIN can trade on several venues; pick the one you actually hold (it's on the broker statement) and resolve the EODHD ticker via the EODHD search API or OpenFIGI.
- Bonds: nominal, coupon, maturity, coupon schedule from the issuer's terms or gpwcatalyst.pl.

### 3. Transactions
- Entered by you: the app's "Add transaction" form, or a JSON file uploaded to `imports/transactions/` (format: data/README.md).
- One converter per format, writing that JSON: the reference sheet (`scripts/sheet-to-transactions.ts`), IBKR activity statements (`scripts/ibkr-statements-to-transactions.ts`); IBKR Flex XML later.
- `tx_id` = broker id where available, else a hash of (date, isin, type, quantity, amount), so re-imports don't create duplicates.

### 4–6. FX, CPI, retail bonds
- NBP: `/api/exchangerates/rates/a/eur/{from}/{to}/` in ≤ 93-day windows.
- CPI from the GUS monthly CSV (data-sources.md); the MF calculator covers the history, the `monthly` job appends new months.
- Retail bonds:
  - Generate `SERIES#…/RATE#…` from the first-period rate plus CPI + margin for later periods.
  - Run the calculator for every day.
  - Compare a sample of days per series with the official interest table PDF.

### 7. ETFs (EODHD)
- For each ETF: `eod` endpoint with `from` = first available date (no `to`), then `splits` and `div` endpoints.
- Store raw `open/high/low/close/volume`; ignore `adjusted_close`.
- About 30 calls in total, well within any plan.

### 8. GPW treasury bonds
- **Proven by the PoC** (`poc/gpw-history`): one request per bond (`archiwum-notowan?fetch=1&type=13&instrument=<CODE>&date=`) returns an XLS with the bond's whole daily history since listing.
- Columns: date, code, ISIN, currency, OHLC (clean, % of nominal), change, volume, number of trades, turnover (thousand PLN), "Cena nominalna". That last column is unreliable for IZ bonds (mostly 1000 since 2025-09-29), so compute the indexed nominal separately.
- gpw.pl resets connections after too many requests in a short time. Keep runs to a few requests, 5 s apart.
- Accrued interest and IZ nominal: computed by the valuation from the bond terms and CPI (see data-sources.md). Nothing to backfill except the MF calculator data (step 5).

### 9. Catalyst corporate bonds

Not in the GPW archive, and gpwcatalyst.pl has no history. **Start the daily `eod-catalyst` job as early as possible**: every evening it isn't running is a day only the backfill sources below can provide.

Try in this order and stop at the first that works:

1. **Bossa EOD files** (login, personal non-commercial use). If they include Catalyst/obligacje, download the history files once and parse them; this is the cheapest and most complete option.
2. **Cbonds 2-week trial.** Before using it, check the trial terms allow keeping the data. Pull all held ISINs in one session.
3. **Biznesradar** per-bond history pages: slow scrape, only the held bonds, check terms first.
4. **GPW paid history** (product #15, 1,900 PLN per year of data) – only if a complete licensed record is needed.

Accrued interest is computed by the valuation from each bond's coupon periods. The backfill of a new corporate bond also loads its periods from obligacje.pl (dates of every period, the current rate); past rates come from the coupons received ("Use … (your coupons)" in the bond's Coupon periods panel) or are typed in. See data-sources.md, "Corporate bonds: coupon periods".

### 10. IBKR bonds
- Done without Flex: the EUR bonds' whole history from onvista (Börse Stuttgart); US T-bills and matured bonds calculated between the trade prices and 100 % at maturity (data-sources.md). With Flex:
- Flex query with a custom date range; positions include IBKR's mark price and accrued interest per day.
- Flex limits the length of one statement period, so run it in chunks (e.g. monthly) and merge.
- German Bunds: optionally cross-check with the Bundesbank daily price series.

### 11. Snapshots
- Run the valuation for every trading day from the first transaction to yesterday.
- At ~25 holdings this takes seconds; re-run whenever transactions or prices are corrected.

## Verification after backfill

- [ ] For each instrument: count of `PX` items vs trading days in the calendar; list the gaps.
- [ ] Spot-check 3 random dates per instrument against a second source (broker statement, website).
- [ ] Portfolio value at a few month-ends matches the broker statements / the old sheet within rounding.
- [ ] Retail bond values match the official interest tables.
- [ ] No unresolved `jump` flags.

## After the backfill

- Schedule the daily jobs (see [ingestion.md](ingestion.md)); their 10-day look-back closes the gap between backfill and go-live. Catalyst has no look-back, so start `eod-catalyst` first.
- New holdings later are backfilled automatically when their first transaction creates the instrument.
- From then on the database is the history, and no paid backfill is needed again.
