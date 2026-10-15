# Non-functional review (v0.63, 2026-10-15)

A review of the app as built against the usual non-functional requirements: observability, resilience, performance and cost, security, durability, maintainability. Based on reading `sst.config.ts`, every handler and source client, the repository layer, the web app, the CI workflow, the deploy policy, the tests and the docs, plus SST's component defaults for what the config leaves implicit (`.sst/platform/src/components/aws/*`).

**Overall:** for a single-user serverless app it is in good shape: pure, tested core; idempotent jobs; FIFO-serialised valuation with a dead-letter queue; per-function table links; OIDC-based CD with int → tests → prod; SRP login + JWT authorizer + group gate; raw-file archive; monthly backup; docs that are an actual design record. The gaps are the last 10 %: nobody is told when something breaks, outbound HTTP can hang, a few hot paths read whole partitions, and the infra doesn't match two claims in the docs.

## Top 10, by value ÷ effort

| # | Finding | Area | Effort |
|---|---|---|---|
| 1 | No alerting at all: failed jobs, DLQ messages and Lambda errors only show on the Dashboard | Observability | S |
| 2 | Every outbound `fetch` (Yahoo, BiznesRadar, onvista, obligacje.pl, NBP, GUS, MF) has no timeout; only the GPW client does | Resilience | S |
| 3 | ~~`data-storage.md` says deletion protection is on for the prod tables; `sst.config.ts` never sets `deletionProtection`~~ Done (2026-10-15): on for all three tables on prod | Durability | XS |
| 4 | ~~`GET /status` reads *every* job run of 13 jobs (90-day TTL, no `Limit`) and the UI polls it every 5 s during a recalc~~ Done (2026-10-15): `latestJobRun`, one item per job (also in `POST /prices/refresh`) | Performance | XS |
| 5 | ~~`GET /instruments` does an N+1 `getBackfillStatus` per instrument~~ Done (2026-10-15): one `BatchGet` (`listBackfillStatuses`) | Performance | XS |
| 6 | ~~500 responses echo `err.message` to the browser; a malformed JSON body becomes a 500, not a 400~~ Done (2026-10-15): a generic 500 with the request id (the detail in the log); a body that isn't JSON is a 400 | Security / API hygiene | XS |
| 7 | The CI deploy role has `dynamodb:*`, `s3:*`, `lambda:*`, `iam:PassRole` on `*` | Security | M |
| 8 | No CSP / security headers on the site while the tokens (incl. the 30-day refresh token) sit in `localStorage` | Security | S |
| 9 | One 835 KB JS chunk, no code-splitting, no `ErrorBoundary` | Front-end | S |
| 10 | No linter, no Dependabot/Renovate, GitHub Actions pinned by major tag only | Best practice / supply chain | S |

## 1. Observability

**As built:** `runJob` (`packages/jobs/src/lib/context.ts`) records a `JOB#/RUN#` item per run with status and note and logs the result; the Dashboard shows the last run of each job and a banner for failures; Lambda logs and API Gateway access logs are kept one month (SST defaults). Each job's note is informative (counts, date ranges, per-instrument failures).

**Gaps**

- **No alerting.** `ingestion.md` acknowledges it (README item 16). Missing: a CloudWatch alarm on each function's `Errors` (or one on `AWS/Lambda` `Errors` summed over the app), an alarm on `ValuationDeadLetter` `ApproximateNumberOfMessagesVisible > 0`, and an alarm on the *absence* of success (e.g. `valuation` hasn't written a snapshot for 30 h — a silent EventBridge Scheduler misconfiguration would otherwise go unnoticed). SNS → e-mail is enough: `sst.aws.SnsTopic` plus `aws.cloudwatch.MetricAlarm` resources.
- **Logs are free text, no correlation.** `console.log(\`${job}: ok\`, …)` is fine for grep, but API errors are logged without the request id (`api.ts`, the `catch`), and a valuation run logs its `reason`/`from` only at the end. Cheap fix: `logging: { format: "json" }` on the functions, one structured line at job start and end, `event.requestContext.requestId` on API errors.
- **The Dashboard job list is hand-maintained:** `api.ts` (`GET /status`) hard-codes the 13 job names; a new cron without an entry there is invisible. Derive the list from a constant shared with the `runJob` callers.
- **DLQ'd valuations are invisible after the next success.** A message that fails 3× lands in the DLQ; the Dashboard shows the failed run, but a later successful scheduled run hides that an earlier *range* was never revalued. Surface the DLQ depth in `/status`.
- **No per-source metrics.** Source outages (Yahoo blocking, a BiznesRadar layout change) are the most likely failure class. A custom metric per source (rows written, instruments failed; CloudWatch EMF) would make "Yahoo returned 0 rows for 3 days" alarmable; today it is a note string.

## 2. Resilience and reliability

**As built:** idempotent upserts everywhere; look-back repair windows; retries 2 on the crons; FIFO valuation queue with one group, 16-min visibility vs the 15-min timeout, DLQ after 3; `BatchWrite` retries unprocessed items with backoff (`repository.ts`); the GPW client has a timeout and retries (`core/src/gpw/archive.ts`); `live` and `coupons` tolerate per-instrument failures.

**Gaps**

- **Unbounded outbound HTTP.** `yahoo.ts`, `biznesradar.ts`, `onvista.ts`, `obligacjePl.ts`, `nbp.ts`, `gus.ts`, `mfPage.ts`, `mfRetail.ts` all call `fetch()` without `AbortSignal.timeout(…)`. A hung connection eats the whole 5-min (backfill: 15-min) Lambda, then the 2 retries repeat it; `live` (3-min timeout) hangs "Refresh prices" and the UI's 5-min guard. One shared `fetchWithTimeout(url, init, 20_000)` in `lib/` fixes every call site.
- **`coupons` fails the whole run if one bond fails** (`coupons.ts`), so Lambda's retries re-scrape every bond, including those that succeeded. Record the failures in the note and return `ok` with a partial flag, or throw only when *all* failed (as `live` does).
- **`import` processes all S3 records in one `runJob`** (`import.ts`): one bad file fails the batch and the async retries re-import the good files (idempotent, so safe, but noisy). A per-key `try/catch` with a note would do.
- **Full revaluations are sequential per day** (`valuation.ts`): snapshot put, position-days batch, optional delete — about 3 round trips a day (since 2026-10-15 only for days that changed: an unchanged day is compared with the stored snapshot and not written, which cut the write cost of a full run from ~64k units to the days that actually moved). An `import`-reason run starts at the first transaction (years): ~2,500 days × ~30 ms ≈ 1–2 min, fine today, but linear in history; the snapshot item also grows with the holdings array (400 KB item limit; ~30 positions is far from it). The price and coupon loads before the loop are sequential per instrument too; `Promise.all` there is free.
- **The `live` throttle is read-after-write racy** (`api.ts`, `POST /prices/refresh`): two quick clicks can both pass the 5-min check before the job writes its run item. Harmless for one user.
- **Backup and restore:** the monthly export goes to the *same* bucket and account as the live data; the `Files` bucket has no versioning (SST default off) and no lifecycle rule. PITR (35 days) on `market` and `transactions` covers the main risk, but an accidental `aws s3 rm` or a compromised deploy role could lose the live data and the backups in one go. Enable versioning, add a lifecycle rule (raw archive → Glacier Instant Retrieval after 90 days; keep the exports), and consider a quarterly copy of `exports/` to another account or bucket.
- **Deletion protection** is missing (see 5).

## 3. Performance and cost

Scale is tiny (hundreds of transactions, ~30 positions), so nothing here is urgent; these are the places that are structurally wrong and will show first.

- **`/status` reads whole partitions.** `repository.ts` `listJobRuns` has no `Limit`; `valuation` runs many times a day and the items live 90 days, so `/status` is 13 queries returning hundreds to thousands of items, serialised, just to take `[0]`. `App.tsx` polls it every 5 s for up to 5 min after every save. Add `Limit: 1` (a `latestJobRun` method); `POST /prices/refresh` has the same pattern.
- **`GET /instruments` N+1:** one `GetItem` per instrument for the backfill status. Query `INST#<isin>` once (`META` and `BACKFILL` share the PK) or batch-get.
- **`findTransaction` uses a `FilterExpression` over the account's partition** (`repository.ts`): it reads every transaction of the account to find one id. The UI knows the date; pass it (`?account=&date=`) and do a `GetItem` on `TX#<date>#<id>`, or add the id to a GSI.
- **Every read endpoint re-lists all transactions** (`/accounts`, `/portfolio/history`, `/transactions`, `/instruments/{isin}/transactions`, `/instruments/{isin}/coupons`): the `GSI1PK = "TX"` partition grows with history. At 10× the data it is still fine; at 100× per-ISIN queries (a sparse `GSI2PK = ISIN#…`) would be wanted.
- **The API Lambda bundles SheetJS.** `api.ts` imports from `import.ts`, which imports `parseMfCalculator` → `xlsx` (~1 MB), so every API cold start carries it although the API never parses a spreadsheet. Move `mfTermsByCode`/`importInstruments` into a module without the XLS parsers, or lazy-`import()` them.
- **Lambda architecture defaults to `x86_64`.** Everything is pure JS; `architecture: "arm64"` in `defaults` is ~20 % cheaper and usually faster for Node.
- **No HTTP caching.** API responses carry no `Cache-Control`; the SPA re-fetched `/holdings`, `/accounts`, `/status`, `/instruments` on every view switch; since 2026-10-15 `useApi` keeps them in an SWR cache (shown at once, refetched in the background, deduplicated within 2 s), so what's left is the HTTP side. `GET /holdings` could carry an `ETag` of `computedAt`, so a refetch of an unchanged snapshot is a 304.
- **Front-end bundle:** one 835 KB JS chunk; Amplify, Recharts and all five views load before the login form renders. `React.lazy` per view and Recharts behind the chart panels would roughly halve the first paint on a phone. No `manualChunks`, so every deploy invalidates vendor code too.
- **Cost guardrails:** no AWS Budget alarm. The design is near-free, but a retry loop against on-demand DynamoDB is the kind of thing a $5 budget alarm catches.

## 4. Security

**As built:** SRP login, no client secret, no hosted UI or OAuth flows, `preventUserExistenceErrors`, token revocation, 1 h access tokens, `USER_PASSWORD_AUTH` only off prod; API Gateway JWT authorizer with `audiences: [webClient.id]`; group check on every call (`access.ts`); the test user kept out of the prod group; zod validation of every write body; ISIN regex on path parameters; IAM per function through links; S3 public access blocked; the account number kept out of the public repo; OIDC (no long-lived keys); `npm audit` clean; `xlsx` vendored from SheetJS's CDN (the npm `xlsx` 0.18 line has unpatched CVEs).

**Gaps**

- **Error leakage:** the API's `catch` returns `err.message` for any exception (table names, zod internals). Return a generic 500 and log the detail. Related: `bodyOf` throws on malformed JSON → 500 instead of 400.
- **No security headers.** The CloudFront Router sets none: no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. The app has no `dangerouslySetInnerHTML` and React escapes by default, so the XSS risk is low — but the tokens live in `localStorage` (`auth.ts`), including a 30-day refresh token, so one XSS is 30 days of access. A CSP (`default-src 'self'; connect-src 'self' https://cognito-idp.eu-west-1.amazonaws.com …`) is the cheap mitigation, attached as a CloudFront response-headers policy through the Router's `transform`. Alternatively shorten the refresh token to 7 days.
- **CORS is `*`** (`cors: true` → `allowOrigins: ["*"]`). With bearer tokens this isn't exploitable, but there is no reason for it: the site is same-origin behind the Router; only `sst dev` (localhost) needs CORS. Set `allowOrigins` to the stage domain plus `http://localhost:5173`.
- **The direct API Gateway URL stays reachable** (`apiGateway` output). Auth still applies; it only bypasses anything added at CloudFront later (WAF, headers). Acceptable; noted.
- **The CI role is over-broad** (`infra/github/deploy-policy.json`): `dynamodb:*` and `s3:*` on `*` let a compromised Actions run (a malicious dependency or action) read or delete every table and bucket in the account, including the prod transactions and the backups; `iam:PassRole`/`CreateRole` on `*` allows privilege escalation. The README explains the 6 KB managed-policy limit; the fix is resource scoping, not action trimming: `arn:aws:dynamodb:eu-west-1:ACCOUNT:table/portfolio-tracker-*`, `arn:aws:s3:::portfolio-tracker-*`, the `iam:*Role*` actions on `arn:aws:iam::ACCOUNT:role/portfolio-tracker-*`, `PassRole` with an `iam:PassedToService: lambda.amazonaws.com` condition. Consider two roles (int, prod) bound to the GitHub `environment` claim, so a run for `int` can't touch prod.
- **Supply chain:** `cd.yml` pins actions by major tag (`@v7`), not by SHA; no Dependabot/Renovate; `npm ci` with the lockfile is good. The SST platform is downloaded at deploy time (`.sst/platform`) — inherent to SST.
- **Shared Cognito pool with open sign-up, MFA off** (`ui.md`, "Access"). The group gate holds, but any user who lands in `portfolio-tracker` by mistake has full read/write of the one portfolio. MFA (TOTP) can be enabled per user without changing the pool default; worth it for financial data.
- **No audit trail of edits.** `PUT /transactions` overwrites, `DELETE` removes; PITR covers disasters, not "what did I change last Tuesday". A `TXLOG#` item or `updatedAt`/`updatedBy` fields are cheap. Low priority for one user.
- **Input validation edges:** the `from`/`to` query strings aren't validated as dates (they go into `BETWEEN` as raw strings — harmless, returns nothing); `account` from the query is interpolated into a PK (`ACCT#…`, `POS#…`) — no injection is possible in DynamoDB, but validate it with the same pattern the zod schema uses.
- **Scraping:** the User-Agents identify the app and personal use; the delays are polite. Yahoo's and onvista's APIs are unofficial; the EODHD fallback is documented, and the raw archive means a block doesn't lose history.

## 5. Durability and data integrity

- **Deletion protection:** `protect: true` in `app()` only stops `sst remove`; the tables have no `deletionProtection`, although `data-storage.md` says they do on prod. One line in the `withPitr` transform: `args.deletionProtectionEnabled = $app.stage === "prod"`. `removal: "retain"` on prod is set.
- `Files` bucket: no versioning, no lifecycle, backups co-located with the live data (see 2).
- PITR on `market` and `transactions`, not on `holdings` (correct: derived).
- `putSnapshot` writes the dated item, then `LATEST`; if the second put fails the day exists but `LATEST` is stale until the next run — SQS retries the message, so fine.
- Transaction ids are content-derived for imports and random for the app, so re-importing a backup is a no-op. Good.
- The valuation reads the data as it is when it starts and never reads its own output except the `before` map; ordering is guaranteed by the single FIFO group.

## 6. Best practices and maintainability

**Strong:** `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `erasableSyntaxOnly`; a pure core with ~200 tests across unit, integration and E2E; fixtures for every scraper; CI gates prod on real deployments; the docs are a design record with an outstanding-work list.

**Gaps**

- **No linter or formatter.** No ESLint/Biome/Prettier config in the repo; the code is consistent, but nothing enforces it in CI. Biome is one dependency and one CI step.
- **No `ErrorBoundary`** in the web app: a render error in any view blanks the page without a message; `useApi`'s error path covers fetch errors only.
- **`api.ts` is a 250-line `switch`** with validation, data access and shaping inline. Readable, but every route grows it; a route map with shared `parseIsin()`/`parseDate()` helpers would also make the validation gaps above systematic rather than per case.
- **`queueValuation` casts `Resource`** to reach `ValuationQueue.url`; the cast hides a missing link until runtime, where the generated `sst-env.d.ts` would have typed it.
- **Doc drift:** `data-storage.md` (deletion protection) vs the infra; `ingestion.md` says a job run ends with "alert on failure", which isn't built (the file says so further down). Worth marking "as built" vs "planned" since the docs are otherwise trusted.
- **Tests:** no coverage report; E2E `retries: 0` means one flaky Playwright run blocks a release (a deliberate trade-off, fine while the suite is fast). The integration tests seed the stage from fixtures with nothing stopping `sst shell --stage prod`: the test user has no prod group, so the API calls would 403, but `uploadImport` writes straight to the bucket and the import Lambda would ingest the sample transactions into prod. Add a guard on `Resource.App.stage` in `setup.ts`.
- **Secrets:** `TestUserPassword` is an `sst.Secret`; nothing sensitive in the repo (`.gitignore` covers `data/private/`, `infra/github/private/`, `Research.md`).
- **Dependencies:** all within a patch of the latest except `@types/node` (24 → 26, intentional with Node 24); `npm audit` clean.

## 7. Other

- **Availability, RPO, RTO:** no SLO stated; implicit RPO = one day (nightly valuation; transactions are immediate), RTO = redeploy + restore from the export (`data/README.md`). Write the two numbers down and test a restore once on `dev`.
- **Accessibility:** semantic nav with `aria-label`, `aria-current`, `aria-expanded`, `role="alert"`/`"status"` toasts, labelled inputs, Escape handling — above average. Not checked: colour contrast of the gain/loss colours, and chart-only information (no table alternative for the portfolio chart).
- **Privacy:** one person's financial data in eu-west-1; logs carry counts and instrument codes, not amounts; access logs carry the Cognito `sub` only.
- **Portability:** SST + DynamoDB are AWS-specific; `core` is cloud-free; the raw archive and the monthly JSON export keep the data portable.
- **Time zones:** every cron is in `Europe/Warsaw`; `today()` in the Lambdas — check whether it is Warsaw- or UTC-based (the API allows a value dated a day ahead "UTC vs the user's clock", which suggests UTC). The 22:30 and 07:30 runs are on the same date either way; a unit test at the DST edges would settle it.

## Suggested order of work

1. ~~**Day 1 (XS each):**~~ **Done (2026-10-15):** `deletionProtection` on the prod tables · `Limit: 1` in `listJobRuns` · batch the `BACKFILL` lookups · generic 500 and a 400 on bad JSON · CORS origins (the stage's domain, plus `http://localhost:5173` off prod) · `arm64`.
2. **Week 1 (S):** shared `fetch` with a timeout · SNS topic + alarms (Lambda errors, DLQ depth, valuation staleness) · structured JSON logs · bucket versioning + lifecycle · CSP/HSTS response headers · Biome in CI · Dependabot · actions pinned by SHA · `ErrorBoundary` + `React.lazy` views · a prod guard in the integration setup.
3. **Later (M):** scope the deploy policy by resource and split the int/prod roles · per-user TOTP MFA · route map refactor of `api.ts` · `GetItem` path for `findTransaction` · XLS parsing out of the API bundle · an audit log of transaction edits.
