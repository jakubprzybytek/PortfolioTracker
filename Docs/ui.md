# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Four views, switched from a menu on the left (a top bar on narrow screens).

## Navigation

Hash routes, so the static site stays one page (no CloudFront rewrites) and every view, including its filters, can be bookmarked:

| Route | View |
|---|---|
| `#/` | Dashboard (default) |
| `#/holdings?account=…&type=…` | Holdings |
| `#/prices?chart=<ISIN>` | Prices |
| `#/transactions?instrument=<ISIN or none>&account=…&type=…` | Transactions |

Changing a filter replaces the history entry, so "back" goes to the previous view, not the previous filter. No router library: `packages/web/src/route.ts`.

"Asset type" is the instrument type (`BOND_LISTED` → "Listed bond", `BOND_RETAIL`, `ETF`, `BOND_IBKR`, `FUND_MANUAL`, `CASH`); transactions without an instrument (deposits, fees) count as "Cash". The reference sheet's 12 asset classes aren't modelled yet.

## Dashboard

- **Totals:** value, cost, gain (PLN and %), coupons received.
- **Portfolio value over time:** from `PORTFOLIO/SNAP#<date>`, with a range selector (1M, 6M, 1Y, all).
- **Holdings table:** one row per instrument, summed across accounts; sortable by any column. Clicking a row shows its price chart.
- **Per-instrument price chart:** clean price as a line, transactions as markers.
- **Jobs:** last run of each job; failed jobs also appear as a banner.

## Holdings

From the latest snapshot (`SNAP#LATEST`), one row per account and instrument.

- **Grouped by account** (alphabetically); each group row shows the account's value, cost, gain, gain % and coupons. A total row appears when more than one account is shown.
- **Instruments sorted by code** within each account.
- **Columns:** instrument (code + name), asset type, quantity, clean price (% of nominal; price date on hover), accrued interest per bond, value, cost, gain (PLN, %), coupons received.
- **Filters:** account, asset type; "Reset" clears them; "n of m holdings".

## Prices

Kept deliberately short (a passive portfolio needs no daily statistics): what each held instrument is worth per unit, and whether that price is current.

- **One row per held instrument** (latest snapshot), sorted by code; no filters.
- **Columns:** instrument (code + name), type, price (bonds: clean, % of nominal; others: in their currency), price date (grey with a "stale" tag when older than a week), **1 year**: change since the price on or before the same day a year earlier (hover shows that price and date; "–" without a year of history).
- **Retail bonds** aren't traded: price = this year's interest rate ("5,00 % p.a."), date = "calculated", 1 year = the previous year's rate. Their rows open no chart.
- **Click a row:** its price chart opens below (range selector, transactions as markers); click again to close. The open chart is in the URL (`?chart=<ISIN>`).

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
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items |
| `GET /instruments/{isin}/transactions` | transactions of that ISIN |
| `GET /prices` | held instruments: latest price + date, stale flag, price a year earlier and the change (`core/valuation/priceRows.ts`) |
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
