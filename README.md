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

`sst dev` runs the functions **on your machine**: the scheduled jobs only fire while it's running. Use `deploy` for unattended daily collection. Outputs (API URL, bucket, tables) are printed and saved in `.sst/outputs.json`.

## Domains

Each stage gets one domain (Route 53 zone `albedoonline.com` in this account; SST issues the certificate):

| Stage | Site | API |
|---|---|---|
| `prod` | `https://portfoliotracker.albedoonline.com` | `https://portfoliotracker.albedoonline.com/api/…` |
| any other, e.g. `int`, `dev` | `https://<stage>.portfoliotracker.albedoonline.com` | `https://<stage>.portfoliotracker.albedoonline.com/api/…` |

The API lives under `/api` on the same domain (a CloudFront `Router` strips the prefix and forwards to API Gateway), so the site and API share one certificate and origin and need no CORS.

## Login

The site and API need a login (Cognito; details in [Docs/ui.md](Docs/ui.md#access)). They use the existing user pool `AlbedoUserPool` (`eu-west-1_IVai0KEAA`) and its hosted login page; each stage adds its own app client. The pool is shared with other apps and allows sign-up, so access also requires the group **`portfolio-tracker`**: the API returns 403 to anyone outside it.

Give someone access (once per person; works for every stage):

```sh
aws cognito-idp admin-add-user-to-group --user-pool-id eu-west-1_IVai0KEAA --username <email> --group-name portfolio-tracker
```

Tests log in as `portfolio-tracker-test@albedoonline.com` with a password (allowed on the `int`/`dev` clients only); its password is the SST secret `TestUserPassword` of those stages. It's in the group `portfolio-tracker-test`, which only `int` and `dev` accept, so on `prod` it gets 403.

## Continuous delivery

`.github/workflows/cd.yml` runs on every push to `main`:

1. **version** – next minor tag: `v0.1`, `v0.2`, … (latest `v0.*` tag + 1).
2. **int** – type-check and unit tests, `sst deploy --stage int`, integration tests against `https://int.portfoliotracker.albedoonline.com/api`, Playwright E2E against the int site, both inside `sst shell --stage int` (they log in as the test user). The tests seed `int` with `data/instruments.json` and the sample transactions.
3. **prod** – only if int passed: `sst deploy --stage prod`, then the version tag is pushed. The version shows in the page footer.

AWS access uses the OIDC role in [infra/github/README.md](infra/github/README.md). Runs are serialised (`concurrency: cd`). A failed `int` stops the run: nothing reaches prod and no tag is created. Re-run failed runs from the Actions tab.

Generated type declarations (`sst-env.d.ts`, root and per package) are committed: CI type-checks before deploying, so it can't rely on SST regenerating them. They change when resources are added to `sst.config.ts`; commit the regenerated files with that change.

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
npm test                  # unit tests (core, jobs)
npm run typecheck

# Against a deployed stage; inside `sst shell` because they log in as that stage's test user:
npx sst shell --stage dev -- npm run test:integration
WEB_URL=https://dev.portfoliotracker.albedoonline.com npx sst shell --stage dev -- npm run test:e2e
# (without WEB_URL, E2E uses http://localhost:5173 from `npm run dev`; `npx playwright install chromium` once)
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
