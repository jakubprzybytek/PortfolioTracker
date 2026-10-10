# Reference spreadsheet – feature inventory

The app reproduces the Google Sheets tracker [Portfolio Tracker 2.0.1](https://docs.google.com/spreadsheets/d/1I0QQ6bFOhxdkP8hMazM9DZqmvcZzPvoz7N1ZZnA_VQw) (inwestomat.eu template by Piotrek, version of 2026-07-01) as a cloud app. This document lists what the sheet does, tab by tab, from an analysis of its XLSX export on 2026-10-11.

**Formulas vs Apps Script.** Many tabs hold plain values with no formulas: `Historia`, `Sprzedaż Podsumowanie`, the price cache, and quantity, average price and cost in `Portfolio`. A bound Apps Script fills them; `Benchmarki` refers to `Benchmarki.gs`. Apps Script isn't part of the export, so the features marked *(script)* are inferred from their output and the sheet's own help text. Exact rules (aggregation, lot matching, snapshot timing) need the script source: Extensions → Apps Script.

## Tabs

| Tab | Visible | Role |
|---|---|---|
| `Dashboard` | yes | Summary, allocation vs targets, per-account table, 9 charts |
| `Portfolio` | yes | Holdings: one row per account × ticker |
| `Transakcje` | yes | Transaction ledger, the only real input |
| `Arkusz techniczny` | yes | Price/FX cache, manual prices, dividends-per-year matrix |
| `Obligacje` | yes | Polish retail savings bonds calculator |
| `Multi-asset` | yes | Look-through of multi-asset funds into asset classes |
| `Benchmarki` | yes | Portfolio vs CPI and market benchmarks (beta) |
| `Sprzedaż Podsumowanie` | yes | Closed positions, per sell lot |
| `Historia` | hidden | Daily snapshot |
| `Historia - podsumowanie` | hidden | Month-end roll-up of `Historia` |
| `Inflacja` | hidden | GUS CPI data |
| `Benchmarki Dane`, `Benchmarki Obliczenia` | hidden | Benchmark price data and simulation (filled by the script; empty in the export) |

## 1. Transaction ledger (`Transakcje`)

Columns: account, date, ticker, currency, name, asset class, transaction type, quantity, price, commission, FX rate to PLN, nominal price, total PLN, comment.

- **Transaction types:** `Wpłata środków` (deposit), `Zakup` (buy), `Sprzedaż` (sell), `Dywidenda / Odsetki` (dividend/interest), `Split`, `Wypłata środków` (withdrawal), `Koszty` (costs). The formulas also accept `Odsetki` and `Adjustment`.
- **Asset classes (12):** cash, Polish equities, foreign equities, Polish government bonds, foreign government bonds, Polish corporate bonds, foreign corporate bonds, metals and commodities, crypto, currencies, other, multi-asset.
- **Cash** is a ticker named `Gotówka`; deposits and withdrawals are booked against it.
- **Validation:** dropdowns for type and class; date check; red highlight for a zero or blank quantity or price, a missing total, or a missing nominal price. Any error switches the Dashboard greeting to an error banner.
- **Named ranges:** `TotalPLN`, `TransactionsAction`, `TransactionsPlatform`, `TransactionsDate`, `Prowizje`, `KlasaAktywow`.

## 2. Holdings (`Portfolio`)

One row per account × ticker, plus one cash row per account.

| Field | How |
|---|---|
| Quantity, average buy price, cost PLN, average buy FX rate | *(script)* aggregated from transactions |
| Current FX rate | From the FX table in `Arkusz techniczny` |
| Current price | GOOGLEFINANCE; FRA:/LON: tickers and bonds come from the price cache; fallback to average buy price. Polish equities get a `WSE:` prefix. Currency positions = 1 |
| Daily change % and PLN | GOOGLEFINANCE `changepct` / `change`, else the cache; GBX (pence) divided by 100 |
| Current value PLN | `quantity × price / 100 × nominal × FX`, plus `quantity × accrued interest` for Polish bonds. Nominal comes from the cache, else the transaction, else 100 |
| Return | % in instrument currency, % in PLN, P/L PLN |
| Cash row | deposits + sales + dividends − buys − costs − withdrawals, per account |

## 3. Price and FX cache (`Arkusz techniczny`)

- **Price rows** *(script)*: ticker, update timestamp, price, corporate accrued interest (`Odsetki Korpo`), change, % change, nominal. Rows older than yesterday are highlighted as stale.
- **FX** USD/EUR/GBP/CHF → PLN: cached rate if updated since yesterday, else GOOGLEFINANCE `CURRENCY:XXXPLN`, else the last cached rate.
- **Manual prices** (ticker, date, price) for assets with no feed, e.g. a property fund.
- **Retail bonds** take their "price" from `Obligacje`.
- **Dividends matrix:** dividends and interest per year × account, for a Dashboard chart.

## 4. Polish retail savings bonds (`Obligacje`)

Inputs per series: type (EDO, COI, ROD, TOS, ROS), purchase date, year-1 rate, margin for years 2+, number of bonds, "bought at discount" flag (rollover at 99.90 PLN instead of 100).

- **Rates for years 2–12:** margin + CPI from `Inflacja` (same month of the previous year = 100).
- **Accrual:** pro rata by days within the current interest year; later years are 0 until they start.
- **Capitalising bonds** (EDO, ROD, TOS): each year starts from the previous year's value.
- **COI:** each year restarts from nominal; interest is paid out. Shows interest paid after 19% tax and the current-year value.
- **Outputs:** current value, total profit and %, active flag (term per type: COI 4, ROS 6, EDO 10, ROD 12 years), price per 100 nominal (fed to the price cache), current-year rate.
- Weighted average current rate across all bonds.

## 5. Dashboard

**Summary:** net deposits, account value, open positions, cash, unrealised P/L, realised P/L, dividends received, commissions and costs, XIRR (deposit and withdrawal cash flows + current value today).

**Currencies:** value in PLN vs other currencies.

**Allocation by asset class:** value, % share, target %, target amount, amount above/below target (rebalancing). Multi-asset funds are spread across classes using `Multi-asset`.

**Per-account table:** net deposits, value, open positions, cash, unrealised P/L, realised P/L, XIRR, dividends, costs. A per-account flag includes or excludes currency positions from P/L. XIRR handles closed accounts (ends at the last withdrawal).

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

## 6. History (`Historia`, `Historia - podsumowanie`)

- *(script)* **Daily snapshot** since 2022-08-08 (~1,490 rows): value per asset class, total value, net deposits, XIRR, P/L, drawdown from the running peak.
- **Month-end roll-up** with the same columns.

## 7. Multi-asset look-through (`Multi-asset`)

Per fund ticker: % split across the asset classes (e.g. V80A = 80% foreign equities, 12.2% foreign government bonds, 7.8% foreign corporate bonds), a check that the split sums to 100, and the resulting PLN amount per class. If the split is invalid, the whole value goes to "other".

## 8. Benchmarks (`Benchmarki`, beta)

*(script)* What the portfolio would be worth if every deposit and withdrawal had gone into a benchmark instead.

- Benchmarks: CPI plus up to 5 tickers (default LON:ACWI, LON:CSPX, AMS:V80A, WSE:WIG, WSE:SWIG80TR), each with a currency.
- Assumptions: cash flows invested immediately, no costs; converted to PLN at historical FX; monthly CPI spread evenly over the days.
- Table: current value, portfolio − benchmark in PLN and %, "show on chart" toggle. Line chart from the first `Historia` day.
- Last-update date highlighted green (< 5 days), amber (5–14), red (> 14).

## 9. Closed positions (`Sprzedaż Podsumowanie`)

*(script)* One row per sold lot: ticker, name, class, account, currency; buy date, price, commission, FX; sell date, price, commission, FX; quantity; cost PLN, proceeds PLN, P/L PLN, return %, days held; dividends/interest received; P/L and return including dividends. Lots are probably matched FIFO, but that can't be confirmed without the script.

## 10. Inflation data (`Inflacja`)

GUS BDL CPI export (Poland) in five bases: previous month = 100, same month of the previous year = 100, December of the previous year = 100, same cumulative period of the previous year = 100, previous year = 100. Used by retail bonds and the CPI benchmark.

## Mapping to this app

| Sheet feature | App |
|---|---|
| Transaction ledger | Transactions import (phase 1); form later |
| Holdings, valuation, accrued interest | Valuation job + holdings table (phase 1, bonds) |
| GOOGLEFINANCE prices | GPW/Catalyst (phase 1), EODHD (phase 2), IBKR Flex (phase 3) |
| GOOGLEFINANCE FX | NBP (phase 3) |
| Retail bonds (`Obligacje`) | `core/bonds/retail.ts`, not wired in yet |
| `Inflacja` | Monthly GUS BDL job |
| Daily `Historia` snapshot | Daily snapshots in DynamoDB |
| Manual prices | Manually valued assets |
| Not planned yet | Target allocation and rebalancing, XIRR (total and per account), drawdown, multi-asset look-through, benchmarks, closed-position report, dividends per year |
