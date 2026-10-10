# UI

A small React app (Vite, `sst.aws.StaticSite`) that reads through the `api` Lambda. Phase 1 has two views. Nothing else is planned yet.

## Holdings table (TanStack Table)

One row per holding, from `PORTFOLIO/SNAP#LATEST`:

| Column | Notes |
|---|---|
| Instrument, ISIN, type, account | |
| Quantity | |
| Price | clean % for bonds; value per bond for retail bonds |
| Price date | shown as stale when `last_trade_date` is old (illiquid bonds) |
| Accrued interest per bond | bonds only |
| Value (PLN) | quantity × (clean × nominal + accrued) |
| Cost (PLN), gain/loss (PLN, %) | from your transactions; coupons received shown separately |

Totals per account and per asset type. Sortable and filterable.

## Charts (Recharts)

- **Portfolio value over time:** from `PORTFOLIO/SNAP#<date>`, with a range selector (1M, 6M, 1Y, all). Optionally stacked by asset type.
- **Per-instrument price chart:** from `INST#<isin>/PX#…`. Close price as a line; days without trades shown differently (e.g. hollow points). Transactions as markers.

## API (Lambda `api`)

| Endpoint | Reads |
|---|---|
| `GET /holdings` | `SNAP#LATEST` |
| `GET /portfolio/history?from&to` | `SNAP#<from>…<to>` |
| `GET /instruments/{isin}/prices?from&to` | `PX#…` items |
| `GET /instruments/{isin}/transactions` | `TX#…` items for that ISIN |

Access: private use only. Simplest is a shared secret or IAM-signed requests; the choice is still open.
