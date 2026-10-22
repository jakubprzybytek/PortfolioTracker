# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Four views, switched from a menu on the left (a top bar on narrow screens).

## Style ("Calm")

Readability first: a light grey page with white panels (tables, cards, charts, allocation), 15 px text, secondary text in a darker grey, figures in equal-width digits so columns line up, thousands grouped from 1000 on (8 597,39 zł), uppercase column headers, gains and losses in green / red, a heavy line above totals. The same in dark mode (follows the system). All in `styles.css` (colours as CSS variables at the top).

Row charts (Holdings, Prices) open in a panel at the bottom: a third of the screen height on a computer, half on a phone; dragging its edge resizes it (remembered per device size). Its controls share the title's row, right-aligned, all the same height: the range, Transactions (Holdings), the cog (⚙, the instrument's settings) and ✕; on a phone the title and ✕ stay on top and the controls take the row below. Chart ranges (1M / 6M / 1Y / ALL, here and on the Dashboard, Performance and Indicators) are one segmented control, as "Group by".

## Loading

Parts still loading hold their space with placeholders (`Placeholders.tsx`), so the page doesn't jump when data arrives: grey, gently pulsing table rows, Dashboard cards and allocation; for a chart, its outline at its final height (grid lines, a faint rising line, a light sweeping across). An empty chart shows its message at the chart's height.

A chart reloading (another range) stays in place, dimmed with a spinner; its range buttons are disabled meanwhile, the chosen one spinning.

On a phone (≤ 720 px) the valuation date ("as of …") and "Update prices" (only its icon) sit on the title's row. On a phone (≤ 720 px) charts reach the screen edges: the y-axis labels (short: 57k, 1,6M) sit inside the plot, above their grid lines.

## Navigation

A menu with the coin logo and the app's name: a sidebar on a computer; on a phone a slim bar on top whose ☰ button opens the menu over the page (any choice, a tap outside or Escape closes it), with the user and "Log out" at its foot.

Hash routes, so the static site stays one page (no CloudFront rewrites) and every view, including its filters, can be bookmarked:

| Route | View |
|---|---|
| `#/` | Dashboard (default) |
| `#/performance?range=1M\|6M\|ALL` | Performance (`range` absent = 1 year) |
| `#/holdings?group=instrument&account=…&type=…&chart=<ISIN>&chartAccount=…` | Holdings (`group`: absent = by account, `class`, `instrument`; `chart` = the open row chart) |
| `#/prices?type=…&chart=<ISIN>` | Prices |
| `#/hold-sell?row=<account>#<ISIN>` | Hold or sell (`row` = the open breakdown) |
| `#/sales?year=…&account=…&q=…&sale=<transaction id>` | Sales (`sale` = the one folded out) |
| `#/cash-flows?year=…&account=…` | Cash flows (`year` absent = this year; `account` = the row folded out) |
| `#/indicators?chart=<id>&range=1Y\|10Y\|ALL` | Indicators (`range` absent = 5 years) |
| `#/transactions?account=…&tx=<type>&instrument=<ISIN or none>&type=<asset type>&q=<text>` | Transactions (`tx`: BUY, COUPON …; `q`: the search) |
| `#/notes?note=<id or new>` | Notes (`note` = the open note; `new` = writing one) |
| `#/status` | Status: the jobs (not in the menu; a link next to the app's version and in the failed-jobs banner) |

Changing a filter replaces the history entry, so "back" goes to the previous view, not the previous filter. Filter dropdowns have a fixed width (no jump when their options load); on a phone they share rows of two (Transactions: Account and Asset type, then the instrument on a row of its own, wide enough for its value), the label shown inside the dropdown while nothing is picked, the count below with a "Clear" link (funnel ✕) at its end while any filter is set. On a computer "clear filters" is a button after the filters (a funnel with ✕, so it isn't taken for a refresh). No router library: `packages/web/src/route.ts`.

"Asset type" is the instrument type (`BOND_LISTED` → "Listed bond", `BOND_RETAIL`, `ETF`, `BOND_IBKR`, `FUND_MANUAL`, `CASH`); transactions without an instrument (deposits, fees) count as "Cash". The reference sheet's 12 asset classes aren't modelled; the Dashboard's four (shares, bonds, cash, other) are the instrument's class (Prices, "Class").

## Dashboard

Where things stand now; how it went over time is in Performance, the jobs in Status.

- **Totals:** total (positions + cash), cash (only accounts whose assets are all tracked; the card says how many it leaves out), net deposits (money put in − taken out), profit (total − net deposits; also as % of net deposits), XIRR (money-weighted annual return of all deposits and withdrawals plus today's total, as the Accounts table's total row; the card says since when), and the latest year's return ("2026 so far": time-weighted, with inflation to the last month published and the real return, as Performance's newest row; a click opens Performance).
- **Profit breakdown** (`GET /accounts`, `core/valuation/accounts.ts`): unrealised gain (open positions: value − FIFO cost), realised gain (sales, redemptions and write-offs: proceeds − FIFO cost of the units sold; a write-off's proceeds are 0, PLN at NBP D-1, as for tax), income (dividends, coupons, interest), fees and taxes outside trades (account fees, taxes, exchange fees; trade commissions are in the cost and proceeds), and "currency and other", the rest (exchange-rate effects on cash, a broker's spread, positions without a price), so the five add up to the profit.
- **Asset mix and targets** (`AssetMixPanel`, `Targets.tsx`; `GET /targets`, `core/targets/targets.ts`): one bar split into shares (ETFs), bonds (all bond types, and ETFs with "Bond" in their name, e.g. high-yield bond ETFs), cash (PLN and foreign) and other (manually valued), or the class set by hand for an instrument (Prices, "Class"): positions plus the cash of complete accounts, as in the totals. Without targets the legend gives each class's share and amount on one line, "Set targets" at its end. **Targets**: a share per class (adding up to 100 %) and a band (± pp, how far it may drift), set in the panel (Save, Cancel, Remove targets). With them, a tick on the bar where each class's target ends, and the legend becomes aligned rows, two per line: share, "of 60 %", the difference in pp (red outside the band; the band in its tooltip) and the amount. **Rebalance ▸** under it folds out the calculator (open or closed is remembered in the browser): one switch, **New money** (the default; type the amount: the deposit goes to the classes furthest below their target first, each filled to the same fraction of its target share of the new total, once all are on target the rest by the targets, nothing sold) or **Sell and buy** (every class to its target, the sales paying for the buys); per class the value, the trade and the share after it ("of" the target under it). Before tax and commission. On a phone the legend is one class per line (the amount in its tooltip), the switch and the amount share a row, and the table has three fixed columns (class, the trade in whole złoty with its sign under "Buy zł" / "Trade zł", after), so nothing gets wider than the screen, whatever the font.
- **Portfolio value over time:** positions + cash (fully tracked accounts) as the area, net deposits (money put in − taken out so far, other currencies at NBP D-1) dashed; the gap is the profit. A sale or redemption kept as cash doesn't move the line (before, the chart showed positions only, so the T-bill redemption on 2026-10-01 looked like a drop). Range selector: 1M, 6M, 1Y, all.
- **Accounts** (`GET /accounts`): per account net deposits (deposits − withdrawals; transfers between your accounts count on both sides), cash, total (positions + cash; the split and the profit, total − net deposits, in its tooltip), **XIRR** (money-weighted annual return of the deposits and withdrawals plus today's total, `core/valuation/accounts.ts`), unrealised and realised gain (as in the profit breakdown), income (coupons, interest, dividends) and costs (commissions, fees, taxes). Money in other currencies counts at the NBP rate of the day before each transaction. An account with its own currency (IBKR: EUR) has a second line in it ("└ in EUR"): net deposits (in EUR as made, the rest converted), total (today's rate), profit, XIRR. Incomplete accounts are greyed and left out of the total row. **Closed** accounts (no positions, no cash left) come last, folded into one greyed row "▸ n closed accounts" that expands them (with the date they were emptied); their profit stays in the total.
- **Allocation:** bars by asset type and by currency (positions of all accounts + cash of the complete ones, as in the totals), share and amount (on a phone the amount is in the row tooltip). Foreign cash counts as Cash.
- **Failed jobs:** a banner under the header, with a link to Status.

## Performance

How the portfolio did over time (`PerformanceView.tsx`; until 2026-10-21 on the Dashboard). The range (1M / 6M / 1Y / ALL, in the URL) is in the header and drives the growth of 100 zł, the drawdown and the allocation over time; returns by year always cover the whole history.

- **Returns by year** (`GET /portfolio/years`, `core/valuation/returns.ts`): per calendar year (newest first) the value at the start (the year before's last day) and the end, the money put in (− taken out), the profit (end − start − put in), the **return** (time-weighted: each day's growth, (total − money put in that day) / the day before's total, chained over the year, as the drawdown; so deposits and withdrawals don't count and it compares with inflation and with funds), **inflation** over the same days (CPI December on December for a whole year: GUS's "December of the previous year = 100" figure, so it's GUS's own; where that's missing, compounded from the monthly figures and marked "≈"), the **real** return ((1 + return) / (1 + inflation) − 1) and the **XIRR** (money-weighted: the start value paid in, the year's deposits and withdrawals, the end value out; what the money earned, its timing included). The first year (from the first day) and the year so far are parts of a year, in italics, their return and XIRR over those days (not a year); the year so far compares with CPI to the last month published (a month later: "to 09"). The last row, **All**, is the whole history with its rates a year (geometric; the XIRR equals the XIRR card). Days between month ends get CPI geometrically; after the last month published it stays flat. On a phone three columns: year, return (inflation under it), real.
- **Return and inflation:** per year (oldest first, * a part of a year) a pair of bars, return and inflation, and the real return as a dot (green above 0, red below); the tooltip gives the year's days and the three figures.
- **Growth of 100 zł:** two lines from 100 at the start of the range (the view's): the portfolio's time-weighted return chained day by day (as the drawdown), and what CPI says 100 zł then needs to be to buy as much (dashed). Above the CPI line, the money buys more than it did; the ratio of the two ends is the real return over the range. The key gives both ends in zł.
- **Drawdown:** how far below its best so far the portfolio was each day (%), as the sheet's `Historia` drawdown, but on the time-weighted return (`drawdowns`, `core/valuation/history.ts`): a day's return is (total − money put in that day) / the day before's total, so deposits and withdrawals are neither a gain nor a loss. The best counts from the start of the range shown (ALL: since the first deposit). Follows the view's range.
- **Allocation over time:** shares, bonds, cash and other (as the asset mix: bond ETFs are bonds) as % of positions + cash each day, stacked to 100 %; the tooltip adds the amounts. Follows the view's range.

## Status

The last run of each scheduled job (`GET /status`): when, ok or failed, its note. Opened from the link next to the app's version (the menu's foot) and from the Dashboard's failed-jobs banner.

## Holdings

From the latest snapshot (`SNAP#LATEST`), one row per account and instrument. **Group by** (one segmented control, Account | Class | Instrument, the chosen part filled) switches between three layouts (kept in the URL):

- **Account** (default): described below.
- **Instrument:** one row per instrument (by code), the second column showing the account it's held in. An instrument held in several accounts shows "▸ n accounts" with its total quantity and summed value/cost/gain/coupons; the arrow expands it into one row per account (the row itself opens the all-accounts chart). Cash comes after the instruments: complete accounts summed, "▸ n accounts" expands it (incomplete ones greyed, not summed); then the foreign cash (EUR, USD). The filters apply the same way.
- **Class:** one group per asset class, in the asset mix's order (shares, bonds, cash, other; the class set by hand for an instrument, else the rule), each with its summed value, cost, gain and XIRR; within it the positions by code then account, the second column showing the account. Cash holds every account's cash (one row per account and currency, incomplete ones greyed and not summed) and the foreign cash; it has no XIRR. Closed positions ("Show closed") come last in their class.

- **Grouped by account** (alphabetically); each account's header row stands out (tinted, bold, a coloured bar on the left and a line above) so the accounts are easy to tell apart, and shows the account's value (positions + cash), cost, gain, gain % and coupons. Each account ends with its **Cash**: one row, or for an account holding several currencies one per currency ("Cash EUR": the amount, the NBP rate, its PLN value), its own currency first. A position bought in another currency shows its cost in PLN (NBP D-1) and, in the tooltip, as paid ("963,25 EUR"). Old PLN-only bookings of foreign cash ("EUR cash" positions) show next to the cash. The "Cash" asset-type filter shows all of it. Accounts holding only cash appear too. Rows keep one line: long instrument names are cut with "…" (full name in the tooltip). A total row appears when more than one account is shown.
- **Incomplete accounts** (some of their assets aren't tracked yet, e.g. Catalyst bonds): the group row says what's missing, and the cash row is greyed and left out of the sums, because without the untracked purchases it's far too high.
- **Instruments sorted by code** within each account.
- **Columns:** instrument (code + name), asset type, quantity, price (bonds: clean, % of nominal; ETFs: in their currency, e.g. "167,70 EUR"; price date and the NBP rate used on hover), accrued interest per bond (listed and Catalyst bonds: to the settlement day, T+2, as the exchange quotes it), value (PLN), cost (PLN, as paid), gain (PLN, %), **XIRR**, coupons/dividends received.
- **XIRR** (money-weighted annual return) of the positions only, cash left out: each position's own cash flows (buys with their fees, sales and redemptions net of theirs, coupons, dividends, fees and taxes booked on it; PLN at NBP D-1), plus its value on the valuation day as the last inflow (`GET /holdings` `flows`, `core/valuation/xirr.ts`). A group row (account, instrument in several accounts, class) and the total row take all their positions' flows together, so a filtered total is the XIRR of exactly what's shown. Blank ("–") under 30 days held (an annual rate of a few days says little) and for a position without a value; none for cash and foreign cash. The deposit-based XIRR, with cash (how much idle cash drags it down), is the Dashboard's (Accounts table): the two side by side give each account's cash drag. Closed positions: over the time they were held, ending at the last disposal; written off: −100 %.
- **Filters:** account, asset type ("Cash" shows only the cash rows), **instrument** (free text: instruments whose name or code contains it, case and Polish accents ignored; no cash rows then; `?q=`); "clear filters" (funnel ✕) clears them; "n of m holdings".
- **Show closed** (a toggle button by the filters, off by default; one switch for Holdings and Prices, kept while the app is open, reset by a page reload; "clear filters" leaves it): adds the positions sold, redeemed or written off in full, greyed, under a "Closed · n" row with their summed realised gain and coupons (no cost: money moved from one position to the next, e.g. between fund categories, would count once for each). By account they come last in their account (an account with only closed positions gets a group of its own); by instrument, at the end with their account. Columns: the most units held at once, "closed YYYY-MM-DD" (the last disposal) in the price column, no value, the most cost held at once (FIFO, fees included), **realised gain** = what all the units disposed of brought in − their cost (a write-off: the whole cost lost; sold out and bought back again: every round counts), its % of that largest cost, coupons received. The units disposed of, their proceeds and cost are in the row's tooltip. Not in any sum or the total. The filters apply to them; "n of m holdings + k closed". A closed row's chart ranges (1M/6M/1Y/ALL) count back from the day it closed; ALL is the whole time it was held.
- **Row chart:** clicking a holding row shows that position's value and cost over time (range 1M/6M/1Y/ALL); grouped by instrument, the group row shows the instrument across all accounts. The chart is a panel docked to the bottom of the window (1/3 of its height by default) while the list stays visible and scrolls above it; its top edge is a drag handle (size remembered in the browser); ✕ or Escape closes it. Cash rows have no chart.
- **Transactions** (a toggle button in the chart panel, "Transactions" with the count in a small badge, on screens up to 480 px the menu's Transactions icon instead of the word, collapsed by default and left open from one row to the next while the view is shown): the position's transactions next to its chart (on phones in its place, without the price column), newest first, scrolling on their own: date, type, quantity, price, amount (price, note and fee on hover); on the all-accounts chart every account's, with an account column.
- **Corporate bonds** (Catalyst): clean price, % of nominal, plus accrued interest from the bond's coupon periods. Without a rate for the current period the accrued column shows a red "no rate" tag (tooltip: which period) and the value is the clean price only.
- **Instrument settings:** the cog (⚙) at the right of the chart panel opens the instrument's own view (below, "Instrument"): asset class, values entered by hand, coupon periods. Closed positions too.
- **Manually valued** assets (e.g. a property fund share) show their latest value entered by hand; in the Prices view it's tagged "manual" and never marked stale. New values in the instrument's settings (the cog).

## Prices

Kept deliberately short (a passive portfolio needs no daily statistics): what each held instrument is worth per unit, and whether that price is current.

- **One row per held instrument** (latest snapshot), sorted by code. **Filters:** asset type, class, instrument (free text in the name or code, as in Holdings) ("clear filters", "n of m instruments"), kept in the URL.
- **Show closed** (the same switch as in Holdings): also the instruments traded but held in no account now, greyed, after the held ones (by code): their last price and its date with a "closed YYYY-MM-DD" tag (the last transaction), never "stale"; 1 year = the year up to that last price. Their chart ranges count back from a month after the last transaction (ALL: from a month before the first), with the transactions as markers.
- **Columns:** instrument (code + name), type, **class** (shares, bonds, cash, other: by the rule, or with a "set" tag when set by hand), price (bonds: clean, % of nominal; others: in their currency), price date (grey with a "stale" tag when older than a week), **1 year**: change since the price on or before the same day a year earlier (hover shows that price and date; "–" without a year of history).
- **Foreign bonds at IBKR:** Börse Stuttgart closes (% of nominal); US T-bills calculated (the chart title says which), see data-sources.md. Currencies held (EUR/USD cash) aren't listed: their rates are in Indicators.
- **Retail bonds** aren't traded: price = this year's interest rate ("5,00 % p.a."), date = "calculated", 1 year = the previous year's rate. Their chart shows the calculated value per bond of your lots (PLN, nominal 100, so it reads like % of nominal), from the first purchase; each new interest year changes the slope.
- **Click a row:** its price chart opens in the panel docked to the bottom, as in Holdings (resizable by its top edge, size shared with Holdings; ✕, Escape or a second click closes it): range selector, transactions as markers; ETFs in their currency on today's share basis; inflation-linked (IZ) bonds also show their indexed nominal per bond (PLN, 1000 × the MF index ratio) as a dashed line on a right-hand axis. The open chart is in the URL (`?chart=<ISIN>`) and stays open while filtering.
- **Instrument settings:** the cog (⚙) at the right of the chart panel, as in Holdings.

## Instrument

One instrument's properties in one place, opened by the cog (⚙) in a chart panel (Prices, Holdings), not from the menu: `#/instrument?isin=<ISIN>&from=<view>`. **←** (or the browser's back) returns to the view it came from, with its chart open; opened directly, it goes to Prices. One panel per property, by kind:

- **Instrument:** ISIN, type, currency, where its prices come from, nominal and maturity (bonds).
- **Asset class** (every instrument): the class the Dashboard's asset mix and Performance's allocation over time count it in, a select. The rule's class (by type; an ETF with "bond" in its name = bonds) is marked "(rule)"; another choice sets it by hand (Prices: a "set" tag in the Class column), choosing the rule's again clears it. The instrument's days are revalued ("Recalculating the valuation…"), so the allocation over time follows for its whole history.
- **Values** (assets valued by hand): a form to add a value per unit on a date (today by default, not in the future); below it, the values so far, newest first, each with ✕ to delete (a second click confirms). The valuation reruns from that date; meanwhile "Recalculating the valuation…" shows in the corner (after any save: transactions too) until the run finishes, then every view reloads ("Valuation updated.").
- **Coupon periods** (corporate bonds): the bond's periods, newest first (later future periods folded): first day ("now" on the current one), end, record day, payment day, rate and who set it ("yours", "obligacje.pl", "from coupons"; "no rate" in red), coupon per bond, and your coupons for that period before tax with the number of bonds (red with the expected amount when they don't fit the rate). Actions per period: "Use 7,14 % (your coupons)" when the period has no rate (or a coupon contradicts it), "⚠ obligacje.pl shows …: use it" when the site differs, Edit (dates and the rate in %) and ✕ (a second click deletes). "Add a period" below. Every change revalues from the period's start (a toast, then "Recalculating the valuation…").

## Hold or sell

Is a bond worth more kept to maturity, or sold today with the money put into an alternative until the same day? What was paid doesn't matter: what the bond still pays from today against what a sale brings today, both after tax (19 % on interest and on the gain over FIFO cost; none in IKE/IKZE accounts, recognised by "IKE"/"IKZE" in the name). `core/holdsell/holdSell.ts`.

- **Assumptions** (a panel on top, saved for next time; "Defaults" goes back): **CPI** from now on (IZ indexation past the last published month; EDO, COI after their first year: CPI + margin), **WIBOR** (floating corporate coupons not set yet: WIBOR + the margin in the bond's name), **NBP rate** (ROR, DOR: rate + margin; by default the rate the ROR on offer pays), the **alternative** (the retail bond on offer with the term nearest to the bond's remaining term, or a rate you type, before tax), and a sale's **commission** (blank: each account's own, the median fee of its bond trades; 0,19 % without any). The retail series on offer are listed below with their first-year rates.
- **One row per bond position** (account × bond; most worth selling first): maturity and years left, **sell now** (the net amount today: value − commission − tax due now; retail bonds: early redemption at the Ministry, nominal + interest − its fee: TOS 1 zł, COI 2 zł, EDO 3 zł for series sold from September 2024, earlier 0,70 / 0,70 / 2 zł; ROR 0,50, DOR 0,70; capped by the interest where the Ministry's rules say so), **if held** (the annual yield of giving up that amount for the flows still to come, after tax), the **alternative** and its yield after tax (a retail bond: held to its maturity, or redeemed early at the horizon with its fee), the **difference** at maturity (kept, its payments reinvested at the alternative's yield, − sold and put into the alternative) and the verdict: **hold**, **sell**, or **about the same** (yields within 0,2 % a year).
- **A row opens its breakdown** (`?row=`): the sale today line by line and what it grows to in the alternative; the flows to maturity (coupons, interest, the redemption) with their tax, those resting on an assumption marked *; both sides at maturity; and what the result rests on (the commission, the rates assumed, the currency).
- **By kind:** listed treasury bonds from their terms (IZ: indexed nominal and coupons from the reference index, carried on at the assumed CPI); corporate bonds from their coupon periods (the instrument's settings); retail bonds per lot from the Ministry's rates; IBKR bonds from their name (coupon, maturity) or price path, in their currency at today's rate (against an alternative in PLN, exchange-rate moves aren't counted). Positions that can't be projected (no periods, no price) are listed below the table with the reason.
- **On a phone:** two-line rows instead of the table, the breakdown under the row.
- **Holdings** shows the verdict as a small badge next to a bond row's type ("hold", green; "sell", filled), linking to its row here.

## Sales

Every sale, redemption and write-off (road map 9), from `GET /sales`, in PLN (another currency at NBP D-1, as for tax).

- **PIT-38** panel on top: per year (newest first) the number of sales, proceeds (net of fees), costs (FIFO, the buys' fees included) and profit. It counts sales and redemptions outside IKE/IKZE; not write-offs (no disposal for tax) nor retail bonds (their interest is taxed at source when they're redeemed). Foreign cash isn't a position, so its exchanges are in neither list. Clicking a year filters the list to it. The panel is as wide as its table, the note wrapping under it.
- **List**, newest first: instrument and account, date and kind (sale, redemption, write-off), units, proceeds, cost, gain and its %, days held (one buy) or "n buys". A disposal kept out of PIT-38 has a small tag saying why. Filters: year, account, instrument text; the count and the gain of what's shown; a total row.
- **A row folds out** into the buys FIFO matched it against ("└ bought 2023-03-10"): units, their share of the proceeds (by units; the last takes the rounding remainder), their cost, gain and %, days held. The pairs add up to the sale to the grosz.
- **Phone:** the PIT-38 table in three columns (year with the count under it, proceeds with the costs under them, profit) across the panel; two-line rows (instrument and gain; date, account, kind and units; proceeds for cost), the buys listed under the open one.

## Cash flows

Money paid into and taken out of each account per month of a year (the reference sheet's "Wpłaty/wypłaty <year>" tab), from `GET /cash-flows?year=`, in PLN (another currency at NBP D-1, as net deposits; `core/cashflows/cashFlows.ts`). Transfers between your own accounts count on both sides, as in net deposits.

- **Table:** one row per account with deposits or withdrawals up to the year's end and still in use in it (a transaction in the year or later), by name; the balance (deposits − withdrawals) per month in whole złoty (the exact amount in the tooltip; an empty cell for nothing), the year's in the last column; a "Total" row. A row folds out into "└ deposits" and "└ withdrawals". The year picker lists the years with any deposit or withdrawal.
- **Phone:** two-line rows (account and the year's balance; in and out), "Total" first; the open one lists the months with money in or out.
- **Spreadsheet link:** the same figures as CSV for a spreadsheet (`IMPORTDATA`), so a sheet that used to read the tab with `IMPORTRANGE` reads the app instead. "Create link" makes a token and shows the formula once, with "Copy" (for the year shown; another year: change `year=` in it). After that the panel says when the link was made and last used; "Create new link" replaces it and "Revoke" removes it, each after asking (the spreadsheet using the old link gets nothing from then on). Anyone with the link reads these figures (only these), so the spreadsheet holding it should be shared with care.
- **The CSV** (`GET /feeds/cash-flows.csv?year=&token=`, UTF-8, comma-separated, dot decimals) is laid out as the tab's summary (B1:O11): `Podsumowanie` and the twelve Polish month names; `Bilans wpływów`: every account's balance per month (empty for a month with none) and the year's; then one row per account, its balance per month and the year's. No class columns (the tab's Akcje/Obligacje/Inne/Gotówka split was fixed per account by hand).

## Indicators

Economic indicators from data already stored (no extra source), same layout as Prices.

- **Groups:** *Inflation*: GUS's own figures first, as published: **12 months** (same month of the previous year = 100, `CPI_YOY`: the inflation usually quoted), **per year** (December on December: December's since-December figure, one bar per year; what Performance's returns by year compare with) and **since December** (December of the previous year = 100, `CPI_YTD`: the year so far); then month on month (CPI, previous month = 100, from `CPI_REF.wr`) and the CPI reference index (`CPI_REF.w`, June 2003 = 100, the index behind IZ indexation). *Exchange rates*: EUR/PLN and USD/PLN, NBP mid rates (`FX#…`), daily since 2002. Columns: latest value, its date, the value a year earlier. Hover a row for what it is.
- **Click a row:** its chart opens below: monthly bars around zero for the % series, a line for the index and the rates; ranges 1Y / 5Y (default) / 10Y / ALL. Monthly series count back from their latest month (1Y = 12 bars). Chart and range are in the URL.
- **12 months and per year are GUS's own figures**, not compounded from the one-decimal monthly ones (that misses GUS's y/y by up to ~0.3 pp). Yearly series count back by years (5Y = the last five years) and compare with the year before. GUS's figures are kept from 2000 on (the `monthly` job stores nothing older and deletes what was), so ALL isn't dwarfed by the 1989–90 hyperinflation (640 % a year).

## Transactions

All transactions from `GET /transactions`.

- **Sorted by date, newest first** (fixed).
- **A long history is drawn in steps:** the first 200 rows, then 200 more each time you scroll near the end (a row "n more…" marks it); a filter starts again from the first rows. A page with every row would be very tall and slow to redraw (e.g. resizing a phone emulator).
- **Below 1150 px** (a phone, a narrow window) a list instead of the table, two lines a transaction: date, type · account, amount; then instrument code, quantity × price, fee and the start of the note. A row opens the form.
- **Columns:** date, account (a long name cut with "…"), type, instrument (code + name), asset type, quantity, price, amount (signed: red = money out), fee, note (one line, cut short; all of it on hover, and in the form a row opens, where it's a field of several lines). Instrument and note share what the other columns leave, so the table never gets wider than its box: it doesn't scroll sideways (that would stop the header from sticking). Up to 1250 px fee and note are left out, up to 1440 px asset type; on a wider screen the view grows to 1760 px (the others stay at 1280).
- **Filters:** account, type (buy, coupon …), instrument (including "(no instrument)" for cash movements), asset type and a search (instrument code or name, ISIN, account, type, note; case and Polish accents ignored); "clear filters"; "n of m transactions". All in the URL. On a phone the search and a **Filters** button share one line (the button says how many dropdowns are set, "Filters · 2"); it folds the dropdowns out below (two a row, the instrument on its own). The count and "Clear" are on the line under them.
- **Sticky:** while the list scrolls, the filters stay at the top edge (on a phone under the top bar) and the table's header under them. On a phone the filters fold in for that: two short lines.
- **A row per month** ("October 2026 · 5": the transactions shown that month) above each month's transactions, in the table and the list.
- **Rows by date:** the rows of one date share a background and the next date has the other one (white and a light grey-blue), so a day's transactions read as a block; the bands follow what the filters show. Rows are divided by a line that shows on the tint too (`--band-line`).
- **Update prices** (a cloud with an arrow; until 2026-10-15 "Refresh") is next to the valuation date in the headers of Dashboard, Holdings and Prices: it fetches today's quotes of ETFs, IBKR bonds, Catalyst corporate bonds and listed treasury bonds (ingestion.md, "Live prices") and revalues today. The corner says "Fetching today's prices…", then "Recalculating the valuation…"; when the run is done every view reloads and a message says how many prices changed (or "No new prices" when nothing has traded yet). The button is disabled while it runs (its icon pulses while prices are fetched); a second run within 5 minutes is refused with a message. A bond not traded yet today keeps its last close.
- **How fresh a price is:** in Holdings, in small grey text before the price, the time of a price fetched during the day (e.g. "13:38": the last trade or quote, 15 minutes delayed for Catalyst and Yahoo), or the date of a price older than the newest one shown ("13 Oct"; no trade since, e.g. a corporate bond last traded yesterday; a hand-valued asset's last value). An ordinary close shows nothing extra. The tooltip says the same in words. In Prices, the price date column adds the time and greys an older date.
- **Cached data:** every view keeps what it last loaded (in memory, until the page is reloaded or you log out). Coming back to a view shows that at once and refetches it in the background (`useApi`, SWR); placeholders show only the first time. A view shown again within 2 s of its last fetch doesn't fetch again. After a save, and when a valuation finishes, what's on screen is refetched.
- **Reload** (↻) is in the menu frame under "Add transaction" (on a phone between "+" and ☰): it refetches the current view's data from the API. It doesn't fetch new prices or revalue (that's "Update prices"). Its icon turns while any of the app's requests is under way, so it also says the data shown may be about to change.
- **Add transaction** is in the menu frame, on every view (under the logo; on a phone a "+" next to ☰): it opens the form over the current view, and after saving every view reloads its data. A row here opens the form to edit or delete that transaction (deleting asks to confirm). Saving revalues from the transaction's date (about a minute); a message says so.

### The form (`TransactionForm.tsx`)

- Date, type (buy, sell, coupon, dividend, redemption, write-off, deposit, withdrawal, interest, fee, tax, split), account (or a new one).
- **Instrument** for buys, sells, coupons, dividends, redemptions, write-offs and splits (optional for interest): the tracked ones first, then those no longer held, then **New instrument…**:
  - *Treasury bond by code*: "Find" looks it up (`GET /instruments/lookup`): retail series (EDO1036) from the Ministry file, listed ones (DS1030) from the MF calculator terms; added on save, its terms and prices follow.
  - *ETF*: ticker with exchange (AMS:VWRL, FRA:EUNK, LON:CSPX …), ISIN, name, currency: priced from Yahoo.
  - *Corporate bond*: code, ISIN, name, nominal (1000 or 100): priced from BiznesRadar.
  - *Other asset*: name and code; valued by hand (a buy records its price as the asset's value that day).
  - Foreign bonds at IBKR aren't offered yet: add one with an instrument file (data/README.md, onvista source) before its first trade.
- Quantity and price (bonds: % of nominal; retail: PLN per bond, prefilled 100; ETFs: in their currency), fee.
- **Interest from** (retail treasury bonds, buys only): the day the lot starts earning interest (`valueDate`), which the valuation and Hold or sell count from. It follows the date until changed: it differs when the bonds were issued a day or more after the payment (PKO: 2022-03-15 paid, interest from 03-16) or for a rollover. Editing the row keeps it (before 2026-10-22 an edit reset it to the date). In the Transactions list such a buy has a "*" after its date and "Interest from …" in the tooltip. Other instruments have no such date: listed bonds earn by their coupon periods, whatever the buy date.
- **Currency** of the amount and fee, next to the amount: in an account with its own currency (IBKR: EUR) a trade starts in the instrument's currency and the rest in the account's; elsewhere PLN. Paid in PLN for an instrument in another currency (Bossa): the broker's rate too (prefilled with the NBP rate of the day or the last before).
- **Write-off** (the issuer defaulted, nothing came back): the instrument and the quantity lost, no amount. The units close at 0 and their remaining FIFO cost is a realised loss on that day; cash doesn't move. Money recovered later (e.g. from a bankruptcy estate) is its own transaction.
- **Currency exchange**: what you gave (amount, currency, fee) and what you got (amount, currency); the line below shows both and the rate.
- **Amount** as a positive number (the type gives the direction: buys, fees, taxes, withdrawals take money out). For trades it is suggested from quantity × price (bonds × nominal, foreign × rate; sell: net of the fee) until you type your own: for a bond add the accrued interest, as on the broker's note. A line below shows the account's cash change.
- The server checks it again (`core/transactions/manual.ts`: real dates, an instrument where needed, the direction of the money) and returns the problem, shown in the form.
- From here on transactions are entered in the app (source `app`, random id). Re-importing the spreadsheet would add its newer rows a second time: the history up to the switch came from it, new ones come from the form.

## Notes

Free notes in Markdown (`NotesView.tsx`), e.g. trading checklists. Not linked to the portfolio: saving one doesn't revalue anything.

- **Layout:** the list on the left (title and when it was last changed, the last changed first), the open note on the right, rendered. On a phone the list and the note take turns ("← All notes" goes back).
- **Which note opens:** coming to Notes without a note in the URL opens the one that was open when you last left Notes (kept in memory until the page is reloaded), or else the first one (on a phone: the list instead). The choice replaces the URL, so "back" doesn't bounce.
- **Markdown:** GitHub flavour (`react-markdown` + `remark-gfm`): headings, lists, task lists, tables, links, code, quotes. Raw HTML in a note is shown as text, never run.
- **New note / Edit:** a title (required) and the text, with a live preview next to it (below it on a phone). **Delete** asks to confirm.
- Stored in the `transactions` table (your input) and in the monthly backup (`notes.json`).

## API (Lambda `api`)

| Endpoint | What |
|---|---|
| `GET /holdings` | `SNAP#LATEST` (holdings per account and instrument), and `flows`: each position's own cash flows up to the snapshot's day (`account|isin` → `[date, PLN]` per day, NBP D-1; `core/valuation/xirr.ts`), from the transactions, for the XIRR of any row or group; `?closed=1` adds `closed`: the positions held no more, from the transactions (`core/valuation/closed.ts`: realised gain, coupons, first and close dates) |
| `GET /accounts` | `{ date, accounts: AccountSummary[], total }` (latest snapshot + all transactions) |
| `GET /portfolio/history?from&to` | `SNAP#<from>…<to>`: totals per day, plus `total` (positions + cash), `netDeposits` (from the transactions) and `byClass` (value of shares, bonds, cash, other) |
| `GET /portfolio/years` | `{ years, total, cpi }`: per calendar year (newest first) `from`, `to`, `partial`, `startValue`, `netDeposits`, `endValue`, `profit`, `twr`, `xirr`, `inflation`, `cpiThrough`, `cpiExact`, `real`; `total` the same over the whole history plus `years`, `twrPerYear`, `inflationPerYear`, `realPerYear`; `cpi` the price level per month from the month before the first day (`core/valuation/returns.ts`) |
| `GET /instruments` | instruments + backfill status |
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items; retail bonds: the daily calculated value per bond of your lots (`calculated: true`) |
| `GET /instruments/{isin}/transactions` | transactions of that ISIN |
| `GET /sales` | `sales`: every disposal with its FIFO `pairs` (buy date, units, cost, proceeds, gain, days), `pit` and why not (`notPit`); `years`: the PIT-38 summary (`core/valuation/sales.ts`) |
| `GET /cash-flows?year=` | deposits, withdrawals and their balance per account and month of the year (`core/cashflows/cashFlows.ts`): `accounts`, `total`, `years` (with any), `missingRates` (a foreign-currency flow without an NBP rate), `feed`: the spreadsheet link's `{ createdAt, lastUsedAt }` or `null` |
| `POST /feed-token` | a new spreadsheet-link token, replacing any before it: 201 `{ token, createdAt }`, the only time the token is returned |
| `DELETE /feed-token` | revokes the link |
| `GET /feeds/cash-flows.csv?year=&token=` | **no login** (function `feed`, not `api`): the year's cash flows as CSV (see "Cash flows"); a missing, wrong or revoked token gets a bare 404 |
| `GET /hold-sell` | every bond position kept to maturity vs sold today (`core/holdsell/holdSell.ts`): `rows` (flows, sale today, yields, alternative, difference, verdict, notes), `skipped` (and why), `assumptions` (saved, else `defaults`), the retail `offers` used |
| `GET /targets` | `{ targets }`: `{ targets, bands }` (per class, %), or `null` until set |
| `PUT /targets` | `{ targets: { SHARES, BONDS, CASH, OTHER }, bands: { … } }` (%, the targets adding up to 100) keeps them; `{ reset: true }` removes them |
| `PUT /hold-sell/assumptions` | `{ cpi, wibor, nbpRate, alternative: "retail" \| "rate", altRate?, commission? }` (fractions) keeps them; `{ reset: true }` goes back to the defaults |
| `GET /prices` | held instruments: latest price + date, stale flag, price a year earlier and the change (`core/valuation/priceRows.ts`); `?closed=1` adds the instruments traded but not held (`closed`: first and last transaction dates; the year up to their last price) |
| `GET /holdings/history?isin&account&from&to` | a position's daily value, cost and quantity (`POS#…` items); without `account`, the instrument summed over the accounts holding it (held nowhere: over the accounts that traded it); days it wasn't held in between (sold out, bought back later) are zero |
| `GET /indicators` | one row per indicator (`core/indicators/indicators.ts`): `[{ id, name, group, unit, frequency, note, latest: { date, value }, yearAgo }]` |
| `GET /indicators/{id}?from&to` | one series, oldest first: `[{ date, value }]` (`cpi-yoy`, `cpi-ytd`, `cpi-mom`, `cpi-index`: by month; `cpi-annual`: by year, `date` "YYYY"; `fx-eur`, `fx-usd`: daily) |
| `GET /transactions` | all transactions, newest first, each with `instrument: { code, name, type }` or `null` |
| `GET /status` | last run of each job |
| `GET /notes` | all notes, the last changed first: `[{ id, title, body, createdAt, updatedAt }]` (`body` is Markdown) |
| `POST /notes` | adds one `{ title, body }`; 201 with it, 400 without a title |
| `PUT /notes/{id}` | replaces its title and text (keeps `createdAt`); 404 if there's no such note |
| `DELETE /notes/{id}` | deletes it |
| `POST /transactions` | adds one (body: a transaction as in the import file, without `id`); 201 with it, 400 with the problem |
| `PUT /transactions/{id}?account=` | replaces it (same id; a new date or account moves it) |
| `DELETE /transactions/{id}?account=` | deletes it |
| `GET /instruments/{isin}/coupons` | a corporate bond's periods, oldest first, and the coupons received matched to them: `{ nominal, periods, coupons: [{ start, checks: [{ account, date, amount, gross, quantity, rateRange, expected, mismatch }], suggestedRate }], unmatched }` |
| `POST /instruments/{isin}/coupons` | adds a period `{ start, end, recordDate?, paymentDate, rate? }` (rate as a fraction); 400 when the dates don't fit or it overlaps another |
| `PUT /instruments/{isin}/asset-class` | `{ assetClass }` (`SHARES`, `BONDS`, `CASH`, `OTHER`; the rule's class or `null` clears it): sets the class by hand and revalues the instrument from its first transaction |
| `PUT /instruments/{isin}/coupons/{start}` | changes its dates or rate (`null` clears one); `rateSource: "coupons"` or `"obligacje.pl"` when accepting a suggested rate, otherwise `manual` |
| `DELETE /instruments/{isin}/coupons/{start}` | deletes it |
| `GET /instruments/lookup?code=` | `{ tracked, instrument }`: a tracked instrument, or a treasury series to add (404: unknown) |
| `POST /instruments` | adds one: a full instrument (as in the import file) or `{ kind: "treasury" \| "etf" \| "corporate" \| "manual", … }`; starts its price history; 409 if tracked |

Writes (except notes) queue a revaluation from the earliest date touched.

The UI loads all transactions and filters them in the browser; at a few hundred to a few thousand rows that's one small request.

## Access

Login with Cognito; everything under `/api` needs it, except the spreadsheet feed (`/api/feeds/cash-flows.csv`, below). The site's files are public (they hold no data); until you're logged in the app shows its own login form, on the stage's own domain (no redirect to a Cognito page).

- **User pool:** the existing `AlbedoUserPool` (`eu-west-1_IVai0KEAA`), shared with other apps. SST only references it (`CognitoUserPool.get`) and adds clients; it never changes or deletes the pool. A pool can have only one custom domain, which is why the login isn't a hosted page per stage.
- **Login form** (`packages/web/src/LoginForm.tsx`, Amplify v6 `aws-amplify/auth`): email + password with **SRP** (the password never leaves the browser); a first-login "choose a new password" step for admin-created users; "Forgot password?" emails a code and sets a new password. Wrong email and wrong password give the same message.
- **One client per stage**, `portfolio-tracker-<stage>-web`: no secret, no OAuth/hosted UI; auth flows SRP + refresh token; access/ID token 1 hour, refresh token 30 days. On `int` and `dev` it also allows plain password login (`USER_PASSWORD_AUTH`) for the tests; on `prod` it doesn't.
- **API Gateway** (JWT authorizer) accepts only access tokens of this pool issued to the stage's own client: a missing, expired or forged token gets **401**, and so does a token from another stage or from the other apps' clients.
- **Groups:** the pool allows sign-up, so being able to log in isn't enough. The API Lambda also requires one of the stage's groups in `cognito:groups` and returns **403** otherwise ("This account has no access"):

  | Group | Members | Accepted on |
  |---|---|---|
  | `portfolio-tracker` | real users | `prod`, `int`, `dev` |
  | `portfolio-tracker-test` | the test user | `int`, `dev` only |

  The test user's password is stored in the `int`/`dev` secrets; keeping it out of `portfolio-tracker` means it can log in to the `prod` site but gets no data there. Per-stage groups: `accessGroups()` in `packages/jobs/src/lib/access.ts`. Members are added with the AWS CLI (README, "Login").
- **In the browser:** Amplify keeps the tokens in localStorage and renews them with the refresh token; the view you were on (`#/…`) stays in the URL while the login form shows. A 401 from the API or a failed renewal logs you out locally and shows the form. "Log out" (in the menu) clears the tokens.
- MFA is off in the pool (a pool-wide setting shared with the other apps).

- **The spreadsheet feed** (`GET /feeds/cash-flows.csv`): `IMPORTDATA` can't log in, so this one route has no Cognito authorizer and checks a token of its own (`packages/jobs/src/lib/feedToken.ts`): 32 random bytes made by `POST /feed-token` and shown once; only their SHA-256 is stored (setting `feedToken` with `createdAt`, `lastUsedAt`), compared in constant time. One token at a time: a new one replaces the old at once, `DELETE /feed-token` revokes it. Missing, wrong and revoked tokens get the same bare 404. It serves only the cash-flow totals per account and month. Its function (`handlers/feed.ts`) isn't linked to the tables (a link grants every action): IAM lets it query the transactions' GSI1 and the `FX#…` rates, and get and update only the `SETTING#feedToken` item (to note `lastUsedAt`, at most hourly). The token is never logged; API Gateway's access log has the path without the query string. Every route is throttled at 20 requests/s (burst 40), which bounds what a flood can cost.
