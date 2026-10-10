# PortfolioTracker

A small personal portfolio tracker. You import your transactions; the app collects prices, values the portfolio every day (bonds with accrued interest and inflation indexation) and shows a table and charts. Serverless on AWS, costs nothing when idle.

Phase 1 covers Polish treasury bonds on GPW. Design notes are in [Docs/](Docs/README.md).

## Layout

```
packages/core   parsers, bond maths, valuation, DynamoDB repository (pure TypeScript, unit-tested)
packages/jobs   Lambda handlers: import, backfill, eod-gpw, monthly, valuation, api; integration tests
packages/web    Vite + React dashboard; Playwright E2E tests
data/           import files (instruments, sample transactions) – see data/README.md
poc/            the original GPW archive proof of concept
sst.config.ts   infrastructure (SST v4)
```

## Running

Requires Node 24+, npm 11+, and AWS credentials (`aws sts get-caller-identity` must work).

```sh
npm install
npm run dev -- --stage dev        # deploy the dev stage, run Lambdas locally (Live), start Vite on :5173
npm run deploy -- --stage dev     # real deployment: Lambdas and crons run in AWS without your machine
```

`sst dev` runs the functions **on your machine**: the scheduled jobs only fire while it's running. Use `deploy` for unattended daily collection. Outputs (API URL, bucket, table) are printed and saved in `.sst/outputs.json`.

First-time data load (see [data/README.md](data/README.md)):

```sh
BUCKET=$(node -p "require('./.sst/outputs.json').files")
aws s3 cp <kalkulatorodsetek.xlsm> s3://$BUCKET/imports/mf-calculator/kalkulatorodsetek.xlsm   # MF reference index + bond terms
aws s3 cp data/instruments.json  s3://$BUCKET/imports/instruments/instruments.json              # starts GPW history backfill
aws s3 cp <transactions.json>    s3://$BUCKET/imports/transactions/2026-10.json                 # triggers valuation
```

Optional: `npx sst secret set GusApiKey <key> --stage dev` enables the monthly CPI update from GUS BDL.

## Tests

```sh
npm test                  # unit tests (core)
npm run test:integration  # calls the deployed dev API (needs `npm run dev`/`deploy` for stage dev)
npm run test:e2e          # Playwright against http://localhost:5173 (or WEB_URL=…); `npx playwright install chromium` once
npm run typecheck
```

## Jobs (Europe/Warsaw)

| Job | When | Does |
|---|---|---|
| `eod-gpw` | 18:30 Mon–Fri | GPW all-bonds XLS for today + any day missing in the last 14 days |
| `eod-gpw` (recheck) | 07:15 Tue–Sat | re-fetches yesterday, marks prices final |
| `valuation` | 22:30, 07:30 | daily snapshot (positions × prices + accrued interest) |
| `monthly` | 16th 10:00 | CPI → IZ reference index; cross-check against the Ministry of Finance page |
| `import` | on S3 upload to `imports/` | instruments, transactions, MF calculator |
| `backfill` | on new instrument, or manual invoke `{ "isin": "…" }` | full GPW history |
