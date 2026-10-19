# Reference spreadsheet – feature inventory

The app reproduces the Google Sheets tracker Portfolio Tracker 2.0.1 (your own copy, private) (inwestomat.eu template by Piotrek, version of 2026-07-01) as a cloud app. This document lists what the sheet does, from an analysis of its XLSX export and of its Apps Script code (the `.gs` / `.html` files in this folder), 2026-10-11.

The sheet is formulas plus a bound Apps Script. The script does the heavy lifting: it rebuilds holdings from transactions (FIFO), refreshes prices, appends the daily history row, fetches CPI and retail-bond rates, builds the closed-position report and benchmarks, and provides the data-entry forms.

## Scripts in this folder

| File | Role |
|---|---|
| `zmienne.gs` | Sheet and asset-class names |
| `makra.gs` | Menu, daily schedule (`masterDaily`), history snapshot, month-end roll-up, issue checker, version check, transaction sorting |
| `FIFO.gs` | `przeliczPortfolio`: rebuilds `Portfolio` (quantity, average price, cost) from transactions, FIFO |
| `Sell_Summary.gs` | `generateSprzedazPodsumowanie`: closed-position report, FIFO buy/sell pairs with fees and dividends |
| `form_BE.gs`, `form_FE.html` | "Add transaction" sidebar: validation, ticker normalisation, name and FX lookup, automatic companion transactions |
| `form_Obligacje_BE.gs`, `form_Obligacje_FE.html`, `form_Obligacje_sell_FE.html` | Retail bonds: buy/sell forms, CPI download from GUS, rate formulas, rate check against the Ministry of Finance file, bonds-tab repair |
| `OprocentowanieObligacji.gs` | Downloads and parses the Ministry of Finance retail-bond rates file |
| `obligacje_IZ.gs` | Scrapes the Ministry's IZ indexation page (indexed nominal and accrued interest) |
| `Benchmarki.gs` | Benchmark simulation (portfolio vs CPI and up to 5 tickers) |
| `multiasset_scripts.gs`, `multiasset.html` | Multi-asset fund configuration sidebar |
| `migracja.gs` | Migration from a previous version of the sheet; creates the time triggers |
| `daneGiełdowe.gs` | Price and FX refresh (`runKursy`): one quote per held ticker from a chain of sources per asset class; Catalyst accrued interest and nominal; NBP rate for transactions |

## Tabs

| Tab | Visible | Role |
|---|---|---|
| `Dashboard` | yes | Summary, allocation vs targets, per-account table, 9 charts, error banner, version notice |
| `Portfolio` | yes | Holdings: one row per account × ticker × asset class × currency |
| `Transakcje` | yes | Transaction ledger, the only real input |
| `Arkusz techniczny` | yes | Currency list, price/FX cache, manual prices, dividends-per-year matrix |
| `Obligacje` | yes | Polish retail savings bonds calculator |
| `Multi-asset` | yes | Look-through of multi-asset funds into asset classes |
| `Benchmarki` | yes | Portfolio vs CPI and market benchmarks (beta) |
| `Sprzedaż Podsumowanie` | yes | Closed positions, per FIFO buy/sell pair |
| `Historia` | hidden | Daily snapshot |
| `Historia - podsumowanie` | hidden | Month-end roll-up of `Historia` |
| `Inflacja` | hidden | GUS CPI data |
| `Benchmarki Dane`, `Benchmarki Obliczenia` | hidden | Benchmark price/FX history and day-by-day simulation |

## 1. Transaction ledger (`Transakcje`)

Columns: account, date, ticker, currency, name, asset class, transaction type, quantity, price, commission (always PLN), FX rate to PLN, nominal price, total PLN, comment.

- **Transaction types:** `Wpłata środków` (deposit), `Zakup` (buy), `Sprzedaż` (sell), `Dywidenda / Odsetki` (dividend/interest), `Split`, `Wypłata środków` (withdrawal), `Koszty` (costs). The formulas also accept `Odsetki` and `Adjustment`; the FIFO script also accepts `DRIP` (a buy).
- **Asset classes (12):** cash, Polish equities, foreign equities, Polish government bonds, foreign government bonds, Polish corporate bonds, foreign corporate bonds, metals and commodities, crypto, currencies, other, multi-asset.
- **Special tickers:** `Gotówka` = PLN cash; `Waluty_<CCY>` (class `Waluty`) = foreign-currency cash held as a position, e.g. `Waluty_USD`.
- **Split:** the quantity column holds the ratio `X:Y` (e.g. `2:1`).
- **Total PLN** (computed by the form): buy = qty × price × FX + commission; sell = qty × price × FX − commission; deposit, withdrawal, dividend, costs = amount × FX.
- **Validation:** dropdowns for type and class; date check; red highlight for a zero or blank quantity or price, a missing total, or a missing nominal price. Any error switches the Dashboard greeting to an error banner.
- **Housekeeping (daily):** sorted by date, then type (buys before sells on the same day); spaces stripped from tickers; user filters preserved.

## 2. Adding transactions (form)

The "Add transaction" sidebar is the normal way to enter data. Beyond the ledger columns it provides:

- **Transfer between accounts:** one entry creates a withdrawal on account A and a deposit on account B.
- **Pick from holdings:** sell, split and dividend choose the account and ticker from existing positions.
- **Ticker normalisation:** broker formats are converted to Google Finance format: XTB `SYMBOL.PL` → `WSE:SYMBOL` (≈20 country suffixes), FT `SYMBOL:LSE:GBX` → `LON:SYMBOL`. An FT ticker whose currency differs from the form's currency is rejected (GBX/GBP treated as equal). The conversion is noted in the comment.
- **Instrument name:** looked up on markets.ft.com, then analizy.pl (Polish funds), else the ticker. Needed only on the first transaction of an asset.
- **FX rate:** left empty → NBP table A mid rate of the last business day before the transaction date (looks back 5 days).
- **Commission in another currency:** own currency and FX rate (or NBP D-1), converted to PLN; original amount and rate written to the comment.
- **Dividend tax:** gross amount and withheld tax; the net amount is stored and the tax noted in the comment.
- **Paying from foreign-currency cash** ("Środki finansowe: Waluty"): deposits, sales and dividends also add a buy of `Waluty_<CCY>`; withdrawals, buys and costs add a sell of it. Foreign cash is therefore tracked as a currency position.
- **Automatic deposit:** optional deposit of the same amount alongside a buy (for accounts where you don't record deposits separately).
- **Catalyst bonds** (government or corporate): ask for the nominal price.
- **Multi-asset:** buying an unconfigured multi-asset fund opens the multi-asset form next.

## 3. Holdings (`Portfolio`)

*Rebuilt by `przeliczPortfolio` (menu or daily):*

- Replays buys, sells, splits, DRIP and deposits in date order (same day: split → buy → sell) as **FIFO lots** per account × ticker × asset class × currency.
- Selling more than is held stops the run with an error naming the account and ticker.
- For each open position: quantity, average price of the remaining lots (in instrument currency; for corporate and Catalyst bonds in % of nominal), cost in PLN of the remaining lots, average FX rate.
- Rows sorted by account, cash first, then by value; empty cash rows removed.

*Calculated by formulas per row:*

| Field | How |
|---|---|
| Current FX rate | From the FX table in `Arkusz techniczny` |
| Current price | GOOGLEFINANCE; FRA:/LON: tickers and bonds come from the price cache; fallback to average buy price. Polish equities get a `WSE:` prefix. Currency positions = 1 |
| Daily change % and PLN | GOOGLEFINANCE `changepct` / `change`, else the cache; GBX (pence) divided by 100 |
| Current value PLN | `quantity × price / 100 × nominal × FX`, plus `quantity × accrued interest` for Polish bonds. Nominal from the cache, else the transaction, else 100 |
| Return | % in instrument currency, % in PLN, P/L PLN (vs FIFO cost) |
| Cash row | deposits + sales + dividends − buys − costs − withdrawals, per account |

## 4. Prices and FX (`Arkusz techniczny`)

*Refresh script (`runKursy`, daily after the holdings rebuild, or after a manual rebuild):*

- Quotes every ticker currently in `Portfolio` (currency positions excluded) and rewrites the cache: ticker, update timestamp, price, corporate accrued interest (`Odsetki Korpo`), change, % change, nominal. Then one row per held foreign currency with its rate.
- **Time budget** (Apps Script stops a run at 6 minutes): a 4.5-minute budget. Catalyst pages are fetched only within the first half of it, and quoting starts only within the first 90 %; tickers not quoted keep their last price. (The check inside the quote loop only returns from the `forEach` callback, so it doesn't actually stop the loop.)
- **No quote:** the previous price and its timestamp are kept (so the row turns stale); a ticker never quoted falls back to the manual-price table.

Source chain per asset class (first one that returns a number wins):

| Asset | Sources, in order |
|---|---|
| Polish retail bonds (EDO, COI, ROS, ROD, TOS) | Price per bond from `Obligacje` (formula) |
| Polish equities | bossa.pl quote JSON (one request per category: shares, NewConnect) → biznesradar.pl all-stocks pages (GPW, NewConnect) → Yahoo → Google Finance → biznesradar.pl ticker page → analizy.pl / bankier.pl (fund-like IDs) |
| Corporate bonds and Catalyst-listed treasury bonds | bossa.pl quote JSON (bonds category) → gpwcatalyst.pl quote pages (corporate and treasury, GPW market only; price = last, change vs reference) → biznesradar.pl → analizy.pl |
| Crypto (`BTC/PLN`) | Yahoo (`BTC-PLN`) → Google Finance → FT → biznesradar.pl (`BTCPLN.BTB`) |
| Everything else (ETFs, foreign shares, metals, funds) | bossa.pl (Polish ETFs) → FT for `EXCHANGE:SYMBOL` outside WSE → Yahoo → biznesradar.pl (Polish ETFs, ETNs, `.TFI` funds) → analizy.pl → bankier.pl |
| Currencies | Yahoo `CCYPLN=X` |

- **Catalyst accrued interest and nominal:** for bonds whose transactions carry a nominal > 1, read from the gpwcatalyst.pl list of all listed instruments (`o-instrumentach-instrumenty-notowane`); fallback: an `IMPORTXML` formula on the bond's own page.
- **IZ bonds:** when the nominal reads 1000, the indexed nominal comes from the Ministry of Finance indexation page (`obligacje_IZ.gs`: ratio × 1000; also gives accrued interest).
- **Ticker translation:** Google Finance style `EXCHANGE:SYMBOL` is mapped to each source: Yahoo suffixes (`WSE`→`.WA`, `LON`→`.L`, `AMS`→`.AS`, `FRA`→`.DE` …; gold/silver aliases → `GC=F`/`SI=F`), FT exchange codes (`LON`→`LSE` with GBX, `FRA`→`GER`, `AMS`→`AEX` …), `WSE:` dropped for Polish sites.
- **Pence:** GBX/GBp quotes are divided by 100.
- **Scraping hygiene:** biznesradar.pl is switched off for the rest of the run after 3 failures; a 0.5 s pause before each FT request; each source can be disabled by a flag.
- **Names** for new instruments (transaction form): FT, then analizy.pl.

*Formulas:*

- **Currency list** (column A) drives the form's currency dropdown; adding a currency = adding a row.
- **FX** USD/EUR/GBP/CHF → PLN: cached rate if updated since yesterday, else GOOGLEFINANCE `CURRENCY:XXXPLN`, else the last cached rate.
- **Manual prices** (ticker, date, price) for assets with no feed, e.g. a property fund.
- **Retail bonds** take their price from `Obligacje`.
- **Dividends matrix:** dividends and interest per year × account, for a Dashboard chart.

## 5. Polish retail savings bonds (`Obligacje`)

**Buying (bond form):** type (EDO, COI, ROS, ROD, TOS), purchase date, number of bonds, year-1 rate, margin (TOS: one fixed rate), "bought at discount" (rollover of maturing bonds).

- **"Fetch rate" button:** derives the series from type and date (e.g. EDO bought 2026-09 → `EDO0936`) and reads year-1 rate and margin from the Ministry of Finance retail-bond file (gov.pl `obligacje-detaliczne1`, XLS, one tab per type).
- Ticker = `TYPE-DDMMYY` of the maturity date (e.g. `EDO-140936`); price 100 PLN, or the series' rollover price (`cena zamiany`, default 99.90) with the discount flag.
- Writes the bond row and a buy transaction; optionally a cash deposit of an amount you enter.
- **March series** warning: their year-2+ rates use the preliminary January CPI and need a manual correction later.

**Calculation (formulas generated per row):**

- **Rate for year N ≥ 2** = max(CPI y/y of the month two months before year N starts, 0) + margin. CPI = GUS "same month of the previous year = 100". ROS/ROD/EDO/COI only.
- **Value:** within each interest year interest accrues linearly by days. EDO, ROS, ROD capitalise (year N starts from year N−1's value); COI restarts from nominal each year (interest paid out).
- **TOS:** fixed rate, 3 years, compounding yearly, linear within the year.
- **COI interest paid:** sum over completed years of 81 % (after 19 % tax) of that year's interest.
- **Outputs:** current value, total profit and %, active flag (term per type: TOS 3, COI 4, ROS 6, EDO 10, ROD 12 years), price per bond (fed to the price cache), current-year rate; weighted average current rate across all bonds.

**Selling (bond sell form):** account, series, date, number of bonds, early-redemption fee, net amount received. Price per bond is derived from amount + fee; the row's count is reduced; the row is optionally deleted when all are sold.

**Keeping rates right:**

- **Check (daily, in the issue checker):** compares every row's rates with the Ministry file. On a mismatch it first refreshes CPI from GUS and compares again; remaining differences are reported on the Dashboard.
- **Update:** replaces the formula rates of past years with the Ministry's published values, and the rollover price in the purchase-value formula.
- **Repair ("Zweryfikuj i zaktualizuj zakładkę Obligacje"):** reloads base data, fixes year-1 rate and margin from the Ministry file, regenerates all formulas, applies published rates, and freezes matured bonds (formulas → values).

## 6. Dashboard

**Summary:** net deposits, account value, open positions, cash, unrealised P/L, realised P/L, dividends received, commissions and costs, XIRR (deposit and withdrawal cash flows + current value today).

**Currencies:** value in PLN vs other currencies.

**Allocation by asset class:** value, % share, target %, target amount, amount above/below target (rebalancing). Multi-asset funds are spread across classes using `Multi-asset`.

**Per-account table:** net deposits, value, open positions, cash, unrealised P/L, realised P/L, XIRR, dividends, costs. A per-account flag includes or excludes currency positions from P/L. XIRR handles closed accounts (ends at the last withdrawal).

**Status cells:** greeting / error banner for invalid transactions; "Errors found!" cell with the issue checker's details as a note; version cell turns red when inwestomat.eu publishes a newer version.

**Charts:**

| Chart | Data |
|---|---|
| Dividends/interest per year, by account | `Arkusz techniczny` matrix |
| Currencies in portfolio (doughnut) | PLN vs other |
| Asset share over time (stacked) | `Historia - podsumowanie` |
| Per-account bars | Value vs positions/cash |
| Allocation bars | Share per asset class |
| Account value vs net deposits | `Historia` |
| Profit/loss over time | `Historia` |
| XIRR over time | `Historia` |
| Portfolio drawdown | `Historia` |

## 7. History (`Historia`, `Historia - podsumowanie`)

- **Daily row** (`copyDailyValue`), since 2022-08-08: value per asset class (from the Dashboard allocation, so multi-asset funds are split), total value, net deposits; then formulas: XIRR of deposits/withdrawals up to that date plus that day's value, P/L = value − net deposits, drawdown = value / highest value so far − 1.
- **Guard:** the row is **not** written if any holding has an FX error or a value of 0, or any total isn't a number.
- **Month-end roll-up** (`copyLastDaysOfPeriod(1)`): last row of each month (also supports 3-, 6-, 12-month periods).

## 8. Automation

| Trigger | When | What |
|---|---|---|
| `masterDaily` | Daily, random hour 17:00–21:00 | Four one-off steps 7 minutes apart: rebuild holdings → refresh prices → history row + month-end roll-up → version check + sort transactions |
| `historiaBackup` | Daily, 2 hours later | If today's history row is missing, runs `masterDaily` again |
| `inflacja` | Weekly, random day and hour | Downloads the GUS monthly CPI CSV (all bases, since 1982) into `Inflacja` |
| Issue checker | ~1 minute after each holdings rebuild | See below |

**Issue checker** (result shown on the Dashboard):

- multi-asset funds bought but not configured;
- a ticker held in more than one currency;
- missing formulas in `Portfolio`;
- retail-bond rates that differ from the Ministry of Finance file.

## 9. Multi-asset look-through (`Multi-asset`)

Per fund ticker: % split across the asset classes (e.g. V80A = 80% foreign equities, 12.2% foreign government bonds, 7.8% foreign corporate bonds), a check that the split sums to 100, and the resulting PLN amount per class. If the split is invalid, the whole value goes to "other". A sidebar form lists the unconfigured multi-asset tickers and takes the split.

## 10. Benchmarks (`Benchmarki`, beta)

What the portfolio would be worth if every deposit and withdrawal had gone into a benchmark instead.

- **Benchmarks:** CPI plus up to 5 tickers configured in the script (default LON:ACWI GBP, LON:CSPX USD, AMS:V80A EUR, WSE:WIG PLN, WSE:SWIG80TR PLN).
- **Data:** daily close history of each ticker and daily FX from GOOGLEFINANCE, from the first deposit.
- **Cleaning:** a day-to-day jump over 50 % is treated as an error: ×100 or ÷100 when it looks like a pence/pound mix-up, else the previous price is kept. Missing days carry the last price and rate forward.
- **Simulation, day by day up to yesterday:** each day's net deposits buy units at that day's PLN price. Before a ticker's history starts, the money waits as cash and is invested on its first day.
- **CPI benchmark:** monthly CPI (previous month = 100) converted to a daily rate (geometric), compounded on the running balance.
- **Table:** current value, portfolio − benchmark in PLN and %, "show on chart" toggle (re-draws the chart on edit). Line chart from the first `Historia` day.
- Last-update date highlighted green (< 5 days), amber (5–14), red (> 14).

## 11. Closed positions (`Sprzedaż Podsumowanie`)

One row per FIFO buy/sell pair: ticker, name, class, account, currency; buy date, price, commission, FX; sell date, price, commission, FX; quantity; cost PLN, proceeds PLN, P/L PLN, return %, days held; dividends/interest received; P/L and return including dividends.

- **Splits** adjust earlier buys' quantity, price and commission.
- **Commissions** are split pro rata across pairs; the last pair of a sale takes the rounding remainder.
- **Dividends** go to a pair by its share of the holding on the payment date: those paid between buy and sale, plus one paid after the sale if no new buy happened in between (late payment).
- Currency positions (`Waluty`) are excluded. Generated on demand from the menu.

## 12. Inflation data (`Inflacja`)

GUS monthly CPI CSV (stat.gov.pl, Poland, since 1982) in five bases: previous month = 100, same month of the previous year = 100, December of the previous year = 100, same cumulative period of the previous year = 100, previous year = 100. Retail bonds use the y/y series; the CPI benchmark uses the m/m series.

## 13. Other

- **Migration** from a previous version of the sheet: copies transactions (with column remapping by version), history, bonds (then runs the repair), allocation targets and per-account flags, multi-asset splits, currencies and manual prices; creates the triggers; rebuilds holdings.
- **Backup:** `kopiaZapasowa` copies the whole file with a timestamp (manual).
- **Version check:** reads the current version from the inwestomat.eu article.

## Mapping to this app

| Sheet feature | App |
|---|---|
| Transaction ledger | Transactions import (phase 1); form later |
| Holdings (FIFO), valuation, accrued interest | Valuation job + holdings table (phase 1, bonds) |
| Prices: bossa.pl, gpwcatalyst.pl, biznesradar.pl, Yahoo, FT, Google Finance, analizy.pl, bankier.pl | GPW/Catalyst (phase 1), EODHD (phase 2), IBKR Flex (phase 3). The sheet's bossa.pl quote JSON and the Catalyst instruments list are candidates worth checking (data-sources.md) |
| Catalyst accrued interest and nominal (scraped) | Computed from bond terms (accrued interest); the Catalyst list is a cross-check |
| FX: Yahoo live, NBP D-1 for transactions | NBP (phase 3) |
| IZ indexation | Computed from the MF calculator + CPI; the MF page is a cross-check (data-sources.md) |
| Retail bonds (`Obligacje`) | `core/bonds/retail.ts`, not wired in yet; the Ministry's retail-bond rates file is a candidate source for rates and rollover prices |
| `Inflacja` | Monthly GUS job (the same CSV; previous month = 100 only) |
| Daily `Historia` snapshot | Daily snapshots in the `holdings` table; the sheet's "don't record a broken day" guard matches the data quality rules |
| Manual prices | Manually valued assets |
| Done since (road map in ../README.md) | Transaction form, target allocation and rebalancing (the Dashboard's asset mix, 2026-10-18), XIRR (total and per account), drawdown, realised gain per closed position, the list of sales (FIFO pairs, per sale) with a PIT-38 summary per year |
| Not done yet | Multi-asset look-through, benchmarks, dividends per FIFO pair, dividends per year, issue checker |
