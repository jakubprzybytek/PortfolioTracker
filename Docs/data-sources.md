# Data sources

## Sources by asset type

| Asset | Examples | Daily source | Live source | Backfill source |
|---|---|---|---|---|
| UCITS ETFs on EU exchanges | Xetra, LSE, Euronext listings | Yahoo chart API (EODHD if it gets blocked) | – (EODHD delayed live API, later) | Yahoo (full daily history, one request per ETF) |
| Polish treasury bonds on GPW / Catalyst | DS, PS, WZ, IZ series | GPW archive: daily XLS with all treasury bonds | – | GPW archive: full history per bond (1 request each) |
| Polish corporate bonds on Catalyst | fixed and floating coupons | BiznesRadar: history page + today's quote | – | BiznesRadar: full history per bond (~16 pages) |
| Polish retail treasury bonds (not traded) | EDO, COI, ROD, ROR … | Calculated from terms + CPI | – | Calculated; checked against obligacjeskarbowe.pl interest tables |
| Foreign government bonds at IBKR | Bunds, OATs, US T-bills (zero-coupon) | onvista, Börse Stuttgart close (EUR bonds); calculated where there's no quote (US T-bills, matured bonds) | – | onvista daily history (Bund from 2020); calculated paths computed once on import |
| Manually valued assets | e.g. real-estate projects | Entered by you: "Edit values" in the asset's chart panel (Prices, Holdings) | – | `imports/prices/` |
| Cash | savings accounts, broker cash | From transactions | – | IBKR activity statements (CSV); the sheet import for the other accounts |

## Where transactions come from

Transactions are the only data the app can't fetch or rebuild (data-storage.md). Three sources, by account:

| Source | Accounts | Since | How |
|---|---|---|---|
| **The app** ("Add transaction" form, ui.md) | all | 2026-10-13 | Entered by you; `source: "app"`. **The app is now the record**: new transactions go here, not into the spreadsheet. |
| **The reference spreadsheet** ("Transakcje" tab) | all but IBKR | history up to 2026-10-13 | Converted once by `scripts/sheet-to-transactions.ts` (data/README.md). Not re-imported any more: its newer rows would duplicate what's entered in the app. |
| **IBKR activity statements** (CSV) | IBKR | whole history | Converted by `scripts/ibkr-statements-to-transactions.ts`; replaced the sheet's IBKR rows on 2026-10-13 (below). |

### IBKR activity statements – IBKR transactions (used, 2026-10-13)
- **Source:** Client Portal → Performance & Reports → Statements → Activity, a period of at most a year, format CSV. A file is a stack of sections (`Deposits & Withdrawals`, `Trades`, `Interest`, `Withholding Tax`, `Corporate Actions`, `Financial Instrument Information` …), each with its own header row. The files carry your name and account number: keep them out of the repo.
- **Why not the sheet:** the sheet booked IBKR in PLN and rounded the conversions to the grosz; it also missed some commissions, the accrued interest paid with a purchase, a coupon (booked as part of a sale) and the broker interest, and carried a wrong ISIN for one T-bill. Rebuilt from the statements, the cash per currency equals each statement's ending cash to the cent and the cost basis of every position equals IBKR's; the total barely moved, the profit shifted between realised gain, income and fees.
- **Booked as** (`core/transactions/ibkrStatement.ts`): deposits on the day IBKR credited them; forex trades netted per day and currency pair into one `EXCHANGE` (IBKR's automatic conversions buy and sell within a minute), their commissions (charged in EUR) as one `FEE` a day; bond and bill trades per 1000 nominal at the clean price, the commission as the fee; accrued interest paid with a purchase added to its cost; coupons, broker interest, withholding tax; maturities as `REDEMPTION` at 100 on the report date. Overlapping statements are merged (a row counts once).
- **Not in the statements:** interest accrued but not paid yet ("Interest Accruals"); it becomes a transaction when IBKR posts it.
- **Repeat** (to check the app against IBKR, or to rebuild the account): download every statement since the account was opened, run the script, compare its "cash at the end" with the last statement's Cash Report; to replace the stored history, back up and delete the account's imported transactions (keep the `source: "app"` ones the statements don't cover yet), then import the file.

## Source details

### Yahoo Finance chart API – ETFs (verified 2026-10-12)
- **Endpoint:** `query2.finance.yahoo.com/v8/finance/chart/<symbol>?period1=<unix>&period2=<unix>&interval=1d`, no key; the same one the reference sheet falls back to. Give `period1/period2`: `range=max` thins the series to monthly points. Client: `jobs/lib/yahoo.ts`.
- **Symbols:** the sheet's `EXCHANGE:CODE` → Yahoo suffix (`AMS` → `.AS`, `FRA`/`ETR` → `.DE` (Xetra), `LON` → `.L`, `WSE` → `.WA`).
- **Checked:** all 10 ETFs in the sheet (5 Amsterdam, 5 Xetra, all EUR) from AWS Lambda (`dev`, eu-west-1): full daily history (back to 2008–2021), ~0.1 s per request, 50 requests back to back without a 429. Closes match the sheet's trade prices within the day's range.
- **Watch out:** history is **split-adjusted** (SPXS, split 100:1 in 2026: 1093.04 in the sheet vs 10.91 on Yahoo), so un-adjust with the split events (`events=split`) or adjust the quantities; London listings come in pence (`GBp`, converted). Unofficial and unlicensed beyond personal use: the daily job reports a failure like the other jobs, and EODHD (below) is the paid fallback with the same shape of data.

### EODHD – ETFs (fallback)
- **Data:** EOD OHLCV (raw `close` and `adjusted_close`; we keep raw), splits, dividends, delayed live quotes (multiple tickers per request; each ticker counts as one call).
- **Tickers:** `<TICKER>.<EXCHANGE>`, e.g. `<TICKER>.XETRA`, `<TICKER>.LSE`. Map from ISIN once (EODHD search API or OpenFIGI).
- **Plan:** EOD plan ≈ $19.99/mo. The free plan (20 calls/day) is not enough once live quotes are polled (~10 tickers × ~35 polls/day).
- **Licence:** personal/internal use.

### GPW archive – treasury bonds on the exchange
- **URL:** `https://www.gpw.pl/archiwum-notowan?fetch=1&type=13&instrument=<CODE>&date=&show_x=Pokaż+wyniki`. Per instrument it returns one XLS with the **full daily history** since listing (verified 2026-10-10 in `poc/gpw-history`). With `instrument=` empty and `date=dd-mm-yyyy` it returns **one XLS for that day with all treasury bonds** (same columns). There's no "last N" or range option.
- **Data:** ISIN, OHLC (clean, % of nominal), change, volume, number of trades, turnover (thousand PLN), "Cena nominalna".
- **"Cena nominalna" is unreliable for IZ bonds:** since 2025-09-29 it's mostly 1000 instead of the indexed nominal. It's rounded to whole PLN and taken at the **settlement date (T+2 business days)**, not the session date. Compute the IZ indexed nominal instead (see below); use GPW's column only as a sanity check.

### IZ bonds – indexed nominal and accrued interest (verified 2026-10-10)

The nominal of IZ (inflation-linked treasury) bonds = 1000 PLN × **index ratio**. The ratio can be computed exactly from CPI:

```
W(n)        = ROUND(100 × Π (1 + WR_k), 5)       monthly reference index, chained from 2003-07; WR_k = CPI m/m of month k (e.g. 0.003)
Ref(d)      = W(M−3) + (day−1)/daysInMonth(M) × (W(M−2) − W(M−3))     for date d in month M (linear interpolation)
ratio(d)    = ROUND(Ref(d) / BaseRef, 5)          BaseRef for IZ0836 = 194.28509 (issue 2023-08-25)
nominal(d)  = 1000 × ratio(d)
accrued(d)  = ROUND(1000 × coupon × daysSinceCouponStart / daysInCouponPeriod × ratio(d), 2)   IZ0836: coupon 2 %, periods start 25 Aug
```

Verification:
- **11/11** values published by the Ministry of Finance (2026-09-01, 2026-10-01…10), both ratio and accrued interest, match exactly.
- BaseRef equals Ref(issue date).
- GPW's rounded nominal matches on **342/346** days with the T+2 settlement date. The 4 misses are next to public holidays, which the test's weekday-only T+2 count ignored.

Sources:

| Source | What | Use |
|---|---|---|
| **MF calculator** `kalkulatorodsetek.xlsm` ([gov.pl/web/finanse/kalkulatory2](https://www.gov.pl/web/finanse/kalkulatory2)), updated monthly | Sheet "Dane CPI": monthly `WR_k` and `W(n)` since 2003-07. Sheet "Indeksowane": every IZ series with ISIN, issue/maturity, `BaseRef`, coupon, coupon periods | Backfill: load the `W(n)` series and the IZ terms once. Read as data only; the calculation is in VBA macros, which we don't run |
| **GUS CPI m/m** (monthly CSV, see below) | Monthly CPI, previous month = 100 | Ongoing: append `WR_k` each month and compute the next `W(n)`. Needed by the 1st of month M+2 at the latest |
| **MF page** [Współczynniki indeksacji](https://www.gov.pl/web/finanse/wspolczynniki-indeksacji2) | Daily ratio + accrued interest for IZ0831/IZ0836, current and next month only (HTML table, no file) | Monthly cross-check of our calculation |

- **Valuation date:** for portfolio value on day D use `ratio(D)`. To reproduce a trade's settlement amount, use `ratio(T+2)`.
- **Cost:** free.
- **Rate sensitivity:** after a few dozen requests in minutes the server resets every connection for a while. A daily job needs only one request per bond.
- **Risk:** the format may change after GPW's migration to WATS (autumn 2026). The parser looks columns up by header name and fails loudly if one is missing.

### Accrued interest – computed, not fetched

Accrued interest is computed by the valuation job from each bond's terms. External data is needed only for inputs:

| Bond | Inputs | Where the inputs come from |
|---|---|---|
| Fixed-rate treasury, e.g. DS0432 | 1.75 %, coupon 25 Apr, 17.50 PLN per bond, maturity 2032-04-25 | MF calculator, sheet "Stałe" (all fixed-rate treasury series) |
| Inflation-linked IZ, e.g. IZ0836 | 2 %, coupon 25 Aug, index ratio | MF calculator + CPI; verified exactly against MF values (formula above) |
| Corporate, fixed coupon | rate, coupon dates, nominal | Terms of issue; entered once |
| Corporate, floating (WIBOR/WIRON + margin) | **the coupon rate of each period** + dates, nominal | **External, per period:** entered by hand (2–4×/year per bond) or scraped from the Catalyst interest tables (`statystyki-tabele-odsetkowe`). Not computed: no WIBOR/WIRON fixings source |
| Retail bonds (EDO, COI, ROD) | series terms + CPI | obligacjeskarbowe.pl terms; GUS CPI; MF interest tables as a check |

- For each corporate bond held, the coupon type (fixed or floating) has to be taken from its terms.
- **Check:** each coupon you enter as a transaction should equal the computed interest on the payment date. Flag a mismatch.

### BiznesRadar – Catalyst corporate bonds (used, 2026-10-12)
- `biznesradar.pl/notowania-historyczne/<CODE>[,<page>]`: daily open/max/min/close (clean, % of nominal), volume, turnover; 50 sessions per page, newest first; the page links the last page number. Lags a day (Monday evening it ended on Friday). `biznesradar.pl/notowania/<CODE>`: the latest quote in cells `pr_t_close`, `pr_t_open` …, its date in `pr_t_date`'s `<time datetime>`. Client: `jobs/lib/biznesradar.ts`.
- Coverage: every bond still listed, from its listing (KRU0827: 755 sessions since 2022-08-29). A redeemed bond answers 404: no history.
- Scraping a public site for personal use, one page every 2 s. The reference sheet uses it too (for corporate bonds).

### obligacje.pl – corporate bond terms
- `obligacje.pl/pl/obligacja/<CODE>`: issuer, ISIN, nominal, coupon type ("zmienne WIBOR 6M + 3.85%"), current rate (listed bonds only), first days of interest periods, record and payment dates, maturity. Used once, by hand, to build `data/private/catalyst.json` (ticker → ISIN, nominal, name); no past rates.

### gpwcatalyst.pl – Catalyst corporate bonds (not used)
- **Not in the GPW archive:** the gpw.pl archive has only treasury and state-guaranteed bonds (DS, IZ, PS, WZ, EUR, FPC…; checked 2026-10-10). Corporate bonds are only on gpwcatalyst.pl.
- **URL:** `https://gpwcatalyst.pl/notowania-obligacji-obligacje-korporacyjne`. One page lists all ~280 corporate bonds; codes can carry a suffix, e.g. ` /S` for the Warsaw Sustainable Segment.
- **Data:** issuer, code, segment, reference price, open, min/max, last trade date/time and volume, last price, change, number of trades, best bid/ask with order count and size, turnover. Interest tables (`statystyki-tabele-odsetkowe`) give accrued interest.
- **Snapshot only:** the latest session, with no archive or download. The page's "XLSX" button just exports the HTML table in the browser. It still showed Friday's session on Saturday, so it can be read any time before the next session opens.
- **A missed day is lost for good.** It can't be re-fetched later; it can only come from a backfill source.
- **Parsing:** the bid/ask cells contain sub-values, so data cells don't line up with header cells. Read cells by position, and check the expected count per row.
- **Clean price:** prices exclude accrued interest; market value = clean % × nominal + accrued interest.
- **Instruments list** `o-instrumentach-instrumenty-notowane`: every listed bond with its current nominal and accrued interest on one page. The reference sheet reads both from it (see reference/ReferenceFeatures.md); a candidate cross-check for our computed accrued interest.
- The reference sheet parses the quotes page by position too: ticker in the first or second cell, market code next, reference price 3 cells after the ticker, last price 9 cells after; rows with market other than `GPW` are skipped.

- **Unreachable from here since 2026-10-12** (TLS handshake hangs, home page included; GPW Benchmark too).

### Bossa (DM BOŚ) EOD files – Catalyst backfill candidate (gone)
- Checked 2026-10-12: `bossa.pl/pub/` redirects to `info.bossa.pl/pub/`, which only holds CFD reports; the EOD files are gone. The quote JSON below works and carries ISINs, but its data is frozen at 2026-10-02 (NOL3 outage).
- bossa.pl → Pliki z danymi → EOD (login required). Terms: personal, non-commercial use only.
- Historically the standard free source of full GPW/Catalyst history (MetaStock and text formats). **Current contents are not yet verified.**
- bossaAPI is not usable: NOL3 has been unavailable since 2026-10-02 and the new API is in a private pilot.
- **Website quote JSON (not verified):** the reference sheet reads current quotes from `bossa.pl/fl_api/API/GPW/v2/Q/C/<category>` (`_cat_shares`, `_cat_nConnect`, `_cat_etf`, `_cat_bonds`): one request per category, fields `_quote`, `_quote_ref`, `_change_pnts`, `_change_proc`. An undocumented endpoint behind the website: check terms and whether `_cat_bonds` covers Catalyst corporates before relying on it.

### GUS – CPI (monthly CSV)
- **Source:** "Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 roku" on [stat.gov.pl](https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/wskazniki-cen-towarow-i-uslug-konsumpcyjnych-pot-inflacja-/miesieczne-wskazniki-cen-towarow-i-uslug-konsumpcyjnych-od-1982-roku/), the same file the reference sheet uses. No key. One CSV (~230 KB, Windows-1250, `;`) with every month since 1982 in five bases (previous month = 100, same month of the previous year = 100, December of the previous year = 100, …); months not published yet have an empty value. The file name changes with updates, so the link is found on the page.
- **Used for:** IZ indexation (previous month = 100 → `WR_k`). Retail bonds take their rates from the MF file instead.
- Published around the 15th of the following month. The `monthly` job appends only months after the last stored one and never overwrites: for January the MF index keeps GUS's first (preliminary) figure, while the CSV later shows the revised one (2026-01: MF 0.6, CSV 100.7). The other 31 months 2024-01…2026-08 match the MF calculator exactly.
- **Not used:** the BDL API (`bdl.stat.gov.pl`) has CPI only as yearly data (to 2025). The DBW API (`api-dbw.stat.gov.pl`, no key) has monthly CPI (variable 305, section 1698 from 2026, totals: goods 14916914, households 6902025), but returns the whole breakdown per month (~19,500 rows, 4 pages) and its section id changed with COICOP 2018. Parser: `jobs/lib/gus.ts`.

### Retail bonds (obligacje detaliczne) – Ministry of Finance file
- **Source:** "Dane dotyczące obligacji detalicznych" (XLS) on [gov.pl/web/finanse/obligacje-detaliczne1](https://www.gov.pl/web/finanse/obligacje-detaliczne1), updated monthly. One tab per kind (EDO, COI, ROD, ROS, TOS, ROR, DOR …); per series: **ISIN**, term, sale period, issue and rollover price ("Cena zamiany", e.g. 99.90), the **rate actually paid in each year** (per month for ROR/DOR), the interest per bond the Ministry published (per period for COI/ROR/DOR, the total at maturity for EDO/ROD/ROS/TOS) and the margin.
- **Used for:** retail bond terms and rates, so no CPI calculation is needed (and no correction for March series, whose rates rest on a preliminary CPI). The `monthly` job downloads it (the attachment link changes with each update: found by its text), archives it in S3 and refreshes the instruments; `imports/mf-retail/` loads a copy by hand. Parser: `core/mf/retailRates.ts`.
- **Method, verified against every fully published series in the file (157 EDO, 60 ROS, 51 TOS, all COI/ROR/DOR periods; unit test):** a period earns base × rate × months/12; capitalising kinds compound **unrounded** and round only the amount; payout kinds round each payout to the grosz; within a period interest accrues by days elapsed / days in the period. Values are gross (before the 19 % tax) and ignore the early-redemption fee, like the reference sheet.
- **Per lot:** interest runs from each purchase's own date (transaction field `valueDate`), so lots of one series bought days apart differ slightly. Checked against the reference sheet: all open lots identical to the grosz per bond on 2026-10-11.
- A period whose rate isn't in the file yet keeps the last rate and is flagged `rate_pending`.

### Foreign bonds at IBKR – onvista quotes (used, 2026-10-14)
- **Source:** the onvista.de API (unofficial, no key), the same data as its website. `GET api.onvista.de/api/v1/bonds/ISIN:<isin>/snapshot` gives the bond's id and a quote per German exchange (each with an `idNotation`); `GET /api/v1/instruments/BOND/<id>/eod_history?idNotation=…&range=MAX&startDate=…` the daily open/high/low/close/volume, up to the last finished session. Client: `jobs/lib/onvista.ts`.
- **Exchange:** Börse Stuttgart (`sourceIds.onvista = "STU"`, venue `XSTU`): its market maker quotes the Bunds and OATs every trading day, even without trades. Checked on the three IBKR statement dates (2025-04-17, 2026-04-17, 2026-10-12): within 0.015 of IBKR's mark price for both bonds. Paris (the OAT's home market) has gaps and odd closes on onvista; Frankfurt has fewer quotes.
- **Daily:** the `eod-bonds` job (ingestion.md); the backfill loads the whole history when the source is set. Clean price, % of nominal; the bonds held are zero-coupon, so there's no accrued interest.
- **Not covered:** US T-bills (not listed in Germany) and matured bonds: they keep calculated prices (below).
- Compared with the calculated prices, the quotes differed by up to about 1 % (the constant-yield line ignores interest-rate moves).

### Foreign bonds at IBKR – calculated prices (used for bills and matured bonds, 2026-10-13)
- Meant for zero-coupon government bonds (Bunds, OATs, US T-bills), short and held to maturity. The instrument's `pricePath` holds your trade prices (% of nominal 1000) and, while held, 100 % at maturity (parsed from IBKR's name, "DE Govt 0.0 Nov15'27"); the backfill stores one price per weekday in between at a constant yield (`core/prices/pricePath.ts`) as `PX#CALC#…`. Exact at every trade and at maturity; between them it ignores market moves (up to about 1 % for a two-year Bund). A new trade (re-import) recomputes the path. A bond with a quote source (`sourceIds.onvista`) uses the quotes instead.
- The trade prices in `pricePath` are IBKR's (statement `T. Price`); a new trade means adding its price to the instrument (re-import it) so the path is recomputed.
- IBKR is kept in its currencies (2026-10-13): trades, fees and redemptions in the currency paid (EUR, USD), conversions as `EXCHANGE`, cash per currency, the account's own currency EUR. Its transactions come from the IBKR activity statements (above). Before that they were converted from the sheet, which booked everything in PLN (currency positions `Waluty_EUR` bought and sold with PLN); `core/transactions/nativeLedger.ts` pairs those back (sheet conversion `--native IBKR=EUR`) and stays for converting the sheet.

### IBKR Flex Web Service – IBKR trades, positions, cash (later)
- Would replace downloading statements by hand: the same activity data, fetched by a job.
- Token + query ID; plain HTTPS request; works from Lambda (no gateway).
- Data: positions with IBKR's mark prices and accrued interest, trades, cash, dividends/coupons.
- Not used: TWS API / Client Portal Web API (need an always-on gateway with 2FA re-login, which doesn't fit the serverless design).

### NBP API – exchange rates
- `api.nbp.pl/api/exchangerates/rates/a/{code}/{from}/{to}/` – table A mid rates, free, no key, max 93 days per request; a range without a table answers 404. Table A as a series starts on 2002-01-02 (EUR 3.5496). Client: `jobs/lib/nbp.ts`.
- Published around 11:45–12:15 on business days. Polish tax uses the rate from the business day before the transaction.
- **Used for:** valuing instruments and cash in another currency: value = quantity × close (or the cash) × the mid rate of the latest table on or before the day. Transactions in another currency count in PLN at the rate of the business day before (D-1, as Polish tax): purchase costs, sale proceeds, income, deposits (`core/valuation/fx.ts`). Paid in PLN at the broker's rate (Bossa), the cost is that PLN. Also the exchange-rate rows of the Indicators view.

### Optional / fallback
- **OpenFIGI** – ISIN → ticker per exchange (free).
- **Bundesbank** – daily prices/yields of listed federal securities by ISIN (free); backup for German Bunds.
- **Cbonds** – 2-week trial; Catalyst and EU bond history. Check whether data may be kept afterwards.
- **Biznesradar** – per-bond price history pages; scrape slowly, only for gaps, check terms.

## Sources rejected

| Source | Reason |
|---|---|
| Stooq | API key + quotas + JavaScript challenge since 2026 (CSV download returns the challenge page, 2026-10-12) |
| Google Finance | No API: `GOOGLEFINANCE()` works only inside Google Sheets |
| Alpha Vantage, Massive (Polygon) | Free tiers too small, US focus |
| IBKR TWS / Web API | Needs an always-on gateway + 2FA |
| bossaAPI | NOL3 switched off; new API in pilot |
| GPW paid history (1,900 PLN per year of data) | Only if free/cheap options fail for Catalyst corporates |
