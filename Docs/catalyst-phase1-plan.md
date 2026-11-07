# Catalyst phase 1: implementation plan

Status: plan (2026-11-06). Phase 1 of the [Catalyst module](catalyst.md): the whole Catalyst bond market with daily data, browsing and filtering, yield to maturity against an alternative, risk premium over treasury bonds, and liquidity. No issuers, scorecard, CLI or agent (phase 2).

Each milestone is a release: it goes through the usual delivery (int → tests → tag → prod, [Development.md](Development.md)) and leaves the app working. Milestones marked **⚠ approval** create resources holding data or write data on prod: ask before pushing them (Development.md, "Delivery").

## Contents

- [Decisions this plan makes](#decisions-this-plan-makes)
- [Code layout](#code-layout)
- [Phase 0: preparation](#phase-0-preparation)
- [Milestones](#milestones)
  - [M0 Checks before building](#m0-checks-before-building)
  - [M1 Skeleton ⚠](#m1-skeleton--approval)
  - [M2 Daily file](#m2-daily-file)
  - [M3 Backfill of the archive ⚠](#m3-backfill-of-the-archive--approval)
  - [M4 Quotes and the monthly export](#m4-quotes-and-the-monthly-export)
  - [M5 Terms](#m5-terms)
  - [M6 Metrics](#m6-metrics)
  - [M7 API and the Bonds view](#m7-api-and-the-bonds-view)
  - [M8 Side by side with CatalystViewer ⚠](#m8-side-by-side-with-catalystviewer--approval)
- [Tests](#tests)
- [Risks](#risks)
- [Done when](#done-when)

## Decisions this plan makes

Details the design leaves open, settled here (the design doc is updated where it differs):

| Topic | Decision | Why |
|---|---|---|
| Infrastructure | `infra/catalyst.ts`, a function called from `sst.config.ts` with what it shares (files bucket, alerts topic, API, authorizer, defaults) | Keeps the module's resources in one place; `sst.config.ts` stays PT's |
| Job runs | In the `catalyst` table (`JOB#…/RUN#…`), not in `market`. `runJob` gets the store to write to; `JOBS` (`jobs/lib/jobs.ts`) lists the Catalyst jobs with `module: "catalyst"`, so the Status page and the watchdog read each job's runs from its own table | Catalyst functions never get write access to `market`; one Status page for everything |
| Access to PT's `market` | No `link` (it grants every action). IAM statements limited to `Query`/`GetItem` on the `SERIES#…` and `CPI…` keys (`dynamodb:LeadingKeys`), as the spreadsheet feed does | Read-only, only the keys it needs |
| Repository | `core/src/catalyst/repository.ts` (`CatalystRepository`), its own item types in `core/src/catalyst/items.ts`; PT's `Repository` unchanged | Module boundary |
| Functions | `CatalystApi` (routes `/catalyst/*` on PT's API), `CatalystWorker` (queue consumer: metrics, backfill), one function per scheduled job | As PT: one handler per job |
| Queue | `CatalystQueue` FIFO, one message group, content-based deduplication, visibility timeout 16 min, `CatalystDeadLetter` after 3 failures (14 days) | Design, "How jobs run" |
| Raw archive | `raw/catalyst-daily/…`, `raw/catalyst-quotes/…`, `raw/catalyst-terms/…` in the files bucket (90 days → Glacier IR as all `raw/`) | As PT |
| User agent | `portfolio-tracker (personal use)`, as PT's other clients | Honest, not on any blocked list |
| Yield engine | The cash-flow and IRR parts of `holdsell/holdSell.ts` (`irr`, the flows of a fixed or floating bond from its periods) moved into `core/bonds/yield.ts` without changing behaviour; Buy, hold or sell and Catalyst both use it | One yield calculation; the Buy, hold or sell tests guard the move |
| Block trades | Session trades only (the `instrumenty` sheet); block trades (`transakcje pozasesyjne`) stored on the session (`blockVolume`, `blockTurnover`), not in the liquidity measures | A block trade says little about what a small order can do |
| Bid/ask backup | The monthly export also writes the month's bid/ask (they can't be rebuilt) | Cheap; PITR covers only 35 days |

## Code layout

```
infra/catalyst.ts                         table, queue, functions, schedules, routes, IAM, alarm
packages/core/src/catalyst/
  items.ts                                BondItem, SessionItem, ScreenItem, CurveItem, settings (types + key builders)
  repository.ts                           CatalystRepository
  dailyFile.ts                            parser of the daily statistics file (xlsx and xls)
  quotesPage.ts                           parser of the quotes pages
  terms.ts                                coupon type, base rate, margin from the terms text; amount owed
  curve.ts                                treasury curve (DS/PS/WS/OK yields, interpolation; WZ discount margins)
  liquidity.ts                            liquidity measures and level
  screen.ts                               a screen row from a bond, its sessions, periods, the curve and the assumptions
  assumptions.ts                          zod schema and defaults (WIBOR, WIRON, commission, tax, alternative)
packages/core/src/bonds/yield.ts          moved from holdSell.ts (flows, irr)
packages/jobs/src/catalyst/
  context.ts                              catalystRepo, queueCatalyst(), archive helpers
  gpwCatalyst.ts                          HTTP client: daily file by date, quotes pages
  handlers/daily.ts, quotes.ts, terms.ts, worker.ts, export.ts, api.ts
packages/web/src/catalyst/
  CatalystView.tsx, BondsTable.tsx, BondFilters.tsx, BondPanel.tsx, YieldChart.tsx, CatalystSettings.tsx, api.ts
scripts/catalyst-backfill.ts              queues date ranges (run with `npx sst shell --stage …`)
scripts/catalyst-compare-cv.ts            M8: compares with CV's tables
```

## Phase 0: preparation

Changes to PT's shared code, done before the milestones so they only add new code. Each is a release with no new resources and no data change. Order: P7, P1, P3, then P2, P4, P6.

| # | Change | Status |
|---|---|---|
| P1 | Yield calculation (bond cash flows, `irr`) moved from `holdsell/holdSell.ts` to `core/bonds/yield.ts`, behaviour unchanged | Done 2026-11-06 |
| P2 | Job runs in more than one table: `runJob`, `JOBS`, the watchdog and `GET /status` know each job's store | Done 2026-11-06: `JobRunStore` (`core/db/jobRuns.ts`), `JobTable` and `jobTable()` in `jobs.ts`, `jobRuns(job)` in `context.ts` |
| P3 | One polite fetch helper in `jobs/lib/http.ts`: one user agent, a pause per site, timeouts | Done 2026-11-06: `fetchSource` (`USER_AGENT`, `POLITE_INTERVAL_MS`), used by every source client |
| P4 | Shared parsers of the Catalyst daily statistics file and quotes pages in `core/gpw/` (PT may use them without importing the module) | Done 2026-11-06: `parseCatalystDailyFile` (both layouts), `parseCatalystQuotes` |
| P5 | PT's corporate-bond backfill stops reading BiznesRadar's paged history (disallowed by its robots.txt), older history from the daily file | **Deferred** (owner, 2026-11-06) |
| P6 | Sortable columns in `StickyTable` (header click, sort in the URL) | Done 2026-11-06: `SortTh` and `sort.ts` (`sort=<column>` / `-<column>`, empty values last, Polish order); used by Prices. Holdings not yet (its grouped rows need their own rule) |
| P7 | M0's checks and the fixtures (`packages/core/test/fixtures/catalyst/`) | Done 2026-11-06: findings in [catalyst.md](catalyst.md#checked-2026-11-06) |

## Milestones

### M0 Checks before building

Done in phase 0 (P7); findings in [catalyst.md](catalyst.md#checked-2026-11-06). Item 5 (WZ margins) moved to M5: obligacje.pl blocks AI assistants, so it's checked by the terms job on dev, not by an agent. No deploy. Findings go into `Docs/catalyst.md` (data sources).

1. **Archive formats.** Download one file per year 2020–2026 (`.xls` before the switch, `.xlsx` after; find the switch date) into a scratch directory; compare the `instrumenty` headers and segment rows. Done when every year's layout is known and the parser's header lookup covers them.
2. **Quotes pages.** Compare today's six pages with CV's fixtures (`CatalystViewer/tests/fixtures/sources/gpwcatalyst/`); note the session date's place on the page.
3. **gpwcatalyst.pl robots.txt** and terms of use: the daily file and quotes pages allowed for a script.
4. **Treasury rows in the file:** DS/PS/WS/OK/WZ present with rate, maturity, close; the OK (zero-coupon) and WZ rows' rates.
5. **WZ margins:** obligacje.pl pages of two WZ series (margin 0 expected for recent series).
6. **From Lambda:** reachability of gpwcatalyst.pl is checked on dev in M2 (first run); if it hangs, stop and decide on a fallback before M3.

### M1 Skeleton ⚠ approval

New resources holding data: the table and the queue.

**Done 2026-11-06.** As below, with: job runs of `catalyst-metrics` and `catalyst-backfill` (on demand) for now, the scheduled jobs register with their milestones (a job in `JOBS` with a maximum age that never ran would make the watchdog fail); PT's watchdog and API read the Catalyst job runs with a `JOB#*`-only Query permission and the table's name (`CATALYST_TABLE`), not a link; the worker merges a batch's metrics requests instead of SQS deduplication (catalyst.md, "How jobs run"); the module's core code is imported as `@portfolio/core/catalyst/index`, never through PT's index.

- `infra/catalyst.ts`: table `Catalyst` (PK/SK, GSI1, TTL `ttl`, PITR, deletion protection on prod), `CatalystQueue` + `CatalystDeadLetter`, `CatalystWorker` subscribed (batch 1), `CatalystApi` with `GET /catalyst/status` (counts, last runs), the dead-letter alarm on prod; called from `sst.config.ts`.
- `core/src/catalyst/items.ts`, `repository.ts` (put/get/query, batch writes with retry of unprocessed items).
- `runJob` takes the job-run store; `JOBS` entries for `catalyst-daily`, `catalyst-quotes`, `catalyst-terms`, `catalyst-metrics`, `catalyst-backfill`, `catalyst-export` (`module: "catalyst"`, max ages); watchdog and `GET /status` read each from its table.
- Web: "Catalyst" in the menu (`route.ts` view `catalyst`), an empty view with "No data yet".
- Tests: unit (keys, repository with a fake client), integration `GET /catalyst/status` (401 without login, 200 with the test user).

Done when: deployed to prod, the view shows, the Status page lists the Catalyst jobs as "never run", nothing alerts.

### M2 Daily file

**Done 2026-11-06.** gpwcatalyst.pl answers from Lambda (eu-west-1). The job loads every session of the last 5 not loaded yet (a `DAYS/<date>` item marks a loaded one), oldest first; the planning is pure (`core/catalyst/daily.ts`, `planDailyFile`). First run on dev: 2026-10-30 – 11-05, 932 bonds, ~1,050 rows a session, 19 s; a missing file is a 302 (fetched with `redirect: "manual"`).

- `dailyFile.ts`: reads both formats, finds the header row and columns by name (Polish/English labels), the segment from the rows without an ISIN, one record per ISIN and market; values `---` → null; turnover from thousands; fails loudly on a missing column. Also the off-session sheet.
- `gpwCatalyst.ts`: `fetchDailyFile(date)` (xlsx, then xls; 302 = no file for that day).
- `handlers/daily.ts`: the last session's file (look back up to 5 trading days, `settlement.ts` holidays), archive raw, upsert bonds (new: `listed`, `firstSeen`; present: current nominal, maturity, rate; markets merged per ISIN), write sessions, mark `ended` the listed bonds absent from the file (`lastSeen`, last close), then queue `{ kind: "metrics" }` (a no-op until M6). Idempotent: re-running a day rewrites the same items.
- Schedules: 21:00 Mon–Fri (moved from 18:30 on 2026-11-06: GPW publishes the file between about 19:00 and 20:00), recheck 08:00 Tue–Sat (`retries: 2`).
- Tests: parser on the 2026 xlsx fixture and a 2020 xls fixture (rows, segments, a treasury, a municipal, an EUR bond, a bond without trades: close = reference, `traded` false); the handler with a fake repository (new, changed, ended).

Done when: on dev a week of runs gives ~1,060 bonds and their sessions; the counts match the file's `statystyka` sheet per segment.

### M3 Backfill of the archive ⚠ approval

**Dev done 2026-11-06:** 2020-01-02 – 2026-11-05, 1,716 sessions in ~70 min (20-session ranges of ~40 s), 1,769 bonds (931 listed, 838 ended). Checks: KRU0228's nominal 1000 → 850 → 700 → 550 over its instalments, IZ0831 at its indexed nominal, the GetBack bonds ended in 2020–21, recent listings present. One file in the archive is another session's: `catalyst_20250625.xls` repeats 2025-06-24 (same figures), so that session is missing; such a file is skipped and noted, nothing written under the wrong date. Only the newest session lists a bond (backfilled days never change a stored status), so ranges queued again out of order can't mislabel one; a range that fails is recorded and the rest of the batch goes on.

About 1,500 files, ~1.6M items (≈ $2 of writes) into the new table: no PT data touched, but a bulk write on prod.

- `worker.ts` handles `{ kind: "backfill", from, to }`: for each trading day in the range, the file (2 s between downloads), archive, sessions and bonds (a bond's `firstSeen`/`lastSeen` and exit from the history); writes in batches. A range of 20 trading days per message (~1 min).
- `scripts/catalyst-backfill.ts --from 2020-01-02 --to <yesterday>`: queues the ranges; prints the count.
- Order: newest first, so the liquidity window is complete first.
- Bonds that ended before today get `status: "ended"` with their last session and last close (the exit reason comes in phase 2).
- Tests: the worker on two fixture days; a range with a holiday and a missing file.

Done when: dev holds the full history; spot checks of 5 bonds (an amortising one, an IZ, an EUR bond, an ended one, a new listing) against the files; then prod, after approval; the dead-letter queue empty.

### M4 Quotes and the monthly export

**Done 2026-11-06, without the export.** Quotes are their own items (`Q#<date>#<market>`), not fields of the session: at 17:20 the day's file isn't loaded yet. The morning run is at 07:45 (before the pre-opening, when new orders could appear) and only fills a session the evening missed (`QUOTEDAYS/<date>`). Codes on the pages can carry up to two marker letters (" /S", " /K", " /W" …), stripped to match the daily file. The export moves to M7, when there are settings to back up: the quotes pages are archived raw (versioned bucket) and can be parsed again. On dev: 931 rows, 256 with a bid or an ask, 14 s.

- `quotesPage.ts`: the six segment pages, read by position as CV does, checked by the count of cells per row; the session date from the page.
- `handlers/quotes.ts` at 17:20 Mon–Fri and 08:30 Tue–Sat: archive, then bid, ask, their volumes and order counts into the session item of the page's date (only when that session exists or the date is the latest trading day; otherwise the run notes it and writes nothing).
- `handlers/export.ts` (1st of the month 04:30): settings and saved views (once there are any), and the month's bid/ask as JSON lines, to `exports/<date>/catalyst/`.
- Tests: parser on CV's six fixtures; a page whose date isn't the expected session.

Done when: a week on dev with bid/ask on the sessions; the morning run's failure alerts (prod).

### M5 Terms

**Done 2026-11-06.** Terms are their own item (`BOND#<isin>/TERMS`, listed on the index as `TERMS`): the daily job rewrites the bond item. 150 pages a run (~5 min), corporate first, municipal last, treasury only WZ/NZ; floating bonds read again a week into a new period. Read so far on dev (444 bonds): issuer, series, issue value with its nominal, security (TAK/NIE), the coupon (WIBOR 3M/6M, EURIBOR, POLSTR, fixed), the periods. **WZ margins are 0** ("zmienne WIBOR 6M + 0%", every series); the NZ series pay **POLSTR 6M + 0%**. A page whose date lists don't add up (17 of 444, e.g. 13 record days for 12 periods) keeps its other terms without periods (`periodsProblem`, read again in a month); a code whose page is another bond's (GRU1138) is recorded as not found. The prod backfill (M3) ran the same day: 1,716 sessions, 931 listed and 838 ended bonds, in 58 min.

- `handlers/terms.ts` at 09:30 Mon–Fri: obligacje.pl (`jobs/lib/obligacjePl.ts`, extended for issue value, coupon text and issuer name), at most 40 bonds a run, 2 s apart: corporate, municipal, cooperative, bank and covered bonds without terms first, then current rates of floating bonds whose period changed. Writes the bond's `issuerName`, issue value with the nominal on the day it was read, coupon type, base rate, margin, callable (when the page says so) and the coupon periods (`mergePublishedTerms` rules: missing periods added, stored dates and rates kept, the record-day check). Treasury series: terms from the file (fixed: rate and maturity; OK: zero coupon), not fetched.
- `terms.ts`: parses "stałe 7.5%", "zmienne WIBOR 6M + 3.85%", "WIRON 1M + …", zero coupon; amount owed = issue value × current nominal / nominal when read.
- Tests: the two obligacje.pl fixtures plus a WIRON and a zero-coupon page; the coupon text parser on CV's examples.

Done when: on dev all listed non-treasury bonds have terms after ~15 runs (≈ 600 bonds / 40); prod afterwards needs no approval (new items in the module's table, no overwrite).

### M6 Metrics

**Done 2026-11-06.** `core/catalyst/curve.ts` (fixed curve: DS/PS/WS/OK yields from the day's GPW closes and the file's rate, yearly coupons; WZ curve: their price-adjusted margins), `liquidity.ts`, `screen.ts` (yields as Buy, hold or sell computes them; the alternative from `retailOffers`, moved from PT's API into core/holdsell with `nbpRateFromOffers`), `jobs/src/catalyst/metrics.ts` (worker). Assumptions: PT's plus WIRON/POLSTR (default: the NBP rate the ROR on offer implies) and EURIBOR (2 %), in the module's `SETTING#assumptions`. The worker reads PT's retail series with a `SERIES#*`-only GetItem permission. On dev (session 2026-11-05): 931 bonds in 12 s, 428 with a yield (the rest mostly municipal bonds still without terms), 228 with a premium; curve of 22 fixed series (3.3 % at half a year to 6.3 % at 20 years) and 8 WZ (price-adjusted margins 0–0.7 %). Found: obligacje.pl lists some bonds' periods only up to the current one (ARH0227): the missing ones repeat the last period's length to maturity, projected and flagged `periods-extended` (13 bonds). Premiums: median 2.8 pp; Ghelamco's bonds (priced 55–80) 27–59 pp.

- `core/bonds/yield.ts`: move the flows and `irr` out of `holdSell.ts`; Buy, hold or sell's tests pass unchanged.
- `assumptions.ts`: WIBOR 3M/6M, WIRON, commission (default 0,19 %), tax 19 %, alternative (`retail` | `rate`); stored as `SETTING#assumptions`.
- `curve.ts`: yields of fixed-rate treasury bonds (DS, PS, WS: coupon yearly on the maturity's day and month; OK: zero) from the day's closes, sorted by years to maturity, linear interpolation between points (flat beyond the ends); WZ discount margins = margin + (100 − price) / years.
- `liquidity.ts`: over the last 30 and 90 sessions: share traded, median turnover on traded days, trades, median spread (from bid/ask), depth at best bid; level by the design's thresholds; days to sell 10 000 zł.
- `screen.ts`: for one listed bond: yield to maturity gross and net (price = last close + accrued interest to T+2 + commission; flows from the periods, floating ones at base rate + margin; tax on interest and on the gain), yield to the first call when callable, vs alternative (nearest-term retail series from PT's `SERIES#`, or the rate), premium vs gov (fixed: minus the curve; floating: discount margin minus WZ's at a similar maturity; blank for non-PLN or no trade in 90 days), flags (stale, callable, amortising, no terms).
- `worker.ts` handles `{ kind: "metrics" }`: curve of the day, then every listed bond's screen row (one query per bond for its 90 sessions); `PUT /catalyst/settings/assumptions` queues it too.
- Tests: yields against hand-computed cases (a fixed bond, a floater, a bond below par near maturity, an amortising bond), the curve on a fixture day, liquidity on synthetic sessions, the premium for fixed and floating.

Done when: screen rows for all listed bonds on dev; ten bonds checked by hand (yields within 0.05 pp of a spreadsheet calculation); a full run under 2 minutes.

### M7 API and the Bonds view

**Done 2026-11-07.** Routes: `GET /catalyst/bonds` (screen rows with their terms in short, and the curves), `GET /catalyst/bonds/{isin}?from=`, `GET`/`PUT /catalyst/settings/assumptions` (a save queues the metrics), `GET`/`PUT /catalyst/views`; the API reads PT's retail series as the worker does (defaults from the ROR on offer). The monthly export (`catalyst-export`, moved here from M4) writes the assumptions and views. The view: Docs/ui.md, "Catalyst". E2E tests run on a fixed screen through Playwright's request interception (int holds no Catalyst data); integration tests cover the routes. Found on the way: Recharts spreads data fields into the elements it draws, so a series named `ref` broke React (renamed); the panel's tabs shrank away in the panel's flex column (kept their height).

- API: `GET /catalyst/bonds` (screen rows with the bond's fields; ETag as PT's large responses), `GET /catalyst/bonds/{isin}` (bond, periods), `GET /catalyst/bonds/{isin}/sessions?from=`, `GET /catalyst/curve`, `GET`/`PUT /catalyst/settings/assumptions`, `GET`/`PUT /catalyst/views`.
- View `#/catalyst` (design, "UI → Bonds", without the issuer columns: the issuer name as listed, plain text): the table with sticky filters and header (`StickyTable`), sorting by every column, the filters of phase 1 in the URL, chips, "clear filters", "n of m bonds"; saved views; "Columns" for the extra ones; the chart (net yield against years to maturity, curve and alternative as lines, dots by liquidity level until phase 2 adds the dimensions); the row panel (*Price & liquidity*, *Yield* breakdown, *Coupons*); the settings cog (assumptions); placeholders while loading; the phone layout (three-line rows, folded filters).
- Docs: `ui.md` (Catalyst section), `data-storage.md` (pointer to the `catalyst` table), `ingestion.md` (the jobs), `data-sources.md` (the daily file, quotes pages; the robots.txt facts).
- Tests: integration for each route (shapes, 401/403, assumptions validation); E2E: open the view, filter by maturity and nominal, sort by net yield, open a row panel, change an assumption and see the yields change.

Done when: on prod the view lists every listed bond with yields, premiums and liquidity, usable on a phone; checked in the browser on dev first (Development.md, "Check a change in the browser").

### M8 Side by side with CatalystViewer ⚠ approval

The CV import writes CV's bid/ask history into prod sessions.

- `scripts/catalyst-compare-cv.ts` (read-only on both): per bond, PT vs CV: issue value, amount owed, maturity, coupon, YTM (CV's formula differs: compare the trend, list differences over 0.5 pp), average turnover, trading-days ratio, spread. Two weeks of daily comparisons; differences explained or fixed.
- Import of CV's `BondStatistics` bid/ask (2023 →) into the sessions that have none, by a script with `--dry-run`; dev first, then prod after approval.
- Calibrate the liquidity thresholds on the full history; update the design.
- Then phase 1 parts of CV may be switched off (its Bonds Updater schedule): the owner's decision; CV's resources stay until phase 2 is migrated.

## Tests

| Kind | What | Where |
|---|---|---|
| Unit | Parsers (daily file per format, quotes pages, obligacje.pl, coupon text), curve, yields, liquidity, screen rows, repository keys | `packages/core/test/catalyst/`, `packages/jobs/test/unit/catalyst/`; fixtures in `packages/core/test/fixtures/catalyst/` (CV's quotes pages and daily file copied, plus a 2020 `.xls`) |
| Integration | `/catalyst/*` routes; worker messages on `int` | `packages/jobs/test/integration/catalyst.test.ts` |
| Seed | `int`/`dev`: fixture bonds, two weeks of sessions, periods and screen rows written by the integration setup (no source fetched in tests) | `packages/jobs/test/integration/setup.ts` |
| E2E | The Bonds view: filters, sorting, row panel, assumptions, phone width | `packages/web/e2e/catalyst.spec.ts` |

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| gpwcatalyst.pl unreachable from Lambda (seen from PT's dev machine on 2026-10-12) | No data | M0/M2 check first; fallback to decide then (proxyless retry window, another region) |
| GPW's move to WATS changes the file or the pages | Job fails | Header lookup, loud failures, alerts; raw files archived for reparsing |
| Old archive files differ in layout | Backfill gaps | M0 survey; the parser per layout; the worker records ranges it couldn't parse |
| obligacje.pl changes its robots.txt for all bots or its layout | No terms for new bonds | The bond stays listed without yields ("no terms" flag); terms of issue by hand as a later fallback |
| No WIBOR/WIRON fixings | Floating yields depend on an assumption | Shown in the tooltip; the premium for floaters uses the discount margin, which doesn't need it |
| Moving the yield code breaks Buy, hold or sell | Wrong verdicts in PT | Move without behaviour change, its tests unchanged and passing |

## Done when

- Every listed Catalyst bond has daily data, terms, yields, premium and liquidity, refreshed every trading day without manual steps.
- History from 2020 (bid/ask from 2023 with CV's import) is in the table, and its originals are archived.
- The Bonds view answers "which bonds pay well over the safe alternative, trade enough, and fit my nominal and term" on a computer and a phone.
- Jobs are on the Status page, failures alert, the export runs monthly.
- The design doc, data-sources, data-storage, ingestion and ui docs describe what was built.
