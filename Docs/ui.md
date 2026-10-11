# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Three views, switched from a menu on the left (a top bar on narrow screens).

## Navigation

Hash routes, so the static site stays one page (no CloudFront rewrites) and every view, including its filters, can be bookmarked:

| Route | View |
|---|---|
| `#/` | Dashboard (default) |
| `#/holdings?account=…&type=…` | Holdings |
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
| `GET /transactions` | all transactions, newest first, each with `instrument: { code, name, type }` or `null` |
| `GET /status` | last run of each job |

The UI loads all transactions and filters them in the browser; at a few hundred to a few thousand rows that's one small request.

## Access

Login with Cognito; everything under `/api` needs it. The site's files are public (they hold no data); the app sends you to the login page until you're logged in.

- **User pool:** the existing `AlbedoUserPool` (`eu-west-1_IVai0KEAA`), shared with other apps, and its hosted login page `https://eu-west-1ivai0keaa.auth.eu-west-1.amazoncognito.com`. SST only references it (`CognitoUserPool.get`) and adds clients; it never changes or deletes the pool.
- **Clients per stage:** `portfolio-tracker-<stage>-web` for the site (authorization code + PKCE, no secret; callback and logout URL = the stage's site, plus `http://localhost:5173/` on `dev`; access/ID token 1 hour, refresh token 30 days) and, on `int` and `dev` only, `portfolio-tracker-<stage>-test` (password login without a browser, for the tests).
- **API Gateway** (JWT authorizer) accepts only access tokens of this pool issued to those clients: a missing, expired or forged token gets **401**, and tokens from the other apps' clients are rejected too.
- **Group:** the pool allows sign-up, so being able to log in isn't enough: the API Lambda also requires `cognito:groups` to contain **`portfolio-tracker`** and returns **403** otherwise ("This account has no access"). Members are added with the AWS CLI (README, "Login").
- **In the browser** (`oidc-client-ts` + `react-oidc-context`): tokens in localStorage, renewed with the refresh token; the view you were on (`#/…`) survives the round trip to the login page. A 401 from the API starts a new login. "Log out" (in the menu) clears the tokens and ends the hosted-page session.
- MFA is off in the pool (a pool-wide setting shared with the other apps).
