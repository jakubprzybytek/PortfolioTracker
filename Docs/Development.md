# Development

How to run the app on your machine, check a change in a real browser, and get it to production. Commands, stages and the test user are in the root [README.md](../README.md) ("Running", "Login", "Tests").

## Run locally

```sh
npm run dev -- --stage dev
```

This runs `sst dev` against the `dev` stage:

- **Infrastructure** (tables, bucket, queue, API Gateway, Cognito client) is deployed to AWS as the `dev` stage, so the data is dev's sample data in AWS.
- **Lambdas run on your machine** ("Live"): API calls and jobs execute locally, so a code change takes effect without a deploy. The scheduled jobs only fire while `sst dev` is running.
- **The site** runs in Vite on http://localhost:5173 (fixed port) and calls API Gateway directly. CORS allows `localhost:5173` on every stage except prod.
- **Only the site, against a deployed stage** (no `sst dev`, nothing changes in AWS; quick for CSS and layout work): in `packages/web`, `VITE_API_URL=<the stage's apiGateway from .sst/outputs.json> VITE_AUTH_USER_POOL_ID=<COGNITO_POOL_ID in sst.config.ts> VITE_AUTH_CLIENT_ID=<authClientId> npx vite`. Log in once on localhost (its own session). Edits show at once (hot reload).

Log in with your own account (it must be in the `portfolio-tracker` group) or with the test user (`portfolio-tracker-test@albedoonline.com`, password = the `TestUserPassword` secret of the stage).

**Stop it when you're done** (Ctrl+C in its terminal). A leftover `sst dev` holds dev's stage lock and blocks every `deploy` to dev. If dev is locked, look for a stray `sst dev` process before anything else. For unattended use, and in an agent session, deploy instead of running `sst dev`:

```sh
npm run deploy -- --stage dev        # Lambdas and crons run in AWS; the site at https://dev.portfoliotracker.albedoonline.com
```

## Check a change in the browser

Automated tests (below) prove behaviour; a look in a real browser catches layout and styling problems they don't, e.g. a style from one view leaking into another.

**Claude in Chrome** (the browser extension, `mcp__claude-in-chrome__*` tools) lets Claude drive your own Chrome, with your own login:

1. Run the app (`npm run dev -- --stage dev`, http://localhost:5173) or deploy dev (https://dev.portfoliotracker.albedoonline.com). Use prod (https://portfoliotracker.albedoonline.com) only to look, never to try out edits: it holds the real data.
2. Claude opens the page in a **new tab**, logs in if needed, clicks through the changed view and takes screenshots; the console log (`read_console_messages`) shows runtime errors.
3. Check desktop width and phone width (390 px) for anything that changes layout.

The app uses no native `alert`/`confirm` dialogs (deletes confirm in-page), so the extension isn't blocked by one.

Without the extension, a throwaway Playwright spec against the deployed stage does the same for screenshots (log-in state from the E2E global setup):

```sh
WEB_URL=https://dev.portfoliotracker.albedoonline.com npx sst shell --stage dev -- npx playwright test -c packages/web/playwright.config.ts <spec>
```

Put such probes and screenshots in `temp/<subfolder>/`, not in `packages/web/e2e/`.

## Tests

| Kind | Command | Against |
|---|---|---|
| Type check | `npm run typecheck` | the code |
| Unit (Vitest) | `npm test` | the code, with fixtures |
| Integration (API) | `npx sst shell --stage dev -- npm run test:integration` | a deployed stage (logs in as the test user) |
| E2E (Playwright) | `WEB_URL=https://dev.portfoliotracker.albedoonline.com npx sst shell --stage dev -- npm run test:e2e` | a deployed site (without `WEB_URL`: http://localhost:5173) |

Integration and E2E tests seed the stage with the sample data (`data/instruments.json`, `data/transactions.sample.json`). Run them on `dev` or `int` only; never on `prod`.

A change comes with tests at the level it touches: unit for core logic, integration for an API change, E2E for what the UI shows.

## Delivery: every change goes to production

Continuous delivery (`.github/workflows/cd.yml`). Every push or merge to `main`:

1. deploys **int** after the type check and unit tests,
2. runs the **regression tests** against int: integration (API) and E2E (browser),
3. tags the commit `v0.N` (the version in the page footer) only if they all passed: the tag marks a release that passed int,
4. deploys **prod** and **test** (the history-import stage) from that tag, in parallel. A failed test deploy doesn't hold back prod; a failed prod deploy leaves the tag, so re-running the failed job deploys the same tag.

A failure at any step before that stops the run: nothing reaches prod or test. Watch runs at https://github.com/jakubprzybytek/PortfolioTracker/actions.

**By default, every code change goes all the way to prod.** Once a change is done and checked (type check, unit tests, deployed to dev with the integration and E2E tests passing, and a look in the browser for UI changes), commit it to `main` and push. There's no need to ask for permission for an ordinary change: CD and its tests are the gate.

**Ask first** only when the deploy would change data, or otherwise calls for caution:

- it changes or deletes stored data on prod: migrations, rewriting or removing items, re-imports, backfills that overwrite, changing keys or item shapes in a way existing items must follow;
- it could replace or remove a resource that holds data: a table, the bucket, an index, `removal`/`protect`/deletion-protection settings;
- it touches access or security: Cognito clients, groups, IAM, the CI deploy role, CORS, auth;
- it noticeably raises cost or calls an external service in a new way (e.g. a paid source);
- it can't be undone by reverting the commit and pushing again.

In those cases, describe what will change and wait for a yes before pushing.
