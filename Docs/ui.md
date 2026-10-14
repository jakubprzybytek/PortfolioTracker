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

Changing a filter replaces the history entry, so "back" goes to the previous view, not the previous filter. Filter dropdowns have a fixed width (no jump when their options load); on a phone they share one row with the "clear filters" button (a funnel with ✕, so it isn't taken for a refresh; Transactions: the instrument on a row of its own), the label shown inside the dropdown while nothing is picked, the count below. No router library: `packages/web/src/route.ts`.

"Asset type" is the instrument type (`BOND_LISTED` → "Listed bond", `BOND_RETAIL`, `ETF`, `BOND_IBKR`, `FUND_MANUAL`, `CASH`); transactions without an instrument (deposits, fees) count as "Cash". The reference sheet's 12 asset classes aren't modelled yet.

## Dashboard

- **Totals:** total (positions + cash), cash (only accounts whose assets are all tracked; the card says how many it leaves out), net deposits (money put in − taken out), profit (total − net deposits; also as % of net deposits and the XIRR).
- **Profit breakdown** (`GET /accounts`, `core/valuation/accounts.ts`): unrealised gain (open positions: value − FIFO cost), realised gain (sales and redemptions: proceeds − FIFO cost of the units sold, PLN at NBP D-1, as for tax), income (dividends, coupons, interest), fees and taxes outside trades (account fees, taxes, exchange fees; trade commissions are in the cost and proceeds), and "currency and other", the rest (exchange-rate effects on cash, a broker's spread, positions without a price), so the five add up to the profit.
- **Asset mix:** one bar split into shares (ETFs), bonds (all bond types, and ETFs with "Bond" in their name, e.g. high-yield bond ETFs), cash (PLN and foreign) and other (manually valued), with each share and amount: positions plus the cash of complete accounts, as in the totals.
- **Portfolio value over time:** positions + cash (fully tracked accounts) as the area, net deposits (money put in − taken out so far, other currencies at NBP D-1) dashed; the gap is the profit. A sale or redemption kept as cash doesn't move the line (before, the chart showed positions only, so the T-bill redemption on 2026-10-01 looked like a drop). Range selector: 1M, 6M, 1Y, all.
- **Accounts** (`GET /accounts`): per account net deposits (deposits − withdrawals; transfers between your accounts count on both sides), cash, total (positions + cash; the split and the profit, total − net deposits, in its tooltip), **XIRR** (money-weighted annual return of the deposits and withdrawals plus today's total, `core/valuation/accounts.ts`), unrealised and realised gain (as in the profit breakdown), income (coupons, interest, dividends) and costs (commissions, fees, taxes). Money in other currencies counts at the NBP rate of the day before each transaction. An account with its own currency (IBKR: EUR) has a second line in it ("└ in EUR"): net deposits (in EUR as made, the rest converted), total (today's rate), profit, XIRR. Incomplete accounts are greyed and left out of the total row. **Closed** accounts (no positions, no cash left) come last, folded into one greyed row "▸ n closed accounts" that expands them (with the date they were emptied); their profit stays in the total.
- **Allocation:** bars by asset type and by currency (positions of all accounts + cash of the complete ones, as in the totals), share and amount (on a phone the amount is in the row tooltip). Foreign cash counts as Cash.
- **Jobs:** last run of each job; failed jobs also appear as a banner.

## Holdings

From the latest snapshot (`SNAP#LATEST`), one row per account and instrument. **Group by** switches between two layouts (kept in the URL):

- **Account** (default): described below.
- **Instrument:** one row per instrument (by code), the second column showing the account it's held in. An instrument held in several accounts shows "▸ n accounts" with its total quantity and summed value/cost/gain/coupons; the arrow expands it into one row per account (the row itself opens the all-accounts chart). Cash comes after the instruments: complete accounts summed, "▸ n accounts" expands it (incomplete ones greyed, not summed); then the foreign cash (EUR, USD). The filters apply the same way.

- **Grouped by account** (alphabetically); each group row shows the account's value (positions + cash), cost, gain, gain % and coupons. Each account ends with its **Cash**: one row, or for an account holding several currencies one per currency ("Cash EUR": the amount, the NBP rate, its PLN value), its own currency first. A position bought in another currency shows its cost in PLN (NBP D-1) and, in the tooltip, as paid ("963,25 EUR"). Old PLN-only bookings of foreign cash ("EUR cash" positions) show next to the cash. The "Cash" asset-type filter shows all of it. Accounts holding only cash appear too. Rows keep one line: long instrument names are cut with "…" (full name in the tooltip). A total row appears when more than one account is shown.
- **Incomplete accounts** (some of their assets aren't tracked yet, e.g. Catalyst bonds): the group row says what's missing, and the cash row is greyed and left out of the sums, because without the untracked purchases it's far too high.
- **Instruments sorted by code** within each account.
- **Columns:** instrument (code + name), asset type, quantity, price (bonds: clean, % of nominal; ETFs: in their currency, e.g. "167,70 EUR"; price date and the NBP rate used on hover), accrued interest per bond, value (PLN), cost (PLN, as paid), gain (PLN, %), coupons/dividends received.
- **Filters:** account, asset type ("Cash" shows only the cash rows); "clear filters" (funnel ✕) clears them; "n of m holdings".
- **Row chart:** clicking a holding row shows that position's value and cost over time (range 1M/6M/1Y/ALL); grouped by instrument, the group row shows the instrument across all accounts. The chart is a panel docked to the bottom of the window (1/3 of its height by default) while the list stays visible and scrolls above it; its top edge is a drag handle (size remembered in the browser); ✕ or Escape closes it. Cash rows have no chart.
- **Corporate bonds** (Catalyst): clean price, % of nominal; the accrued-interest column shows "–" (not tracked: floating coupons), so their value is below the market value with interest.
- **Manually valued** assets (e.g. a property fund share) show their latest value entered by hand; in the Prices view it's tagged "manual" and never marked stale. **"Edit values"** in the asset's chart panel (Prices and Holdings) opens a form to add a value per unit on a date (today by default, not in the future); below the form, the values so far, newest first, each with ✕ to delete (a second click confirms). The valuation reruns from that date; meanwhile "Recalculating the valuation…" shows in the corner (after any save: transactions too) until the run finishes, then every view reloads ("Valuation updated.").

## Prices

Kept deliberately short (a passive portfolio needs no daily statistics): what each held instrument is worth per unit, and whether that price is current.

- **One row per held instrument** (latest snapshot), sorted by code. **Filter:** asset type ("clear filters", "n of m instruments"), kept in the URL.
- **Columns:** instrument (code + name), type, price (bonds: clean, % of nominal; others: in their currency), price date (grey with a "stale" tag when older than a week), **1 year**: change since the price on or before the same day a year earlier (hover shows that price and date; "–" without a year of history).
- **Foreign bonds at IBKR:** Börse Stuttgart closes (% of nominal); US T-bills calculated (the chart title says which), see data-sources.md. Currencies held (EUR/USD cash) aren't listed: their rates are in Indicators.
- **Retail bonds** aren't traded: price = this year's interest rate ("5,00 % p.a."), date = "calculated", 1 year = the previous year's rate. Their chart shows the calculated value per bond of your lots (PLN, nominal 100, so it reads like % of nominal), from the first purchase; each new interest year changes the slope.
- **Click a row:** its price chart opens in the panel docked to the bottom, as in Holdings (resizable by its top edge, size shared with Holdings; ✕, Escape or a second click closes it): range selector, transactions as markers; ETFs in their currency on today's share basis. The open chart is in the URL (`?chart=<ISIN>`) and stays open while filtering.

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
- **Refresh** (↻) is next to the valuation date in the headers of Dashboard, Holdings and Prices: it fetches today's quotes of ETFs, IBKR bonds and Catalyst bonds (ingestion.md, "Live prices") and revalues today. The corner says "Fetching today's prices…", then "Recalculating the valuation…"; when the run is done every view reloads and a message says how many prices changed (or "No new prices" when nothing has traded yet). The button is disabled while it runs; a second refresh within 5 minutes is refused with a message. Polish treasury bonds keep the previous close until the evening.
- **Add transaction** is in the menu frame, on every view (under the logo; on a phone a "+" next to ☰): it opens the form over the current view, and after saving every view reloads its data. A row here opens the form to edit or delete that transaction (deleting asks to confirm). Saving revalues from the transaction's date (about a minute); a message says so.

### The form (`TransactionForm.tsx`)

- Date, type (buy, sell, coupon, dividend, redemption, deposit, withdrawal, interest, fee, tax, split), account (or a new one).
- **Instrument** for buys, sells, coupons, dividends, redemptions and splits (optional for interest): the tracked ones first, then those no longer held, then **New instrument…**:
  - *Treasury bond by code*: "Find" looks it up (`GET /instruments/lookup`): retail series (EDO1036) from the Ministry file, listed ones (DS1030) from the MF calculator terms; added on save, its terms and prices follow.
  - *ETF*: ticker with exchange (AMS:VWRL, FRA:EUNK, LON:CSPX …), ISIN, name, currency: priced from Yahoo.
  - *Corporate bond*: code, ISIN, name, nominal (1000 or 100): priced from BiznesRadar.
  - *Other asset*: name and code; valued by hand (a buy records its price as the asset's value that day).
  - Foreign bonds at IBKR aren't offered yet (their prices are calculated from the trades; later from IBKR Flex).
- Quantity and price (bonds: % of nominal; retail: PLN per bond, prefilled 100; ETFs: in their currency), fee.
- **Currency** of the amount and fee, next to the amount: in an account with its own currency (IBKR: EUR) a trade starts in the instrument's currency and the rest in the account's; elsewhere PLN. Paid in PLN for an instrument in another currency (Bossa): the broker's rate too (prefilled with the NBP rate of the day or the last before).
- **Currency exchange**: what you gave (amount, currency, fee) and what you got (amount, currency); the line below shows both and the rate.
- **Amount** as a positive number (the type gives the direction: buys, fees, taxes, withdrawals take money out). For trades it is suggested from quantity × price (bonds × nominal, foreign × rate; sell: net of the fee) until you type your own: for a bond add the accrued interest, as on the broker's note. A line below shows the account's cash change.
- The server checks it again (`core/transactions/manual.ts`: real dates, an instrument where needed, the direction of the money) and returns the problem, shown in the form.
- From here on transactions are entered in the app (source `app`, random id). Re-importing the spreadsheet would add its newer rows a second time: the history up to the switch came from it, new ones come from the form.

## API (Lambda `api`)

| Endpoint | What |
|---|---|
| `GET /holdings` | `SNAP#LATEST` (holdings per account and instrument) |
| `GET /accounts` | `{ date, accounts: AccountSummary[], total }` (latest snapshot + all transactions) |
| `GET /portfolio/history?from&to` | `SNAP#<from>…<to>`: totals per day, plus `total` (positions + cash) and `netDeposits` (from the transactions) |
| `GET /instruments` | instruments + backfill status |
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items; retail bonds: the daily calculated value per bond of your lots (`calculated: true`) |
| `GET /instruments/{isin}/transactions` | transactions of that ISIN |
| `GET /prices` | held instruments: latest price + date, stale flag, price a year earlier and the change (`core/valuation/priceRows.ts`) |
| `GET /holdings/history?isin&account&from&to` | a position's daily value, cost and quantity (`POS#…` items); without `account`, the instrument summed over the accounts holding it |
| `GET /indicators` | one row per indicator (`core/indicators/indicators.ts`): `[{ id, name, group, unit, frequency, note, latest: { date, value }, yearAgo }]` |
| `GET /indicators/{id}?from&to` | one series, oldest first: `[{ date, value }]` (`cpi-mom`, `cpi-index`: by month; `fx-eur`, `fx-usd`: daily) |
| `GET /transactions` | all transactions, newest first, each with `instrument: { code, name, type }` or `null` |
| `GET /status` | last run of each job |
| `POST /transactions` | adds one (body: a transaction as in the import file, without `id`); 201 with it, 400 with the problem |
| `PUT /transactions/{id}?account=` | replaces it (same id; a new date or account moves it) |
| `DELETE /transactions/{id}?account=` | deletes it |
| `GET /instruments/lookup?code=` | `{ tracked, instrument }`: a tracked instrument, or a treasury series to add (404: unknown) |
| `POST /instruments` | adds one: a full instrument (as in the import file) or `{ kind: "treasury" \| "etf" \| "corporate" \| "manual", … }`; starts its price history; 409 if tracked |

Writes queue a revaluation from the earliest date touched.

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
