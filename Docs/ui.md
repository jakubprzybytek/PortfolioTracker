# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Four views, switched from a menu on the left (a top bar on narrow screens).

## Navigation

Hash routes, so the static site stays one page (no CloudFront rewrites) and every view, including its filters, can be bookmarked:

| Route | View |
|---|---|
| `#/` | Dashboard (default) |
| `#/holdings?group=instrument&account=…&type=…&chart=<ISIN>&chartAccount=…` | Holdings (`group` absent = by account; `chart` = the open row chart) |
| `#/prices?chart=<ISIN>` | Prices |
| `#/indicators?chart=<id>&range=1Y\|10Y\|ALL` | Indicators (`range` absent = 5 years) |
| `#/transactions?instrument=<ISIN or none>&account=…&type=…` | Transactions |

Changing a filter replaces the history entry, so "back" goes to the previous view, not the previous filter. No router library: `packages/web/src/route.ts`.

"Asset type" is the instrument type (`BOND_LISTED` → "Listed bond", `BOND_RETAIL`, `ETF`, `BOND_IBKR`, `FUND_MANUAL`, `CASH`); transactions without an instrument (deposits, fees) count as "Cash". The reference sheet's 12 asset classes aren't modelled yet.

## Dashboard

- **Totals:** total (positions + cash), value of positions, cash (only accounts whose assets are all tracked; the card says how many it leaves out), cost, gain (PLN and %), coupons and income received.
- **Portfolio value over time:** from `PORTFOLIO/SNAP#<date>`, with a range selector (1M, 6M, 1Y, all).
- **Holdings table:** one row per instrument, summed across accounts; sortable by any column. Clicking a row shows its price chart.
- **Per-instrument price chart:** clean price as a line, transactions as markers.
- **Jobs:** last run of each job; failed jobs also appear as a banner.

## Holdings

From the latest snapshot (`SNAP#LATEST`), one row per account and instrument. **Group by** switches between two layouts (kept in the URL):

- **Account** (default): described below.
- **Instrument:** one group per instrument (by code) with its total quantity, price and summed value/cost/gain/coupons; under it one row per account holding it. Cash is a last group with one row per account (incomplete ones greyed, not summed). The filters apply the same way.

- **Grouped by account** (alphabetically); each group row shows the account's value (positions + cash), cost, gain, gain % and coupons. Each account ends with a **Cash** row; accounts holding only cash appear too. A total row appears when more than one account is shown.
- **Incomplete accounts** (some of their assets aren't tracked yet, e.g. ETFs): the group row says what's missing, and the cash row is greyed and left out of the sums, because without the untracked purchases it's far too high.
- **Instruments sorted by code** within each account.
- **Columns:** instrument (code + name), asset type, quantity, clean price (% of nominal; price date on hover), accrued interest per bond, value, cost, gain (PLN, %), coupons received.
- **Filters:** account, asset type ("Cash" shows only the cash rows); "Reset" clears them; "n of m holdings".
- **Row chart:** clicking a holding row shows that position's value and cost over time (range 1M/6M/1Y/ALL); grouped by instrument, the group row shows the instrument across all accounts. The chart is a panel docked to the bottom of the window (1/3 of its height by default) while the list stays visible and scrolls above it; its top edge is a drag handle (size remembered in the browser); ✕ or Escape closes it. Cash rows have no chart.
- **Manually valued** assets (e.g. a property fund share) show their latest manual price; in the Prices view it's tagged "manual" and never marked stale.

## Prices

Kept deliberately short (a passive portfolio needs no daily statistics): what each held instrument is worth per unit, and whether that price is current.

- **One row per held instrument** (latest snapshot), sorted by code; no filters.
- **Columns:** instrument (code + name), type, price (bonds: clean, % of nominal; others: in their currency), price date (grey with a "stale" tag when older than a week), **1 year**: change since the price on or before the same day a year earlier (hover shows that price and date; "–" without a year of history).
- **Retail bonds** aren't traded: price = this year's interest rate ("5,00 % p.a."), date = "calculated", 1 year = the previous year's rate. Their chart shows the calculated value per bond of your lots (PLN, nominal 100, so it reads like % of nominal), from the first purchase; each new interest year changes the slope.
- **Click a row:** its price chart opens below (range selector, transactions as markers); click again to close. The open chart is in the URL (`?chart=<ISIN>`).

## Indicators

Economic indicators from data already stored (no extra source), same layout as Prices.

- **Rows:** *Inflation, month on month* (CPI, previous month = 100, from `CPI_REF.wr`) and *CPI reference index* (`CPI_REF.w`, June 2003 = 100, the index behind IZ indexation). Columns: latest value, its month, the value a year earlier. Hover a row for what it is.
- **Click a row:** its chart opens below: monthly bars around zero for the % series, a line for the index; ranges 1Y / 5Y (default) / 10Y / ALL (from 2003-07). Chart and range are in the URL.
- **No 12-month inflation:** compounding the one-decimal monthly figures misses GUS's published y/y by up to ~0.3 pp, so that needs GUS's own y/y series (in the CSV the `monthly` job already downloads, not stored yet).

## Transactions

All transactions from `GET /transactions`.

- **Sorted by date, newest first** (fixed).
- **Columns:** date, account, type, instrument (code + name), asset type, quantity, price, amount (signed: red = money out), fee, note.
- **Filters:** instrument (including "(no instrument)" for cash movements), account, asset type; "Reset"; "n of m transactions".
- Read-only: transactions come from the file import (data/README.md).

## API (Lambda `api`)

| Endpoint | Reads |
|---|---|
| `GET /holdings` | `SNAP#LATEST` (holdings per account and instrument) |
| `GET /portfolio/history?from&to` | `SNAP#<from>…<to>` (totals only) |
| `GET /instruments` | instruments + backfill status |
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items; retail bonds: the daily calculated value per bond of your lots (`calculated: true`) |
| `GET /instruments/{isin}/transactions` | transactions of that ISIN |
| `GET /prices` | held instruments: latest price + date, stale flag, price a year earlier and the change (`core/valuation/priceRows.ts`) |
| `GET /holdings/history?isin&account&from&to` | a position's daily value, cost and quantity (`POS#…` items); without `account`, the instrument summed over the accounts holding it |
| `GET /indicators` | all indicators with their full monthly series (`core/indicators/cpi.ts`): `[{ id, name, unit, note, points: [{ date: "YYYY-MM", value }] }]` |
| `GET /transactions` | all transactions, newest first, each with `instrument: { code, name, type }` or `null` |
| `GET /status` | last run of each job |

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
