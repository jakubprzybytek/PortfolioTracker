# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Four views, switched from a menu on the left (a top bar on narrow screens).

## Style ("Calm")

Readability first: a light grey page with white panels (tables, cards, charts, allocation), 15 px text, secondary text in a darker grey, figures in equal-width digits so columns line up, thousands grouped from 1000 on (8 597,39 zł), uppercase column headers, gains and losses marked ▲ / ▼ as well as green / red, a heavy line above totals. The same in dark mode (follows the system). All in `styles.css` (colours as CSS variables at the top).

Row charts (Holdings, Prices) open in a panel at the bottom: a third of the screen height on a computer, half on a phone; dragging its edge resizes it (remembered per device size).

## Loading

Parts still loading hold their space with placeholders (`Placeholders.tsx`), so the page doesn't jump when data arrives: grey, gently pulsing table rows, Dashboard cards and allocation; for a chart, its outline at its final height (grid lines, a faint rising line, a light sweeping across). An empty chart shows its message at the chart's height.

A chart reloading (another range) stays in place, dimmed with a spinner; its range buttons are disabled meanwhile, the chosen one spinning.

On a phone (≤ 720 px) charts reach the screen edges: the y-axis labels (short: 57k, 1,6M) sit inside the plot, above their grid lines.

## Navigation

A menu with the coin logo and the app's name: a sidebar on a computer; on a phone a slim bar on top whose ☰ button opens the menu over the page (any choice, a tap outside or Escape closes it), with the user and "Log out" at its foot.

Hash routes, so the static site stays one page (no CloudFront rewrites) and every view, including its filters, can be bookmarked:

| Route | View |
|---|---|
| `#/` | Dashboard (default) |
| `#/holdings?group=instrument&account=…&type=…&chart=<ISIN>&chartAccount=…` | Holdings (`group` absent = by account; `chart` = the open row chart) |
| `#/prices?type=…&chart=<ISIN>` | Prices |
| `#/indicators?chart=<id>&range=1Y\|10Y\|ALL` | Indicators (`range` absent = 5 years) |
| `#/transactions?instrument=<ISIN or none>&account=…&type=…` | Transactions |
| `#/notes?note=<id or new>` | Notes (`note` = the open note; `new` = writing one) |

Changing a filter replaces the history entry, so "back" goes to the previous view, not the previous filter. Filter dropdowns have a fixed width (no jump when their options load); on a phone they share one row with the "clear filters" button (a funnel with ✕, so it isn't taken for a refresh; Transactions: the instrument on a row of its own), the label shown inside the dropdown while nothing is picked, the count below. No router library: `packages/web/src/route.ts`.

"Asset type" is the instrument type (`BOND_LISTED` → "Listed bond", `BOND_RETAIL`, `ETF`, `BOND_IBKR`, `FUND_MANUAL`, `CASH`); transactions without an instrument (deposits, fees) count as "Cash". The reference sheet's 12 asset classes aren't modelled yet.

## Dashboard

- **Totals:** total (positions + cash), cash (only accounts whose assets are all tracked; the card says how many it leaves out), net deposits (money put in − taken out), profit (total − net deposits; also as % of net deposits), XIRR (money-weighted annual return of all deposits and withdrawals plus today's total, as the Accounts table's total row; the card says since when).
- **Profit breakdown** (`GET /accounts`, `core/valuation/accounts.ts`): unrealised gain (open positions: value − FIFO cost), realised gain (sales, redemptions and write-offs: proceeds − FIFO cost of the units sold; a write-off's proceeds are 0, PLN at NBP D-1, as for tax), income (dividends, coupons, interest), fees and taxes outside trades (account fees, taxes, exchange fees; trade commissions are in the cost and proceeds), and "currency and other", the rest (exchange-rate effects on cash, a broker's spread, positions without a price), so the five add up to the profit.
- **Asset mix:** one bar split into shares (ETFs), bonds (all bond types, and ETFs with "Bond" in their name, e.g. high-yield bond ETFs), cash (PLN and foreign) and other (manually valued), with each share and amount: positions plus the cash of complete accounts, as in the totals.
- **Portfolio value over time:** positions + cash (fully tracked accounts) as the area, net deposits (money put in − taken out so far, other currencies at NBP D-1) dashed; the gap is the profit. A sale or redemption kept as cash doesn't move the line (before, the chart showed positions only, so the T-bill redemption on 2026-10-01 looked like a drop). Range selector: 1M, 6M, 1Y, all.
- **Drawdown:** how far below its best so far the portfolio was each day (%), as the sheet's `Historia` drawdown, but on the time-weighted return (`drawdowns`, `core/valuation/history.ts`): a day's return is (total − money put in that day) / the day before's total, so deposits and withdrawals are neither a gain nor a loss. The best counts from the start of the range shown (ALL: since the first deposit). Shares the portfolio chart's range.
- **Allocation over time:** shares, bonds, cash and other (as the asset mix: bond ETFs are bonds) as % of positions + cash each day, stacked to 100 %; the tooltip adds the amounts. Same range.
- **Accounts** (`GET /accounts`): per account net deposits (deposits − withdrawals; transfers between your accounts count on both sides), cash, total (positions + cash; the split and the profit, total − net deposits, in its tooltip), **XIRR** (money-weighted annual return of the deposits and withdrawals plus today's total, `core/valuation/accounts.ts`), unrealised and realised gain (as in the profit breakdown), income (coupons, interest, dividends) and costs (commissions, fees, taxes). Money in other currencies counts at the NBP rate of the day before each transaction. An account with its own currency (IBKR: EUR) has a second line in it ("└ in EUR"): net deposits (in EUR as made, the rest converted), total (today's rate), profit, XIRR. Incomplete accounts are greyed and left out of the total row. **Closed** accounts (no positions, no cash left) come last, folded into one greyed row "▸ n closed accounts" that expands them (with the date they were emptied); their profit stays in the total.
- **Allocation:** bars by asset type and by currency (positions of all accounts + cash of the complete ones, as in the totals), share and amount (on a phone the amount is in the row tooltip). Foreign cash counts as Cash.
- **Jobs:** last run of each job; failed jobs also appear as a banner.

## Holdings

From the latest snapshot (`SNAP#LATEST`), one row per account and instrument. **Group by** switches between two layouts (kept in the URL):

- **Account** (default): described below.
- **Instrument:** one row per instrument (by code), the second column showing the account it's held in. An instrument held in several accounts shows "▸ n accounts" with its total quantity and summed value/cost/gain/coupons; the arrow expands it into one row per account (the row itself opens the all-accounts chart). Cash comes after the instruments: complete accounts summed, "▸ n accounts" expands it (incomplete ones greyed, not summed); then the foreign cash (EUR, USD). The filters apply the same way.

- **Grouped by account** (alphabetically); each account's header row stands out (tinted, bold, a coloured bar on the left and a line above) so the accounts are easy to tell apart, and shows the account's value (positions + cash), cost, gain, gain % and coupons. Each account ends with its **Cash**: one row, or for an account holding several currencies one per currency ("Cash EUR": the amount, the NBP rate, its PLN value), its own currency first. A position bought in another currency shows its cost in PLN (NBP D-1) and, in the tooltip, as paid ("963,25 EUR"). Old PLN-only bookings of foreign cash ("EUR cash" positions) show next to the cash. The "Cash" asset-type filter shows all of it. Accounts holding only cash appear too. Rows keep one line: long instrument names are cut with "…" (full name in the tooltip). A total row appears when more than one account is shown.
- **Incomplete accounts** (some of their assets aren't tracked yet, e.g. Catalyst bonds): the group row says what's missing, and the cash row is greyed and left out of the sums, because without the untracked purchases it's far too high.
- **Instruments sorted by code** within each account.
- **Columns:** instrument (code + name), asset type, quantity, price (bonds: clean, % of nominal; ETFs: in their currency, e.g. "167,70 EUR"; price date and the NBP rate used on hover), accrued interest per bond (listed and Catalyst bonds: to the settlement day, T+2, as the exchange quotes it), value (PLN), cost (PLN, as paid), gain (PLN, %), coupons/dividends received.
- **Filters:** account, asset type ("Cash" shows only the cash rows), **instrument** (free text: instruments whose name or code contains it, case and Polish accents ignored; no cash rows then; `?q=`); "clear filters" (funnel ✕) clears them; "n of m holdings".
- **Show closed** (a toggle button by the filters, off by default; one switch for Holdings and Prices, kept while the app is open, reset by a page reload; "clear filters" leaves it): adds the positions sold, redeemed or written off in full, greyed, under a "Closed · n" row with their summed cost, realised gain and coupons. By account they come last in their account (an account with only closed positions gets a group of its own); by instrument, at the end with their account. Columns: the units disposed of, "closed YYYY-MM-DD" (the last disposal) in the price column, no value, cost of the units (FIFO, fees included), **realised gain** = what they brought in − that cost (a write-off: the whole cost lost), coupons received. Not in any sum or the total. The filters apply to them; "n of m holdings + k closed". A closed row's chart ranges (1M/6M/1Y/ALL) count back from the day it closed; ALL is the whole time it was held.
- **Row chart:** clicking a holding row shows that position's value and cost over time (range 1M/6M/1Y/ALL); grouped by instrument, the group row shows the instrument across all accounts. The chart is a panel docked to the bottom of the window (1/3 of its height by default) while the list stays visible and scrolls above it; its top edge is a drag handle (size remembered in the browser); ✕ or Escape closes it. Cash rows have no chart.
- **Transactions** (a toggle button in the chart panel, "Transactions (n)", collapsed by default and left open from one row to the next while the view is shown): the position's transactions next to its chart (on phones in its place, without the price column), newest first, scrolling on their own: date, type, quantity, price, amount (price, note and fee on hover); on the all-accounts chart every account's, with an account column.
- **Corporate bonds** (Catalyst): clean price, % of nominal, plus accrued interest from the bond's coupon periods. Without a rate for the current period the accrued column shows a red "no rate" tag (tooltip: which period) and the value is the clean price only.
- **Coupon periods** (corporate bonds, Prices and Holdings): "Coupon periods" in the chart panel swaps the chart for the bond's periods, newest first (later future periods folded): first day ("now" on the current one), end, record day, payment day, rate and who set it ("yours", "obligacje.pl", "from coupons"; "no rate" in red), coupon per bond, and your coupons for that period before tax with the number of bonds (red with the expected amount when they don't fit the rate). Actions per period: "Use 7,14 % (your coupons)" when the period has no rate (or a coupon contradicts it), "⚠ obligacje.pl shows …: use it" when the site differs, Edit (dates and the rate in %) and ✕ (a second click deletes). "Add a period" below. Every change revalues from the period's start (a toast, then "Recalculating the valuation…").
- **Manually valued** assets (e.g. a property fund share) show their latest value entered by hand; in the Prices view it's tagged "manual" and never marked stale. **"Edit values"** in the asset's chart panel (Prices and Holdings) opens a form to add a value per unit on a date (today by default, not in the future); below the form, the values so far, newest first, each with ✕ to delete (a second click confirms). The valuation reruns from that date; meanwhile "Recalculating the valuation…" shows in the corner (after any save: transactions too) until the run finishes, then every view reloads ("Valuation updated.").

## Prices

Kept deliberately short (a passive portfolio needs no daily statistics): what each held instrument is worth per unit, and whether that price is current.

- **One row per held instrument** (latest snapshot), sorted by code. **Filters:** asset type, instrument (free text in the name or code, as in Holdings) ("clear filters", "n of m instruments"), kept in the URL.
- **Show closed** (the same switch as in Holdings): also the instruments traded but held in no account now, greyed, after the held ones (by code): their last price and its date with a "closed YYYY-MM-DD" tag (the last transaction), never "stale"; 1 year = the year up to that last price. Their chart ranges count back from a month after the last transaction (ALL: from a month before the first), with the transactions as markers.
- **Columns:** instrument (code + name), type, price (bonds: clean, % of nominal; others: in their currency), price date (grey with a "stale" tag when older than a week), **1 year**: change since the price on or before the same day a year earlier (hover shows that price and date; "–" without a year of history).
- **Foreign bonds at IBKR:** Börse Stuttgart closes (% of nominal); US T-bills calculated (the chart title says which), see data-sources.md. Currencies held (EUR/USD cash) aren't listed: their rates are in Indicators.
- **Retail bonds** aren't traded: price = this year's interest rate ("5,00 % p.a."), date = "calculated", 1 year = the previous year's rate. Their chart shows the calculated value per bond of your lots (PLN, nominal 100, so it reads like % of nominal), from the first purchase; each new interest year changes the slope.
- **Click a row:** its price chart opens in the panel docked to the bottom, as in Holdings (resizable by its top edge, size shared with Holdings; ✕, Escape or a second click closes it): range selector, transactions as markers; ETFs in their currency on today's share basis; inflation-linked (IZ) bonds also show their indexed nominal per bond (PLN, 1000 × the MF index ratio) as a dashed line on a right-hand axis. The open chart is in the URL (`?chart=<ISIN>`) and stays open while filtering.

## Indicators

Economic indicators from data already stored (no extra source), same layout as Prices.

- **Groups:** *Inflation*: month on month (CPI, previous month = 100, from `CPI_REF.wr`) and the CPI reference index (`CPI_REF.w`, June 2003 = 100, the index behind IZ indexation). *Exchange rates*: EUR/PLN and USD/PLN, NBP mid rates (`FX#…`), daily since 2002. Columns: latest value, its date, the value a year earlier. Hover a row for what it is.
- **Click a row:** its chart opens below: monthly bars around zero for the % series, a line for the index and the rates; ranges 1Y / 5Y (default) / 10Y / ALL. Monthly series count back from their latest month (1Y = 12 bars). Chart and range are in the URL.
- **No 12-month inflation:** compounding the one-decimal monthly figures misses GUS's published y/y by up to ~0.3 pp, so that needs GUS's own y/y series (in the CSV the `monthly` job already downloads, not stored yet).

## Transactions

All transactions from `GET /transactions`.

- **Sorted by date, newest first** (fixed).
- **Columns:** date, account, type, instrument (code + name), asset type, quantity, price, amount (signed: red = money out), fee, note.
- **Filters:** instrument (including "(no instrument)" for cash movements), account, asset type; "clear filters"; "n of m transactions".
- **Rows by date:** the rows of one date share a background and the next date has the other one (white and a light grey-blue), so a day's transactions read as a block; the bands follow what the filters show.
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
| `GET /holdings` | `SNAP#LATEST` (holdings per account and instrument); `?closed=1` adds `closed`: the positions held no more, from the transactions (`core/valuation/closed.ts`: realised gain, coupons, first and close dates) |
| `GET /accounts` | `{ date, accounts: AccountSummary[], total }` (latest snapshot + all transactions) |
| `GET /portfolio/history?from&to` | `SNAP#<from>…<to>`: totals per day, plus `total` (positions + cash), `netDeposits` (from the transactions) and `byClass` (value of shares, bonds, cash, other) |
| `GET /instruments` | instruments + backfill status |
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items; retail bonds: the daily calculated value per bond of your lots (`calculated: true`) |
| `GET /instruments/{isin}/transactions` | transactions of that ISIN |
| `GET /prices` | held instruments: latest price + date, stale flag, price a year earlier and the change (`core/valuation/priceRows.ts`); `?closed=1` adds the instruments traded but not held (`closed`: first and last transaction dates; the year up to their last price) |
| `GET /holdings/history?isin&account&from&to` | a position's daily value, cost and quantity (`POS#…` items); without `account`, the instrument summed over the accounts holding it (held nowhere: over the accounts that traded it); days it wasn't held in between (sold out, bought back later) are zero |
| `GET /indicators` | one row per indicator (`core/indicators/indicators.ts`): `[{ id, name, group, unit, frequency, note, latest: { date, value }, yearAgo }]` |
| `GET /indicators/{id}?from&to` | one series, oldest first: `[{ date, value }]` (`cpi-mom`, `cpi-index`: by month; `fx-eur`, `fx-usd`: daily) |
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
| `PUT /instruments/{isin}/coupons/{start}` | changes its dates or rate (`null` clears one); `rateSource: "coupons"` or `"obligacje.pl"` when accepting a suggested rate, otherwise `manual` |
| `DELETE /instruments/{isin}/coupons/{start}` | deletes it |
| `GET /instruments/lookup?code=` | `{ tracked, instrument }`: a tracked instrument, or a treasury series to add (404: unknown) |
| `POST /instruments` | adds one: a full instrument (as in the import file) or `{ kind: "treasury" \| "etf" \| "corporate" \| "manual", … }`; starts its price history; 409 if tracked |

Writes (except notes) queue a revaluation from the earliest date touched.

The UI loads all transactions and filters them in the browser; at a few hundred to a few thousand rows that's one small request.

## Access

Login with Cognito; everything under `/api` needs it. The site's files are public (they hold no data); until you're logged in the app shows its own login form, on the stage's own domain (no redirect to a Cognito page).

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
