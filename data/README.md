# Import files

Upload a file to the bucket under `imports/<kind>/` and the `Import` Lambda loads it (see `Docs/backfill.md`):

| Kind | Path | Contents |
|---|---|---|
| `mf-calculator` | `imports/mf-calculator/<name>.xlsm` | Ministry of Finance `kalkulatorodsetek.xlsm` from [gov.pl/web/finanse/kalkulatory2](https://www.gov.pl/web/finanse/kalkulatory2): CPI reference index + treasury bond terms. Import this first. |
| `mf-retail` | `imports/mf-retail/<name>.xls` | Ministry of Finance "Dane dotyczące obligacji detalicznych" from [gov.pl/web/finanse/obligacje-detaliczne1](https://www.gov.pl/web/finanse/obligacje-detaliczne1): every retail bond series with its rates. Import before retail instruments. The `monthly` job also fetches it. |
| `prices` | `imports/prices/<name>.json` | Manual prices for assets without a price source: `[{ "isin": "ZZ…", "date": "2026-10-11", "price": 1000, "currency": "PLN" }]`. A new value is easier entered in the app ("Edit values" in the asset's chart panel). |
| `accounts` | `imports/accounts/<name>.json` | `[{ "account": "…", "incomplete": ["ETFs"] }]`: accounts whose assets aren't all tracked yet (their cash is shown greyed and not totalled). Written by the converter. |
| `instruments` | `imports/instruments/<name>.json` | Instruments to track ([instruments.json](instruments.json)). `"terms": "mf"` resolves bond terms from the calculator by code. A new instrument starts its own history backfill. |
| `coupons` | `imports/coupons/<name>.json` | Coupon periods of corporate bonds ([coupons.sample.json](coupons.sample.json)): `[{ "isin", "start", "end", "recordDate", "paymentDate", "datesSource", "rate": 0.0713, "rateSource": "manual" }]`. Easier in the app ("Coupon periods" in the bond's chart panel); the `coupons` job adds the dates from obligacje.pl. Mostly for restoring a backup. |
| `transactions` | `imports/transactions/<name>.json` | Your transactions ([transactions.sample.json](transactions.sample.json) shows the format). Re-importing the same file is safe: ids are derived from the row contents. |
| `notes` | `imports/notes/<name>.json` | Notes (Markdown): `[{ "id", "title", "body", "createdAt", "updatedAt" }]`. Written in the app (Notes view); for restoring a backup. Same id = the same note, replaced. |

```sh
BUCKET=$(node -e "console.log(require('./.sst/outputs.json').files)")
aws s3 cp data/instruments.json s3://$BUCKET/imports/instruments/instruments.json
aws s3 cp my-transactions.json s3://$BUCKET/imports/transactions/2026-10.json
```

Transaction fields: `date`, `account`, `type` (`BUY`, `SELL`, `COUPON`, `REDEMPTION`, `WRITE_OFF`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`, `DIVIDEND`, `SPLIT`, `EXCHANGE`), `isin`, `quantity`, `price` (bonds: clean % of nominal; ETFs: in the instrument's currency), `fxRate` (paid in PLN for an instrument in another currency: the broker's PLN per unit), `ratio` (`SPLIT`: units after per unit before), `WRITE_OFF` (the issuer defaulted: `quantity` lost, `amount` 0; the remaining cost becomes a realised loss), `amount` (signed cash in `currency`: negative = money out), `fee` (in `currency`), `currency` (what was paid or received; default PLN), `toAmount` and `toCurrency` (`EXCHANGE`: what came in), `note`, optional `id`. Accounts: `baseCurrency` (e.g. EUR) for an account kept in several currencies.

Corporate bonds (Catalyst): `"type": "BOND_CORPORATE"`, `"venue": "CATALYST"`, `"sourceIds": { "biznesradar": "KRU0827" }`, `"nominal": 100`. Prices are clean % of the nominal; accrued interest comes from the bond's coupon periods (`coupons` above). A bond no longer quoted: `"venue": "MANUAL"`, no source, prices from `imports/prices/` (% of nominal).

Foreign government bonds at IBKR, quoted (EUR Bunds, OATs …): `"type": "BOND_IBKR"`, `"venue": "XSTU"`, `"sourceIds": { "onvista": "STU" }`, `"nominal": 1000`, `currency` of the bond. Importing one (or switching an existing one to this source) loads its whole Börse Stuttgart history from onvista. Not quoted in Germany (US T-bills): `"venue": "CALC"`, no source, a `pricePath` (below).

ETF instruments: `"type": "ETF"`, `currency` of the listing, `venue` (`XAMS`, `XETR` …), `"sourceIds": { "yahoo": "VWRL.AS" }` and any `splits` (`[{ "date": "2025-12-15", "ratio": 100 }]`). Importing one loads its full price history from Yahoo and the NBP rates of its currency; recording a new split later reloads the history.

`transactions.sample.json` (with `instruments.sample.json`, `prices.sample.json`, `coupons.sample.json` and `accounts.sample.json`) is **made-up data** for trying the app out.

## Restoring from a backup

The `Export` job writes `exports/<date>/{accounts,instruments,prices,coupons,transactions,notes}.json` on the 1st of every month (Docs/data-storage.md). Each file is in the format above, so a restore is uploading them, in this order, after the MF calculator and the retail-bond file:

```sh
D=exports/2026-11-01
for k in accounts instruments prices coupons transactions notes; do aws s3 cp s3://$BUCKET/$D/$k.json s3://$BUCKET/imports/$k/restore-$k.json; done
```

Transactions keep their ids and sources, so restoring into a table that still has them changes nothing.

## Transactions from the reference spreadsheet

`scripts/sheet-to-transactions.ts` converts the "Transakcje" tab of the Google Sheets tracker (File → Download → Microsoft Excel) into a transactions file:

```sh
node scripts/sheet-to-transactions.ts ~/Downloads/portfolio.xlsx --mf-retail ~/Downloads/Dane_dotyczace_obligacji_detalicznych.xls
# → data/private/: instruments.json, prices.json, accounts.json, transactions.json (gitignored); import in that order
```

- **Catalyst bonds:** list them in `data/private/catalyst.json` (`[{ "ticker": "CPS0130", "isin": "PLCFRPT00070", "nominal": 1000, "name": "Cyfrowy Polsat S.A. (WIBOR 6M + 3.85%)" }]`, from obligacje.pl; or `--catalyst <file>`). Buys/sells become % of nominal, coupons `COUPON` (as received, i.e. after tax in a taxable account). A bond still held is priced from BiznesRadar; one no longer held (usually redeemed) gets its trade prices as manual prices.
- **IBKR:** foreign government bonds (ticker = ISIN; price per 1000 → % of nominal; `pricePath` from your trades plus 100 % at the maturity in the name while held) With `--native IBKR=EUR` the account is kept in its currencies: each trade and fee in the currency that paid it, the currency rows (`Waluty_EUR`) as exchanges, the account's own currency EUR. Without it, the sheet's PLN bookings (currency positions "EUR cash" bought and sold with PLN). No file needed.
- **ETFs:** the sheet has no ISINs, so list them in `data/private/etfs.json` (`[{ "ticker": "AMS:VWRL", "isin": "IE00B3RBWM25" }]`, or pass `--etfs <file>`). Their buys, sells, dividends and splits are converted (EUR price, PLN amount and fee, the trade's `fxRate`); the ETF instruments (venue and Yahoo symbol from the ticker's exchange, splits from the sheet's Split rows) go to `data/private/instruments.json`.
- Converts what the app can value: cash movements (deposits, withdrawals, interest, costs), the instruments in [instruments.json](instruments.json) (matched by code) and retail treasury bonds: the sheet's `EDO-110332` becomes series EDO0332 (ISIN from the Ministry file) with interest from 2022-03-11 (`valueDate`); COI/ROR interest becomes `COUPON`. Your retail series go to `data/private/instruments.json`: import it after the `mf-retail` file. Everything else is listed as skipped, with the reason (retail bonds, Catalyst bonds, ETFs, IBKR bonds, currency positions …); it gets converted once the app supports it.
- Bond prices: the sheet stores PLN per bond; the file gets % of nominal. Buy amounts exclude the fee (the sheet's total includes it).
- Ids are derived from the row contents, so re-running the script and re-importing never duplicates transactions, even after the sheet re-sorts its rows. Identical rows (e.g. two equal deposits on one day) get distinct ids.
- The file is validated with the same schema as the Import Lambda before it's written.
- The app is now where transactions are entered: don't re-import the sheet into `prod` (its newer rows would duplicate them). IBKR comes from its statements instead (below).

## History before the app (2008–2022)

`scripts/history-sheet-to-import.ts` converts the "Bonds 2010-2015" history spreadsheet (accounts closed before the app started: the DM BZWBK brokerage account with its Catalyst and treasury bonds and an unitised shares/certificates position, the BZ WBK/Santander and ING savings accounts, the Arka funds, XTB and a term deposit) into import files:

```sh
node scripts/history-sheet-to-import.ts ~/Downloads/history.xlsx   # or a folder with one JSON file of values per tab
# → data/private/history/: instruments.json, prices.json, accounts.json, transactions.json; import in that order
```

- Tabs read, by their headers: Bonds, Savings, Lokata, Arka, DM BZWBK, XTB, Bond prices.
- The bonds are no longer quoted: `BOND_CORPORATE`, venue `MANUAL`, inactive, priced from the "Bond prices" tab (% of nominal; a defaulted bond gets no price at 0 %: its `WRITE_OFF` closes the position). Arka's fund categories, the DM BZWBK shares/certificates and XTB are `FUND_MANUAL` with ids from their codes (`privateAssetId`), priced from the tabs' price tables.
- Santander's rows stop where the app's own history of the account starts (2022-05): the sheet's last row hands over the balance (Savings tab, 2022-06-01). Don't import anything else of that account from the sheet.
- It prints each account's cash at the end (0 for all), any position still open (XTB keeps 0.033 units, 0.78 PLN) and the lowest cash balance.

## IBKR transactions from activity statements

`scripts/ibkr-statements-to-transactions.ts` converts IBKR activity statements (Client Portal → Performance & Reports → Statements → Activity, CSV, at most a year each) into the IBKR account's transactions, in its currencies (rules: [Docs/data-sources.md](../Docs/data-sources.md)):

```sh
node scripts/ibkr-statements-to-transactions.ts ~/Downloads/statement-2024.csv ~/Downloads/statement-2025.csv ~/Downloads/statement-2026.csv
# → data/private/ibkr-from-statements.json; prints the cash per currency at the end (check it against the last statement's Cash Report)
```

Pass every statement since the account was opened: the file is the account's whole history. To replace what's stored, back up and delete the account's imported transactions (keep those entered in the app), then upload the file to `imports/transactions/`. Bills and bonds need their instruments imported first (`BOND_IBKR`: quoted bonds with the onvista source above; bills with a `pricePath` from the statement's trade prices).
