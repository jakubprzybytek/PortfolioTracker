# Import files

Upload a file to the bucket under `imports/<kind>/` and the `Import` Lambda loads it (see `Docs/backfill.md`):

| Kind | Path | Contents |
|---|---|---|
| `mf-calculator` | `imports/mf-calculator/<name>.xlsm` | Ministry of Finance `kalkulatorodsetek.xlsm` from [gov.pl/web/finanse/kalkulatory2](https://www.gov.pl/web/finanse/kalkulatory2): CPI reference index + treasury bond terms. Import this first. |
| `mf-retail` | `imports/mf-retail/<name>.xls` | Ministry of Finance "Dane dotyczące obligacji detalicznych" from [gov.pl/web/finanse/obligacje-detaliczne1](https://www.gov.pl/web/finanse/obligacje-detaliczne1): every retail bond series with its rates. Import before retail instruments. The `monthly` job also fetches it. |
| `prices` | `imports/prices/<name>.json` | Manual prices for assets without a price source: `[{ "isin": "ZZ…", "date": "2026-10-11", "price": 1000, "currency": "PLN" }]`. Upload a new file whenever you have a new value. |
| `accounts` | `imports/accounts/<name>.json` | `[{ "account": "…", "incomplete": ["ETFs"] }]`: accounts whose assets aren't all tracked yet (their cash is shown greyed and not totalled). Written by the converter. |
| `instruments` | `imports/instruments/<name>.json` | Instruments to track ([instruments.json](instruments.json)). `"terms": "mf"` resolves bond terms from the calculator by code. A new instrument starts its own history backfill. |
| `transactions` | `imports/transactions/<name>.json` | Your transactions ([transactions.sample.json](transactions.sample.json) shows the format). Re-importing the same file is safe: ids are derived from the row contents. |

```sh
BUCKET=$(node -e "console.log(require('./.sst/outputs.json').files)")
aws s3 cp data/instruments.json s3://$BUCKET/imports/instruments/instruments.json
aws s3 cp my-transactions.json s3://$BUCKET/imports/transactions/2026-10.json
```

Transaction fields: `date`, `account`, `type` (`BUY`, `SELL`, `COUPON`, `REDEMPTION`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`, `DIVIDEND`, `SPLIT`), `isin`, `quantity`, `price` (bonds: clean % of nominal; ETFs: in the instrument's currency), `fxRate` (foreign-currency trades: the broker's PLN per unit), `ratio` (`SPLIT`: units after per unit before), `amount` (signed cash in PLN: negative = money out), `fee`, `currency` (default PLN), `note`, optional `id`.

ETF instruments: `"type": "ETF"`, `currency` of the listing, `venue` (`XAMS`, `XETR` …), `"sourceIds": { "yahoo": "VWRL.AS" }` and any `splits` (`[{ "date": "2025-12-15", "ratio": 100 }]`). Importing one loads its full price history from Yahoo and the NBP rates of its currency; recording a new split later reloads the history.

`transactions.sample.json` (with `instruments.sample.json`, `prices.sample.json` and `accounts.sample.json`) is **made-up data** for trying the app out.

## Transactions from the reference spreadsheet

`scripts/sheet-to-transactions.ts` converts the "Transakcje" tab of the Google Sheets tracker (File → Download → Microsoft Excel) into a transactions file:

```sh
node scripts/sheet-to-transactions.ts ~/Downloads/portfolio.xlsx --mf-retail ~/Downloads/Dane_dotyczace_obligacji_detalicznych.xls
# → data/private/: instruments.json, prices.json, accounts.json, transactions.json (gitignored); import in that order
```

- **ETFs:** the sheet has no ISINs, so list them in `data/private/etfs.json` (`[{ "ticker": "AMS:VWRL", "isin": "IE00B3RBWM25" }]`, or pass `--etfs <file>`). Their buys, sells, dividends and splits are converted (EUR price, PLN amount and fee, the trade's `fxRate`); the ETF instruments (venue and Yahoo symbol from the ticker's exchange, splits from the sheet's Split rows) go to `data/private/instruments.json`.
- Converts what the app can value: cash movements (deposits, withdrawals, interest, costs), the instruments in [instruments.json](instruments.json) (matched by code) and retail treasury bonds: the sheet's `EDO-110332` becomes series EDO0332 (ISIN from the Ministry file) with interest from 2022-03-11 (`valueDate`); COI/ROR interest becomes `COUPON`. Your retail series go to `data/private/instruments.json`: import it after the `mf-retail` file. Everything else is listed as skipped, with the reason (retail bonds, Catalyst bonds, ETFs, IBKR bonds, currency positions …); it gets converted once the app supports it.
- Bond prices: the sheet stores PLN per bond; the file gets % of nominal. Buy amounts exclude the fee (the sheet's total includes it).
- Ids are derived from the row contents, so re-running the script and re-importing never duplicates transactions, even after the sheet re-sorts its rows. Identical rows (e.g. two equal deposits on one day) get distinct ids.
- The file is validated with the same schema as the Import Lambda before it's written.
