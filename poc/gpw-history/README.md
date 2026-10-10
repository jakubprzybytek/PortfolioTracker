# PoC: GPW treasury bond history

Downloads the full daily price history of GPW-listed treasury bonds (default examples: IZ0836, DS0432) from the [GPW quotation archive](https://www.gpw.pl/archiwum-notowan).

```sh
npm install
npm run fetch                      # IZ0836 and DS0432
npm run fetch -- DS0432 WZ0329     # other treasury bonds
npm run fetch -- --out ../data     # other output folder (default: ./data)

npm run fetch -- --day 2026-10-09          # one session, IZ0836 + DS0432, one request
npm run fetch -- --day 2026-10-09 --all    # one session, all treasury bonds in the file
```

`--day` writes `data/day/<date>.json|csv`. A day without a session (weekend, holiday) prints "no session" and exits 0.

Requires Node 24+ (runs TypeScript directly, no build step).

## Output

| File | Contents |
|---|---|
| `data/raw/<run date>/<code>_to_<date>_obligacje.xls` | original file from GPW, kept for reprocessing |
| `data/<CODE>.json`, `data/<CODE>.csv` | one row per session |

Fields: `date, instrument, isin, currency, open, high, low, close, changePct, volume, trades, turnoverThousands, nominal, traded`.

- Prices are **clean prices in % of nominal**. Accrued interest isn't included; it has to be computed from the coupon schedule.
- `nominal` is GPW's "Cena nominalna" column. **Don't use it to value inflation-linked (IZ) bonds.** For IZ0836 it showed the indexed nominal (1023 → 1074) until Sept 2025. Since 2025-09-29 most sessions show plain 1000, with an indexed value (e.g. 1105) only on some days. It's also rounded to whole PLN. Take the indexed nominal from the official index ratio / CPI instead, and use this column only as a sanity check.
- On days without trades `open/high/low` are empty, `volume = 0`, and `close` is the reference price carried over.

## Findings

- **One request per bond returns its whole history** from the first listing day (DS0432: 2021-06-16, 1334 sessions; IZ0836: 2024-06-24, 575 sessions). There's no need to loop over daily files for a backfill, and the daily job can simply re-download the full file (~170 KB).
- The XLS (`fetch=1`) has more columns than the HTML page: ISIN, volume, number of trades, nominal value.
- **gpw.pl is sensitive to request rate.** After a few dozen requests within minutes, every connection was reset for a while. The script waits 5 s between instruments and backs off 10/20 s on errors. Keep it at a few requests per run.
- Global `fetch` was reset more often than `node:https` in testing, so the client uses `node:https`.
- The archive has no "last N sessions" or date-range option. `date=dd-mm-yyyy` means **a single session**:
  - with an instrument: that bond's one row, HTML only (`fetch=1` also returns HTML);
  - without an instrument: **all treasury bonds for that day as XLS** (~9 KB, 73 rows on 2026-10-09), with the same columns as the history file, so `parseHistoryXls` reads it unchanged.
- Use the full history per bond for backfill and periodic checks, and the daily all-bonds file for the daily job.
- SheetJS (`xlsx`) is installed from `vendor/xlsx-0.20.3.tgz`, the official package from cdn.sheetjs.com. The npm registry only has 0.18.5, which has known vulnerabilities, and npm 12 refuses remote tarball URLs.
