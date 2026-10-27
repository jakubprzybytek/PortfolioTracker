# Development

This app is developed and delivered per the [continuous-delivery standard](https://github.com/jakubprzybytek/agent-playbook/blob/main/skills/continuous-delivery/STANDARD.md): develop on `dev`, every push to `main` goes through `int` to `prod`. The standard has the general rules (stages, tests, the CD pipeline, versions, when a push needs a yes first, test users); this file holds what is specific to PortfolioTracker. Commands and the login are also in the root [README.md](../README.md) ("Running", "Login", "Tests").

## Stages

| Stage | URL | Data |
|---|---|---|
| `dev` | https://dev.portfoliotracker.albedoonline.com, or http://localhost:5173 with `npm run dev` | sample data |
| `int` | https://int.portfoliotracker.albedoonline.com | seeded by the tests |
| `prod` | https://portfoliotracker.albedoonline.com | real data |

## Run locally

```sh
npm run dev -- --stage dev        # sst dev: Lambdas on your machine, site on http://localhost:5173
npm run deploy -- --stage dev     # full deployment; use it in agent sessions
```

- With `sst dev`, the infrastructure (tables, bucket, queue, API Gateway, Cognito client) is `dev` in AWS; the Lambdas run locally, so a code change takes effect without a deploy. Scheduled jobs only fire while `sst dev` runs.
- The site runs in Vite on port 5173 (fixed) and calls API Gateway directly; CORS allows `localhost:5173` on every stage except prod.
- **Only the site, against a deployed stage** (nothing changes in AWS; quick for CSS and layout work): in `packages/web`, `VITE_API_URL=<the stage's apiGateway from .sst/outputs.json> VITE_AUTH_USER_POOL_ID=<COGNITO_POOL_ID in sst.config.ts> VITE_AUTH_CLIENT_ID=<authClientId> npx vite`. Log in once on localhost (its own session).
- Log in with your own account (it must be in the `portfolio-tracker` group) or with the test user.
- Stop `sst dev` when you're done: it holds `dev`'s lock and blocks every deploy to `dev`.

## Check a change in the browser

**Claude in Chrome** (the browser extension, `mcp__claude-in-chrome__*` tools) lets Claude drive your own Chrome, with your own login:

1. Run the app (`npm run dev -- --stage dev`) or deploy dev. Use prod only to look, never to try out edits.
2. Claude opens the page in a **new tab**, logs in if needed, clicks through the changed view and takes screenshots; the console log (`read_console_messages`) shows runtime errors.
3. Check desktop width and phone width (390 px) for anything that changes layout.

The app uses no native `alert`/`confirm` dialogs (deletes confirm in-page), so the extension isn't blocked by one.

Without the extension, a throwaway Playwright spec against the deployed stage does the same for screenshots (log-in state from the E2E global setup):

```sh
WEB_URL=https://dev.portfoliotracker.albedoonline.com npx sst shell --stage dev -- npx playwright test -c packages/web/playwright.config.ts <spec>
```

Put such probes and screenshots in `temp/<subfolder>/`, not in `packages/web/e2e/`.

## Tests

| Kind | Command |
|---|---|
| Type check | `npm run typecheck` |
| Unit (Vitest) | `npm test` |
| Integration (API) | `npx sst shell --stage dev -- npm run test:integration` |
| E2E (Playwright) | `WEB_URL=https://dev.portfoliotracker.albedoonline.com npx sst shell --stage dev -- npm run test:e2e` (without `WEB_URL`: http://localhost:5173) |

- Integration and E2E tests seed the stage with the sample data (`data/instruments.json`, `data/transactions.sample.json`).
- Test user: `portfolio-tracker-test@albedoonline.com`, group `portfolio-tracker-test` (accepted on `int` and `dev` only; prod returns 403), password in the SST secret `TestUserPassword` of `dev` and `int`.

## Delivery

`.github/workflows/continuous-delivery.yaml`, per the standard: deploy `int`, integration and E2E tests against it, tag the next release, deploy `prod` from the tag. Releases are `v0.N` and show in the page footer. Rollback or redeploy: run it manually from the release tag ("Use workflow from", or `gh workflow run continuous-delivery.yaml --ref v0.153`): that tag goes to `int`, through the tests, then to `prod`, without a new version; data isn't rolled back. Works for `v0.153` and later (older tags don't have this workflow). A new leading number, only when asked: `--ref main -f major=true`. Watch runs at https://github.com/jakubprzybytek/PortfolioTracker/actions.

Dependencies: Dependabot (alerts, security updates, `.github/dependabot.yml`) opens PRs; `.github/workflows/pull-request-checks.yaml` checks every PR (typecheck, unit tests, web build, registry signatures). They are handled per the [dependabot standard](https://github.com/jakubprzybytek/agent-playbook/blob/main/skills/dependabot/STANDARD.md).

Ask before pushing changes that touch data, resources holding data, access or cost ([the standard, section 5](https://github.com/jakubprzybytek/agent-playbook/blob/main/skills/continuous-delivery/STANDARD.md#5-when-a-push-needs-a-yes-first)). For this app that includes:

- rewriting or removing transactions, holdings or market history on prod, re-imports, and backfills that overwrite;
- changes to the shared Cognito pool's clients or groups.

## Deviations

- `continuous-delivery.yaml` has no `paths-ignore` for docs-only pushes: a doc change is released like any other.
- This file is `Docs/Development.md` (the repo's `Docs/` folder) instead of `docs/development.md`.
