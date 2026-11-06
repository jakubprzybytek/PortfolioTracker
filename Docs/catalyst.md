# Catalyst module (design)

Status: proposal (2026-11-05), nothing built yet. It moves the functionality of CatalystViewer (CV) into PortfolioTracker as a separate module: the whole Catalyst bond market, not the bonds you hold. Functionality is migrated, not CV's solutions: sources, storage and mechanics follow PT.

CV's **fundamental analysis specification** (`CatalystViewer/docs/fundamental-analysis-methodology.md`, state v1.75) is the reference for phase 2: identity, reports, statement lines, rule sets, thresholds, refinancing, data confidence, the judgement and the known exceptions. It moves into this repo as `Docs/catalyst-methodology.md` when its code does (plan, step 9); until then section numbers below (§) point into CV's copy.

| Phase | Contents |
|---|---|
| 1 – Market | Daily data of every Catalyst bond; browsing with filters; yield to maturity against an alternative; risk premium over treasury bonds; liquidity |
| 2 – Issuers | Company identity, filed annual reports read by code, the 7-dimension scorecard with data confidence, refinancing, repayment track record; the work that needs judgement or reading (finding reports, PDFs, the written judgement) done by an AI agent outside the app through a CLI |

## Contents

- [Module boundaries](#module-boundaries)
- [Rules for every source (hard rules)](#rules-for-every-source-hard-rules)
- [Data sources](#data-sources)
- [Storage: table `catalyst`](#storage-table-catalyst)
  - [Market (phase 1, rebuildable)](#market-phase-1-rebuildable)
  - [Issuers (phase 2, mostly not rebuildable)](#issuers-phase-2-mostly-not-rebuildable)
- [Jobs](#jobs)
  - [How jobs run](#how-jobs-run)
- [Market metrics (phase 1, screen row)](#market-metrics-phase-1-screen-row)
- [Issuer analysis (phase 2)](#issuer-analysis-phase-2)
  - [Reading reports (code, ported from CV)](#reading-reports-code-ported-from-cv)
  - [Scorecard (app)](#scorecard-app)
  - [Repayment track record (app)](#repayment-track-record-app)
  - [Later](#later)
- [The `catalyst` CLI (the agent's interface)](#the-catalyst-cli-the-agents-interface)
- [UI](#ui)
  - [Bonds](#bonds)
  - [Issuer dialog](#issuer-dialog)
  - [Issuers](#issuers)
  - [Settings](#settings)
- [Testing](#testing)
- [Migration from CatalystViewer](#migration-from-catalystviewer)
- [Plan](#plan)
- [Open questions](#open-questions)

## Module boundaries

Catalyst is a module of its own: its own table, jobs, API Lambda, view and backup. It doesn't read or change transactions or holdings; the bonds in it are not the ones held in PT.

| Part | Catalyst | Shared with PT |
|---|---|---|
| Table | `catalyst` | – |
| Files | Bucket prefix `catalyst/filings/` (originals of reports), `catalyst/uploads/` (hand downloads in transit) | Files bucket, raw S3 archive |
| Jobs | `catalyst-daily`, `catalyst-quotes`, `catalyst-terms`, `catalyst-metrics`, `catalyst-exits`, `catalyst-export` | Scheduling (CronV2, Warsaw), `runJob` (job runs), alert e-mails |
| API | Lambda `catalyst-api`, routes `/api/catalyst/*` | Domain, Cognito pool, access group `portfolio-tracker` |
| UI | View "Catalyst" (bonds, issuers) | Style, components (`StickyTable`, chart panel, filters, placeholders), Recharts |
| Code | `core/src/catalyst/`, `jobs/src/catalyst/`, `web/src/catalyst/`, `infra/catalyst.ts`, `packages/cli` | Catalyst may import PT's pure functions (bond cash flows, coupon periods, accrued interest, `settlement.ts`, `dates.ts`, the IZ index); **PT never imports Catalyst** |
| PT data read | `market`, read-only: `SERIES#` (retail bonds, the alternative), `CPI*`, `FX#…` (NBP rates for EUR bonds in refinancing) | Nothing from `transactions` or `holdings` |

## Rules for every source (hard rules)

From CV's specification (§1 principle 8, §7), for the jobs, the CLI and the agent alike:

- Respect robots.txt and bot protection; never work around them, also not in a script someone else runs.
- One request every 2 s per site (GLEIF about 1 per second, its limit is 60 a minute).
- Each download goes into its own new directory; downloaded files are untrusted data.
- **obligacje.pl blocks AI assistants** (ClaudeBot, Claude-User, GPTBot … and `ai-input=no`): only the app's `catalyst-terms` job reads it, as PT's `coupons` job does; the agent never fetches it, and the CLI doesn't pass its content on (bond terms reach the agent only as the app's computed results: amounts owed, maturities, refinancing).
- **The KRS financial documents repository** (rdf-przegladarka.ms.gov.pl) has no API and Imperva bot protection: reports are downloaded **by hand only** (checklist below).
- **BiznesRadar** disallows its paged history in robots.txt (checked by CV on 2026-11-05): Catalyst doesn't use BiznesRadar.
- money.pl: no PDFs (disallowed); parkiet.com: Cloudflare challenge, not usable; indos.pl: `/api/` disallowed.

## Data sources

| Data | Source | Notes |
|---|---|---|
| End of day, every bond | gpwcatalyst.pl daily statistics file `pub/CATALYST/statystyki/statystyki_dzienne/catalyst_YYYYMMDD.xlsx` (older days `.xls`) | Sheet `instrumenty`, ~1,060 rows (corporate, municipal, cooperative, bank, covered, treasury): maturity, current coupon rate, accrued interest, **current nominal**, market, trading system, ISIN, code, currency, close, reference price, open/low/high/last, average prices, number of trades, volume, turnover (thousands). **Archived by date: 2020-01-02, 2022, 2023, 2025 and 2026 checked, all download** (2026-11-05), so history can be backfilled. Close = reference price on a day without trades: "traded" comes from the number of trades. The nominal changes (instalment redemptions; IZ indexation, at the settlement day T+2): read it from the file every day, never once at listing (§4). |
| Bid/ask, order book | gpwcatalyst.pl quotes pages, one per segment (`notowania-obligacji-obligacje-korporacyjne`, `-skarbowe`, `-komunalne`, `-spoldzielcze`, `-bankowe-papiery-wartosciowe`, `-listy-zastawne`) | Snapshot of the current session only: a missed day is lost. Cells have sub-values, read by position (CV's `CorporateBondsQuotesPage.ts`). |
| Terms | obligacje.pl bond page (app job only) | Issuer name as listed, issue value ("Wartość emisji w obrocie", with the nominal on the day it was read), coupon type ("zmienne WIBOR 6M + 3.85%"), first days of interest periods, record and payment days, current rate. Known errors: record days a period early (PLY1227), rates lagging a few days (§4). |
| Exits | GPW suspensions and exclusions page, Catalyst notices, special markings of instruments | Why a bond left trading (redemption, early redemption, exclusion), markings `/1`–`/23` (bankruptcy, restructuring …). GPW's robots.txt allows it (§11). |
| Treasury curve | The daily file (treasury segment) | Fixed-rate DS/PS/WS pay a constant coupon (the file's rate) yearly on the maturity's day and month, so their yields need no other source; WZ margins from the series' terms. |
| Alternative | PT `market`: `SERIES#` (Ministry retail-bond file) | The retail bond on offer with the nearest term, or a rate you set. |
| WIBOR / WIRON | None (assumption in the settings) | No free fixings source; floating coupons not yet set use the assumed rate + margin. |
| Identity | GLEIF API (ISIN → LEI, name search, LEI record, parent), KRS register API `api-krs.ms.gov.pl/api/krs/OdpisAktualny/<KRS>` | Open; resolved 192 of 208 CV issuer names automatically (§5). |
| Annual reports | KRS repository (by hand), issuers' investor-relations sites, Bankier.pl mirrors of ESPI reports (listed companies; assistants allowed; attachments 404 after about a year), filings.xbrl.org (ESEF by LEI; Polish filings stop at FY2022, foreign issuers later) | Formats and reading below; CV §7. |

Reachability: PT's data-sources.md noted gpwcatalyst.pl unreachable from the dev machine on 2026-10-12; on 2026-11-05 it answered normally. Check from Lambda (eu-west-1) before building. GPW's move to WATS may change the file and the pages; parsers look columns up by header and fail loudly.

## Storage: table `catalyst`

On-demand, PITR on, deletion protection on `prod`, TTL attribute `ttl`. Same key schema as PT (`PK`, `SK`, sparse `GSI1PK`/`GSI1SK`). Dates `YYYY-MM-DD`; prices clean in % of nominal; report figures in units of their currency.

### Market (phase 1, rebuildable)

| Item | PK / SK | GSI1 | Contents |
|---|---|---|---|
| Bond | `BOND#<isin>` / `META` | `BOND` / `<code>` | code, name, type (segment), markets (GPW, BondSpot: one ISIN counted once), currency, current nominal, issued nominal, issue value, maturity, coupon type (`FIXED`/`FLOATING`/`ZERO`/`INDEXED`), base rate, margin, callable, amortising, `issuerName` (as listed), `entityId` (once resolved), status (`listed`/`suspended`/`ended`), first and last session seen, exit (date, reason, source, last price before it) |
| Session | `BOND#<isin>` / `D#<date>` | – | close, reference, open, low, high, last, trades, volume, turnover, nominal, rate, accrued interest; from the quotes pages: bid, ask, bid/ask volume and order count |
| Coupon period | `BOND#<isin>` / `COUPON#<start>` | – | As PT's `CouponPeriodItem` |
| Screen row | `BOND#<isin>` / `SCREEN` | `SCREEN` / `<code>` | Computed metrics (below), the issuer's signals copied for one-query reads, `computedAt` |
| Treasury curve | `CURVE#PLGOV` / `<date>` | – | points `{ years, yield, isin }`, fitted curve |
| Job run | `JOB#<name>` / `RUN#<startedAt>` | – | As PT, `ttl` 90 days |

Amount owed per bond = issue value × current nominal / issued nominal (§4: instalment bonds such as KRU0228, RES0228; IZ bonds).

### Issuers (phase 2, mostly not rebuildable)

Bonds are joined to reports **through the company's identity, never by matching names** (§1 principle 4, §5).

| Item | PK / SK | GSI1 | Contents |
|---|---|---|---|
| Issuer name | `NAME#<issuer name as listed>` / `META` | `NAME` / `<name>` | `entityId`, `financialsEntityId` (a financing vehicle points at its group: PEU (FIN) PLC → Pepco Group N.V.), evidence (ISIN mapping, exact name match, by hand), status (`resolved`, `confirmed`, `review`, `unresolved`). Several names can point at one company (Orlen / PKN Orlen; Kredyt Inkaso → Best) |
| Company | `ENTITY#<entityId>` / `META` | `ENTITY` / `<short name>` | `entityId` = the KRS number for a Polish company, else `LEI:<lei>`; **short name** (shown everywhere, e.g. "Kruk"), legal name, country, KRS, LEI, LEI status (`ISSUED`/`LAPSED`/…), register, category, parent; industry (fixed list, §6), business summary, website; finance sub-type (`collector`/`leasing`/`investment`/`out`) and rule-set override with its reason; year end; notes and exceptions (§16) |
| Financial year | `ENTITY#<entityId>` / `FIN#<period end>#<GROUP\|SINGLE>` | – | CV's `IssuerFinancials` row (§15): period, months, currency, standard, presented unit, line signs, `lines` (every line of the three statements: label, value, code or XBRL concept, anchor, parent, page, standard item), `items` (item totals, `debtDueWithinYear`), `figures` (each with its sources), `review` (`parsed`/`hand-checked`/`flagged`), `column` (current/previous), `reportPeriodEnd`, `filing` (S3 key, sha256, format, schema, checks, notes, extraction: who read it), `enteredBy`, `importedAt` |
| Collected figures | `ENTITY#<entityId>` / `AIFIG#<collectedAt>` | – | Fallback figures collected from the web by an agent when no report is available (§9): marked as such, never for lenders, confidence medium at most |
| Filing | `ENTITY#<entityId>` / `FILING#<sha256>` | – | Original document: format, fiscal year, scope, source URL, S3 key, import result |
| Analysis | `ENTITY#<entityId>` / `ANALYSIS#<ts>`, mirror `ANALYSIS#LATEST` | – | The agent's written judgement (§13, §14 layout), red flags with source and quote, what to watch, sources read, model, and the scorecard version it saw |
| Checklist entry | `CHECK#<entityId>` / `<year>#<scope>` | `CHECK` / `<status>` | A report to fetch: company, KRS, year, group/single/any, where it can be found, status (`missing`, `downloaded`, `imported`, `not available`) |
| Known answer | `KNOWN#<entityId>` / `<period end>#<scope>` | – | Figures read by hand from printed statements (CV's `expected.json`, 40 reports), for `check-filings` |
| Setting | `SETTING#<name>` / `META` | – | `assumptions` (WIBOR, WIRON, commission, tax, alternative), `views` (saved filters), `agentToken` (hash) |

**Derived values aren't stored on the company** (as in CV): the scorecard, refinancing and confidence are computed from the rows when read, so a rule change reaches every company at once. `catalyst-metrics` copies the signals into the screen rows for the bond table's filters, and recomputes a company's bonds whenever its rows change.

**The most recent report wins** (§7): a year that appears in two reports keeps the newer report's figures; a row is written only if none exists or the stored row's report is not newer. Exceptions per company (Vindexus FY2024 keeps its own report).

Sizing: ~1,060 bonds × ~250 sessions a year ≈ 265k session items a year; backfill from 2020 ≈ 1.6M items (one-off write cost ≈ $2). The screen is ~600 items. Issuers: ~200 names, ~100 companies, a few hundred financial years.

**Backup:** monthly `catalyst-export` of names, companies, financial years, collected figures, filings (metadata; originals stay in S3, versioned), analyses, checklist, known answers and settings to `exports/<date>/catalyst/`, in the CLI's input formats, so a restore is a re-import. Market data is rebuilt from the file archive; bid/ask history can't be (accepted).

## Jobs

| Job | When (Warsaw) | What |
|---|---|---|
| `catalyst-daily` | 18:30, recheck 08:00 Tue–Sat | Downloads the day's file (archives it), upserts bonds (new → `listed`; gone from the file → `ended`), writes sessions, updates current nominals. Backfill mode: a date range from the archive, through a queue, a few files per invocation. |
| `catalyst-quotes` | 17:20 (after the close), 08:30 Tue–Sat before the session | Reads the six quotes pages, adds bid/ask to the last session's item (only when the page's session date matches). |
| `catalyst-terms` | 09:30 | obligacje.pl for bonds without terms (up to ~40 per run), then refreshes current coupon rates of floating bonds; adds missing periods, never overwrites a stored date or rate (as PT's `coupons`). New issuer names are resolved against GLEIF (ISIN mapping, then an exact name match); anything else is left `unresolved` for the agent. |
| `catalyst-exits` | 10:00 | GPW suspensions and exclusions, Catalyst notices and special markings: the reason a bond ended, markings on a company's instruments. Backfill to 2018 once. |
| `catalyst-metrics` | after `catalyst-daily`; on a change of assumptions; after a write to a company | Treasury curve of the day, then a screen row per listed bond. |
| `catalyst-export` | 1st of the month 04:30 | Backup (above). |

Failures alert as PT's jobs do; `catalyst-quotes` failing after its morning run means that day's bid/ask is lost.

### How jobs run

As PT's jobs: an EventBridge Scheduler schedule (`sst.aws.CronV2`, `timezone: Europe/Warsaw`) invokes a Lambda; one FIFO queue carries the work that doesn't come from a schedule. No Step Functions: CV needed them for the AI analysis (a loop over issuers, steps of up to 10 minutes, a summary e-mail), which now happens outside the app; what's left is short, idempotent jobs whose only chaining ("after the daily file, recompute the metrics") is a queue message. One way of running jobs across PT, with the same job runs, watchdog and alarms.

| Job | Triggered by | Runs as |
|---|---|---|
| `catalyst-daily`, `catalyst-quotes`, `catalyst-terms`, `catalyst-exits`, `catalyst-export` | Their schedules (above) | One Lambda invocation each, seconds to ~1.5 min (`catalyst-terms`: at most ~40 pages 2 s apart; the rest waits for the next day). Scheduler retries a failed run (`retries: 2`, as PT) |
| `catalyst-metrics` | Messages on `CatalystQueue`: from `catalyst-daily` when it finishes, from the API after a change of assumptions or a write to a company (the CLI's writes included) | Lambda subscribed to the queue |
| Backfill of the 2020+ archive (~1,500 files) | The CLI or the API puts date-range messages on `CatalystQueue` (e.g. 20 sessions each) | The same Lambda, one message at a time |

**Why a queue only for these two.** A scheduled job has one trigger at a known time: it can't pile up or overlap with itself, Scheduler retries it, its job run records it, and it fits in one invocation; a queue in front of it would add a hop and give nothing. The two queued kinds differ:

- **Metrics** has many triggers that can come in bursts (an agent session writes ten companies in minutes). The queue coalesces them (content-based deduplication) and runs them one at a time, so two recomputes never write the same screen rows at once, and no sender needs to know whether a run is going. An asynchronous invoke with concurrency 1 would serialise too, but not coalesce: ten writes would be ten full recomputes.
- **Backfill** doesn't fit one invocation (~1,500 files at one request every 2 s is about an hour, over Lambda's 15 minutes). The queue holds the chunks, keeps the pace (one at a time), retries a failed chunk on its own and keeps the ones that keep failing in the dead-letter queue, where a Lambda re-invoking itself would lose track of them.

**`CatalystQueue`:** FIFO, one message group (strictly one at a time), content-based deduplication, visibility timeout above the Lambda's timeout, dead-letter queue after 3 failures (14 days' retention). Messages: `{ kind: "metrics", entityId? }` (none: all bonds), `{ kind: "backfill", from, to }`. As PT's `ValuationQueue`.

**Monitoring:** every run writes its job run (`runJob`); the existing watchdog finds runs that didn't happen or didn't finish; a new alarm on the Catalyst dead-letter queue; `catalyst-quotes` failing on its morning run alerts at once (that day's bid/ask can't be fetched later).

## Market metrics (phase 1, screen row)

- **Yield to maturity, gross and net:** from the bond's cash flows (coupon periods on the current nominal; future floating coupons = assumed base rate + margin; nominal at maturity), bought at the last close + accrued interest to T+2 + commission; net after 19 % tax on interest and on the gain at maturity (PT's `buyMore` logic). Callable bonds also get the yield to the first call date.
- **Vs alternative:** net yield − net yield of the alternative over the same term (pp). The alternative is the retail bond on offer with the nearest term (from `SERIES#`) or a rate set by you.
- **Premium vs gov (gross):** fixed coupon: yield − treasury curve at the same maturity; floating: price-adjusted margin − WZ margin of a similar maturity. Blank for non-PLN bonds and bonds without a trade in 90 days.
- **Liquidity (30 and 90 days):** share of sessions with trades, median turnover on traded days, number of trades, median bid/ask spread, order depth at best bid; "days to sell 10 000 zł" assuming 20 % of the median daily turnover. Level: high (traded ≥ 80 % of sessions and median turnover ≥ 20 000 zł), medium (≥ 40 %), low (less), none (no trade in 30 days). Thresholds to be calibrated on the backfilled history.
- **Flags:** stale price, callable, amortising (nominal fell), suspended, GPW marking, no terms yet.

## Issuer analysis (phase 2)

The procedure is CV's (§3): bond → company → industry and rule set → reports → reading → (fallback figures) → scorecard → refinancing → confidence → judgement. Who does each step here:

| Step | Done by | How |
|---|---|---|
| 1 Bond, amount owed | App | Daily file + terms |
| 2 Company | App, then agent | GLEIF ISIN mapping and exact name match in `catalyst-terms`; the rest (renames, mergers, financing vehicles, legal-name mismatches) by the agent through the CLI, confirmed by hand where §5 says so |
| 3 Industry, rule set | Agent; finance sub-types and overrides by you | Industry from the fixed list, with a summary and website; a Finance company has no scorecard until you give its sub-type (hand-reviewed map, §6) |
| 4 Getting reports | Agent; KRS repository downloads by you | `catalyst work` lists reports due (year end + 9 months); the agent fetches what robots.txt allows (issuer sites, Bankier, filings.xbrl.org) and adds the rest to the checklist for you |
| 5 Reading | Code; PDFs copied by the agent | KRS XML, ESEF package and IFRS text are parsed by code; a PDF's statement lines are copied by the agent and checked by code (below) |
| 6 Fallback figures | Agent | Only operating companies without a report; marked, confidence medium at most |
| 7–9 Scorecard, refinancing, confidence | App | Computed on read |
| Repayment track record | App | From exits and the session history (below) |
| 10 Judgement | Agent; you can edit | Written from the scorecard, the reports' notes, auditor's opinion, current reports (§13), in the §14 layout |

### Reading reports (code, ported from CV)

The parsers move from CV (`packages/core/src/bonds/fundamentals/filings/`) into `core/src/catalyst/filings/`, used by the API (import) and the CLI (sort, dry run):

| Format | Who files it | Reading |
|---|---|---|
| **KRS XML** | Unlisted companies under the Polish accounting act (most issuers) | Fixed line codes (`JednostkaInna…`, `SkonsolidowanaJednostkaInna…`, `…WTys`/`…WZlotych`; schemas 1-2, 1-3, 2-0E, the 2025 "(2) 1-0E"); signed XAdES (base64 in `ds:Object`) or CAdES; the 2025 `Dokument` envelope with base64 attachments. Small and micro entities not supported. |
| **ESEF package** (`.zip`, `.xbri`) | Listed IFRS reporters | Inline XBRL with the filer's calculation tree, anchors and labels (prefer the package to a bare `.xhtml`) |
| **IFRS text** (`.xhtml`) | Untagged separate statements | By labels, best effort, only when the balance sheet ties |
| **PDF** | Unlisted IFRS reporters (P4, art.Locum, Ronson), foreign issuers (Allegro.eu, Pepco, MOL) | Code finds the statement pages; **the agent copies every line** (label, page, amount per column exactly as printed, standard item) into a `record_statements` transcript, computing nothing; code parses the amounts and checks that each appears on its page. This is CV's "read by hand" route (`--print-prompt` / `--transcript`), its default since 2026-11-04. Scanned PDFs not supported. |

Every line keeps its source and gets a **standard item** from one vocabulary (§8: income, assets, equity and liabilities, cash flow items such as `revenue`, `ebit`, `debtBonds`, `debtLeases`, `debtSecuritisation`, `operatingCashFlow`, `interestPaid` …). **Checks refuse an import** when total assets ≠ total equity and liabilities, assets ≠ non-current + current, net profit differs between statements (KRS XML), children don't add up to their parent, or a PDF amount isn't on its page. Group accounts first, full 12-month years only, never mixed (§7). The original file goes to S3. `check-filings` compares stored rows and fresh parses with the known answers after any parser change.

### Scorecard (app)

As CV's specification, §10 to §12:

- **Seven dimensions:** Debt burden, Debt service, Liquidity, Profitability, Asset coverage, Financial trend, Refinancing; each green / yellow / red / n/a with its metrics and notes. **No aggregate score** (§1 principle 1): the reader sees the dimensions, helped by the written judgement.
- **Rule sets** with their own metrics and thresholds: general, developer, contractor, consumer and services; for lenders debt collector, leasing and factoring, investment firm. Chosen by the finance map, then a per-company override, then the industry (§6, §10).
- **Out of scope:** banks, mortgage banks, insurers, state bodies, municipalities: no colours, but identity, bonds and refinancing data.
- **No data is n/a, never a colour**; a dimension coloured by one metric where it has more is "thin".
- **Refinancing:** the company's listed bonds (all its names and its financing vehicle, each ISIN once, at the amount owed) due within 12 and 24 months against cash and operating cash flow; EUR bonds at the NBP rate (§11).
- **Data confidence** high / medium / low with its facts: source and year, years behind, metrics computed and missing (§12). Low-confidence signals are shown faded.

### Repayment track record (app)

Planned in CV (§11); here the data is at hand from the start: the daily-file archive since 2020 gives every bond's last session and last price, `catalyst-exits` gives GPW's reason (back to 2018) and markings. Per company: bonds repaid at maturity, redeemed early, ended below par, still listed past maturity, unknown; the period covered ("since 2020-01"), so a short record isn't read as a clean one; red flags (a missed payment, a marking, an extension, a buy-back below par). Inferred facts are labelled as inferred; confirmation of payment comes from issuers' current reports, read by the agent. Shown next to the scorecard, not as an eighth colour.

### Later

- **Risk vs premium:** with the scorecard, confidence and track record next to each bond's premium, the bond table and chart already show mismatches (a high premium with greens, a low one with reds). A "does the premium pay for the risk" verdict (expected loss from default probabilities) waits for the calibration on past Catalyst defaults (§18 item 8: GetBack 2018 and others; the 2020+ archive and the exits give a first set).
- CV's §18 list: notes read with checked quotes (debt schedule, covenants, collateral, auditor's opinion), more lender metrics, developers' escrow and land bank, undrawn credit lines, trailing 12 months, holding-company flag.

## The `catalyst` CLI (the agent's interface)

The app has no AI. It stores, parses, checks, computes and shows. Finding and reading documents, resolving hard identities and writing judgements is done by an AI agent (Claude Code or another chat) through the CLI.

- **Location:** `packages/cli` in this repo, TypeScript, run with `npx catalyst …`. It uses `core`'s zod schemas and parsers (the same ones the API uses); `catalyst schema <kind>` prints an input as JSON Schema.
- **Transport:** only the API (`/api/catalyst/*`), never DynamoDB directly; the server re-parses and re-checks every import. JSON output by default, `--table` for people, `--dry-run` on every write.
- **Auth:** an agent token (same pattern as the spreadsheet feed token: 32 random bytes shown once, only the SHA-256 stored, one at a time, revocable), made in the Catalyst view. It allows reads of `/api/catalyst/*` and writes of names, companies (not finance sub-types or overrides), filings, collected figures, analyses and checklist entries; not market data, settings or anything of PT. `catalyst login --stage <stage>` stores it outside the repo. Tests use the test user on `int`, never prod.
- **Review:** everything the agent writes records `enteredBy` and keeps history (analyses are append-only; a replaced financial year keeps the previous version). Imported years start as `parsed`; you mark them `hand-checked` or `flagged`. Identities whose legal name differs from the listed name stay `review` until you confirm them.

| Command | Purpose |
|---|---|
| `catalyst work` | What needs doing: names `unresolved`/`review`; companies in scope without a report for a year that is due; companies on fallback figures; Finance companies without a sub-type; analyses older than their latest report; new markings or bonds ending below par |
| `catalyst bonds [--entity] [--filter …]`, `catalyst bond <code>` | Screen rows, amounts owed, liquidity (no obligacje.pl content) |
| `catalyst entity <id>` | Identity, names, bonds, financial years with lines, scorecard, refinancing, confidence, track record, latest analysis |
| `catalyst identity resolve [<name>]` | GLEIF and KRS lookups (ISIN mapping, exact name match, by KRS or LEI, parent), printed with the evidence |
| `catalyst identity set <name> --entity <id> [--financials <id>] --evidence "…"` | Link a listed name to a company (and a financing vehicle to its group) |
| `catalyst entity set <id> --file entity.json` | Short name, industry, summary, website, notes |
| `catalyst checklist [--add <id> <year> <scope> --where "…"]` | Reports to download by hand from the KRS repository, and their state |
| `catalyst filings sort <folder> [--copy\|--move]` | Identify hand-downloaded files (zips, signed XML, PDFs: company, KRS, year, scope, duplicates, part years, drafts), check them against the checklist, file them as `sorted/<KRS>-<company>/FY<year>-<scope>.<ext>` |
| `catalyst filings import <file> [--entity <id>] [--dry-run] [--force]` | Upload and import a KRS XML, ESEF or IFRS text report; prints the figures, the checks and what was kept (most recent report wins) |
| `catalyst filings pages <pdf> --out pages.txt` | The statement pages and the copying instructions for a PDF |
| `catalyst filings import <pdf> --transcript t.json --by "<model or name>"` | Import a PDF from the agent's transcript; code checks every amount |
| `catalyst filings check [--entity <id>]` | Compare stored rows and fresh parses with the known answers |
| `catalyst known put <id> --file known.json` | Hand-read figures of a report, for `filings check` |
| `catalyst figures put <id> --file fig.json` | Fallback figures from the web (operating companies only), marked as collected |
| `catalyst analysis put <id> --file judgement.md --meta meta.json` | Store a judgement (layout below) |
| `catalyst schema <kind>` | JSON Schema of an input |

**Agent skill** `catalyst-analyst` (`.claude/skills/` in this repo), built on the methodology document:

1. `catalyst work` → pick an item.
2. Identity: `identity resolve`; renames, mergers, financing vehicles (guarantee in the bond terms?) by the §5 rules; `identity set`.
3. Industry and summary: `entity set`. A Finance company: propose the sub-type to you, don't set it.
4. Reports: latest full year, group first. Issuer site, Bankier (listed), filings.xbrl.org; download into a new directory, 2 s apart; the KRS repository only through `checklist --add` for you.
5. `filings import --dry-run`, then import; a PDF via `filings pages` → transcript (copy, never compute) → import. Refused? Read the checks, fix the transcript, never `--force` without asking.
6. No report available and an operating company: `figures put`, avoiding §9's failure modes (part years, today's date, units, the wrong company).
7. `entity <id>`: read the scorecard against the rule set (§13); read the auditor's opinion, going-concern notes, covenants, security, related parties, current reports for red flags, each with a source and quote.
8. `analysis put` in the §14 layout: header (company, identity, industry, rule set), bonds and amounts due, figures and confidence, the 7 dimensions, judgement (2–5 sentences), red flags (or "none found in <documents read>"), what to watch, sources.

Limits: at most N companies per session; never touch bonds or market data. It runs by hand in Claude Code, or later as a scheduled cloud routine with the token as a secret (the KRS checklist then waits for you).

## UI

Routes: `#/catalyst?<filters>&bond=<isin>&issuer=<entityId>` (bonds), `#/catalyst/issuers?<filters>&issuer=<entityId>`. Style, sticky filters and header, loading placeholders and the bottom chart panel as in the rest of PT. Companies are always shown by their **short name**; legal name, KRS and LEI in tooltips and the issuer dialog.

### Bonds

One row per listed bond (figures in the sketches are illustrative).

```
Catalyst · Bonds                                     as of 2026-11-04 · 612 bonds
[Search code / issuer] [Type ▾] [Coupon ▾] [Maturity 1–4 y] [Nominal ≤ 1000]
[Liquidity ≥ medium ▾] [Scorecard: no red ▾] [+ More filters] [Views ▾] ✕
47 of 612 bonds · Chart ◻
BOND     ISSUER       COUPON   MATUR.  PRICE   YIELD NET        PREMIUM  LIQ  ISSUER (B S L P A T R)
                                               bond · vs alt    vs gov
KRU0829  Kruk     ⓘ   W6M+3,0  2,8 y   101,20  6,41 · +1,22     3,6 pp   ●●●  ●●●●●●● collector · high
ACH0628  Archicom ⓘ   W3M+3,9  1,6 y   103,01  6,02 · +0,83     3,9 pp   ●○○  ●●●●●●● developer · high
PCR0827  Pragma   ⓘ   9,0 %    0,8 y    99,10  8,33 · +3,14     5,1 pp   ●○○  ○ no report yet
PKO0829  PKO BP   ⓘ   W6M+1,0  2,8 y   100,05  4,90 · −0,31     0,9 pp   ●●○  – bank, not scored
```

| Column | Shows | Tooltip |
|---|---|---|
| Bond | Code; tags callable, amortising, EUR, GPW marking | Name, ISIN, markets, segment |
| Issuer | Short name; opens the issuer dialog | Legal name, industry |
| Coupon | `7,50 %`, `W6M+3,85`, `WIRON+…`, `zero` | Current period's rate, next payment |
| Maturity | Years left | Date; amount owed |
| Price | Last close (% of nominal); grey "stale" when not traded for long | Date, bid/ask, accrued interest |
| Yield net | Net yield to maturity · vs alternative (pp, green above, red below) | Gross yield, the alternative and its net yield, base rate assumed |
| Premium vs gov | pp over the treasury curve (floating: over WZ) | How it was derived |
| Liquidity | Three dots: high, medium, low; none = empty | Sessions traded, median turnover, spread, days to sell 10 000 zł |
| Issuer | **Seven dots** in a fixed order (debt burden, debt service, liquidity, profitability, asset coverage, trend, refinancing), the rule set and the confidence; faded when confidence is low; "no report yet", "not scored: bank" | Each dimension's metrics with values and colours, notes; source line ("annual report, ESEF, group accounts, FY2025"); the judgement's first line and its date |

More columns (bid/ask, accrued interest, amount owed, gross yield, yield to call, track record) under "Columns" in the More filters panel.

**Filters** (in the URL): text (code, issuer); type (corporate, municipal, cooperative, bank, covered, treasury); market (GPW, BondSpot); currency; coupon type and base rate; maturity from–to; nominal max (≤ 1 000, ≤ 10 000, any); exclude callable / amortising / marked; minimum net yield, vs alternative, premium; liquidity level, traded in the last 30 days; issuer: industry, kind of financial company, rule set, **scorecard** (no red; no red in debt service and refinancing; a chosen dimension green), confidence at least, scored only, track record without red flags, judgement newer than N months; hide suspended and ended (on by default). The bar holds the common ones, "More filters" the rest; set filters show as removable chips. **Saved views** (setting `views`), e.g. "nominal ≤ 1000, liquidity ≥ medium, ≤ 4 y, no red in debt service and refinancing".

**Chart** (toggle above the table): net yield against years to maturity for the filtered bonds, with the treasury curve and the alternative as lines; dots coloured by **one chosen dimension** (default: debt service, the one that matters most for a bondholder, §13), faded at low confidence, grey when not scored; a click selects the row. It shows the risk vs premium mismatches at a glance and replaces CV's "2D stats".

**Row panel** (bottom, as Holdings): tabs *Price & liquidity* (close, bid/ask, turnover bars; 1M/6M/1Y/ALL), *Yield* (cash flows, tax, commission, the alternative, as PT's Buy-more breakdown), *Coupons* (periods, rates, record and payment days, call terms).

**Phone:** three-line rows (code, issuer, seven dots / coupon, maturity, liquidity / net yield, vs alternative, premium); filters folded into the search and a Filters button; the chart full width above the list.

### Issuer dialog

Opened from any issuer name (`?issuer=<entityId>`); full screen on a phone.

```
Kruk                     Kruk S.A. · Poland · KRS 0000… · LEI 2594…   collector rules · high confidence  ✕
Annual report (ESEF, IFRS), group accounts, FY2025 and 2 earlier · judgement 2026-11-02
┌ Scorecard ──────────────────────────────────────┐ ┌ Bonds falling due vs cash ──────────────┐
│ ● Debt burden    net debt / equity 1,2×         │ │ ▇▇ ▇ ▇▇▇ ▇  ▇▇   12 m: 1,1 bn · cash 0,9│
│ ● Debt service   pre-tax interest cover 2,9×    │ └─────────────────────────────────────────┘
│ ● Liquidity  ● Profitability  ● …  ● Refinancing│  Track record since 2020-01: 14 repaid, 3 early, 0 red flags
└─────────────────────────────────────────────────┘
Judgement: …  Red flags: none found in FY2025 report, auditor's report.  Watch: …
[Bonds (9)] [Financials] [Track record] [Judgements] [Documents]
```

- **Bonds:** its bonds (all its names and financing vehicles) with maturity, amount owed, net yield, premium, liquidity; "Show in table" filters the bonds view to the company.
- **Financials:** up to six years with the source per year (link to the original); a figure opens the lines behind it; *Full statements*: a year's lines as printed; review status per year (parsed / hand-checked / flagged), with buttons to mark it; collected figures marked, and years where collected and filed figures differ by more than 2 %.
- **Track record:** past bonds with how and when they ended, last price, source.
- **Judgements:** the latest in full, earlier ones by date.
- **Documents:** filings and their import results.

### Issuers

One row per company with listed bonds. Columns: short name, industry (and kind of financial company), rule set, bonds, amount owed on Catalyst, due in 12 months, median premium, the seven dots, confidence, latest financial year, track record, judgement date, **needs work** (what `catalyst work` lists for it). Filters: industry, rule set, scorecard, confidence, scored / not scored / no report, needs work. A row opens the issuer dialog.

**Reports checklist** (a tab in Issuers): the reports waiting to be downloaded by hand from the KRS repository, with company, KRS number (copyable), year, scope and status; the place to start a download session.

### Settings

A cog in the view: assumptions (WIBOR, WIRON, commission, alternative: nearest retail bond or a rate), the agent token (create, revoke, last used).

## Testing

As the rest of PT (Development.md): unit tests of the market parsers on stored files (a daily file per format, each quotes page, obligacje.pl pages, the GPW exit pages) and of the metrics; CV's filing parsers come with their tests and fixtures; the known answers run as `filings check`; `int` seeded with fixture bonds, sessions, names, companies and financial years; integration tests of `/api/catalyst/*` including the agent token's limits; E2E of the bonds view, filters, the issuer dialog and marking a year hand-checked. The CLI's commands tested against `int`.

## Migration from CatalystViewer

CV's prod data that exists nowhere else moves once, as a data change (dry run, then `dev`, then your approval for `prod`):

| CV data | Into |
|---|---|
| `IssuerProfiles` identities (`#IDENTITY`, confirmed ones kept confirmed) | Names and companies |
| Profiles (industry, summary, website), `FINANCE_RULE_SETS`, `RULE_SET_OVERRIDES` | Companies (sub-types and overrides as yours) |
| Filings bucket originals | Re-imported through the ported parsers (and PDFs from their stored transcripts), compared with CV's `IssuerFinancials` rows and the known answers before switching |
| `expected.json` (known answers), the checklist | Known answers, checklist entries |
| AI analyses with their figures | Collected figures (marked) and judgements (marked as from CV's agent) |
| `BondStatistics` (bid/ask since 2023) | Sessions (bid/ask only; the rest comes from the file archive) |
| Inactive bonds since 2023-03 | Cross-check of the exits job |

CV's methodology document moves to `Docs/catalyst-methodology.md` with the code it describes, and is kept current from then on as CV's is (it is the single description the agent starts from).

## Plan

Each step goes to prod on its own.

1. Table, `catalyst-api` skeleton, empty view in the menu.
2. `catalyst-daily` + backfill from the 2020+ archive.
3. `catalyst-quotes`.
4. `catalyst-terms` (terms, amounts owed, identity by GLEIF where unambiguous).
5. `catalyst-metrics`: treasury curve, yields, premiums, liquidity.
6. Bonds view: table, filters, saved views, chart, row panel.
7. Run alongside CV; compare yields, liquidity and amounts owed bond by bond; import CV's bid/ask history.
8. `catalyst-exits` + repayment track record.
9. Phase 2 core: names, companies, financial years, filings; the ported parsers, rule sets, scorecard, refinancing and confidence; the methodology document moved here.
10. CLI and agent token; the `catalyst-analyst` skill.
11. Migration of CV's issuer data (table above); compare every company's scorecard with CV's.
12. Issuers view, issuer dialog, checklist; the issuer columns and filters in the bonds view.
13. Retire CV (its jobs, Bedrock and Tavily use, the Filings bucket after the migration is verified). Deleting its resources is your call.

## Open questions

- Is passing the app's computed bond results (amounts owed, maturities) to the agent compatible with obligacje.pl's `ai-input=no`? Proposed: yes for figures the app derived, never the site's text; to be confirmed.
- Companies without an LEI or a KRS number (WB Electronics has no LEI): a private id (`ZZ:<name>`), as PT's `ZZ` ISINs.
- WIRON: which bonds reference it and what the assumption should be.
- A free source of WIBOR/WIRON fixings, for floating coupons and the premium of floaters.
