# Data sources

## Sources by asset type

| Asset | Examples | Daily source | Live source | Backfill source |
|---|---|---|---|---|
| UCITS ETFs on EU exchanges | Xetra, LSE, Euronext listings | EODHD EOD API | EODHD delayed live API | EODHD (full history) |
| Polish treasury bonds on GPW / Catalyst | DS, PS, WZ, IZ series | GPW archive: daily XLS with all treasury bonds | – | GPW archive: full history per bond (1 request each) |
| Polish corporate bonds on Catalyst | fixed and floating coupons | gpwcatalyst.pl corporate quotes page (snapshot, no archive) | – | Bossa EOD files → Cbonds trial → Biznesradar |
| Polish retail treasury bonds (not traded) | EDO, COI, ROD, ROR … | Calculated from terms + CPI | – | Calculated; checked against obligacjeskarbowe.pl interest tables |
| EU government bonds at IBKR | Bunds, OATs, T-bills | IBKR Flex Web Service (mark price) | – | IBKR Flex (period statements); Bundesbank for the Bund |
| Manually valued assets | e.g. real-estate projects | Manual entry | – | Manual |
| Cash | savings accounts, broker cash | From transactions / manual balances | – | Broker CSV / sheet import |

## Source details

### EODHD – ETFs
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
| **GUS CPI m/m** (BDL API, already planned for retail bonds) | Monthly CPI, previous month = 100 | Ongoing: append `WR_k` each month and compute the next `W(n)`. Needed by the 1st of month M+2 at the latest |
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

### gpwcatalyst.pl – Catalyst corporate bonds
- **Not in the GPW archive:** the gpw.pl archive has only treasury and state-guaranteed bonds (DS, IZ, PS, WZ, EUR, FPC…; checked 2026-10-10). Corporate bonds are only on gpwcatalyst.pl.
- **URL:** `https://gpwcatalyst.pl/notowania-obligacji-obligacje-korporacyjne`. One page lists all ~280 corporate bonds; codes can carry a suffix, e.g. ` /S` for the Warsaw Sustainable Segment.
- **Data:** issuer, code, segment, reference price, open, min/max, last trade date/time and volume, last price, change, number of trades, best bid/ask with order count and size, turnover. Interest tables (`statystyki-tabele-odsetkowe`) give accrued interest.
- **Snapshot only:** the latest session, with no archive or download. The page's "XLSX" button just exports the HTML table in the browser. It still showed Friday's session on Saturday, so it can be read any time before the next session opens.
- **A missed day is lost for good.** It can't be re-fetched later; it can only come from a backfill source.
- **Parsing:** the bid/ask cells contain sub-values, so data cells don't line up with header cells. Read cells by position, and check the expected count per row.
- **Clean price:** prices exclude accrued interest; market value = clean % × nominal + accrued interest.

### Bossa (DM BOŚ) EOD files – Catalyst backfill candidate
- bossa.pl → Pliki z danymi → EOD (login required). Terms: personal, non-commercial use only.
- Historically the standard free source of full GPW/Catalyst history (MetaStock and text formats). **Current contents are not yet verified.**
- bossaAPI is not usable: NOL3 has been unavailable since 2026-10-02 and the new API is in a private pilot.

### GUS BDL – CPI
- `bdl.stat.gov.pl/api/v1`, free API key. Monthly CPI (y/y, previous year = 100); used for EDO/COI/ROD rate resets and IZ indexation.
- Final figure published around mid-month.

### Retail bond terms (obligacje detaliczne)
- Static per series: first-period rate, margin over CPI, purchase date, number of bonds, early-redemption fee.
- Source: the series' terms of issue (list emisyjny) on obligacjeskarbowe.pl, entered once per series.
- Check: the official interest tables (tabele odsetkowe, PDF per series) give accrued interest per bond per day.

### IBKR Flex Web Service – IBKR bonds, positions, cash
- Token + query ID; plain HTTPS request; works from Lambda (no gateway).
- Data: positions with IBKR's mark prices and accrued interest, trades, cash, dividends/coupons.
- Not used: TWS API / Client Portal Web API (need an always-on gateway with 2FA re-login, which doesn't fit the serverless design).

### NBP API – exchange rates
- `api.nbp.pl/api/exchangerates/rates/a/{code}/{from}/{to}/` – table A mid rates, free, no key, max 93 days per request.
- Published around 11:45–12:15 on business days. Polish tax uses the rate from the business day before the transaction.

### Optional / fallback
- **OpenFIGI** – ISIN → ticker per exchange (free).
- **Bundesbank** – daily prices/yields of listed federal securities by ISIN (free); backup for German Bunds.
- **Cbonds** – 2-week trial; Catalyst and EU bond history. Check whether data may be kept afterwards.
- **Biznesradar** – per-bond price history pages; scrape slowly, only for gaps, check terms.

## Sources rejected

| Source | Reason |
|---|---|
| Yahoo Finance (yfinance) | No official API, frequent 429 blocks, no guarantee |
| Stooq | API key + quotas + JavaScript challenge since 2026 |
| Alpha Vantage, Massive (Polygon) | Free tiers too small, US focus |
| IBKR TWS / Web API | Needs an always-on gateway + 2FA |
| bossaAPI | NOL3 switched off; new API in pilot |
| GPW paid history (1,900 PLN per year of data) | Only if free/cheap options fail for Catalyst corporates |
