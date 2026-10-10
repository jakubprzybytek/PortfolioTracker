# Import files

Upload a file to the bucket under `imports/<kind>/` and the `Import` Lambda loads it (see `Docs/backfill.md`):

| Kind | Path | Contents |
|---|---|---|
| `mf-calculator` | `imports/mf-calculator/<name>.xlsm` | Ministry of Finance `kalkulatorodsetek.xlsm` from [gov.pl/web/finanse/kalkulatory2](https://www.gov.pl/web/finanse/kalkulatory2): CPI reference index + treasury bond terms. Import this first. |
| `instruments` | `imports/instruments/<name>.json` | Instruments to track ([instruments.json](instruments.json)). `"terms": "mf"` resolves bond terms from the calculator by code. A new instrument starts its own history backfill. |
| `transactions` | `imports/transactions/<name>.json` | Your transactions ([transactions.sample.json](transactions.sample.json) shows the format). Re-importing the same file is safe: ids are derived from the row contents. |

```sh
BUCKET=$(node -e "console.log(require('./.sst/outputs.json').files)")
aws s3 cp data/instruments.json s3://$BUCKET/imports/instruments/instruments.json
aws s3 cp my-transactions.json s3://$BUCKET/imports/transactions/2026-10.json
```

Transaction fields: `date`, `account`, `type` (`BUY`, `SELL`, `COUPON`, `REDEMPTION`, `DEPOSIT`, `WITHDRAWAL`, `FEE`, `TAX`, `INTEREST`), `isin`, `quantity`, `price` (bonds: clean % of nominal), `amount` (signed cash: negative = money out), `fee`, `currency` (default PLN), `note`, optional `id`.

`transactions.sample.json` is **made-up data** for trying the app out.
