# Catalyst phase 2: implementation plan

Status: plan (2026-11-07). Phase 2 of the [Catalyst module](catalyst.md): who stands behind each bond and whether they can pay. It covers company identity, filed reports read by code, the 6-dimension scorecard with refinancing and data confidence, the repayment track record, and the CLI through which an AI agent does the work that needs reading or judgement. It ends with interim (quarterly, half-year) reports. Design steps 8–12 ([catalyst.md](catalyst.md#plan)), plus [Interim reports](catalyst.md#interim-reports).

Phase 1 is done (v0.204, [catalyst-phase1-plan.md](catalyst-phase1-plan.md)). CatalystViewer (CV) keeps running its issuer analysis until this phase replaces it; nothing of CV is switched off or deleted without the owner (AGENTS.md).

Each milestone is a release: it goes through the usual delivery (int → tests → tag → prod, [Development.md](Development.md)) and leaves the app working. Milestones marked **⚠ approval** write data on prod that can't be rebuilt, change access, or create resources holding data: ask before pushing them.

## Contents

- [Decisions this plan makes](#decisions-this-plan-makes)
- [Owner decisions needed](#owner-decisions-needed)
- [What is ported from CatalystViewer](#what-is-ported-from-catalystviewer)
- [Code layout](#code-layout)
- [Preparation](#preparation)
- [Milestones](#milestones)
  - [N0 Checks before building](#n0-checks-before-building)
  - [N1 Exits and the repayment track record](#n1-exits-and-the-repayment-track-record)
  - [N2 Identity: names and companies](#n2-identity-names-and-companies)
  - [N3 Reading reports](#n3-reading-reports)
  - [N4 Scorecard, refinancing, confidence](#n4-scorecard-refinancing-confidence)
  - [N5 Migration of CatalystViewer's issuer data ⚠](#n5-migration-of-catalystviewers-issuer-data--approval)
  - [N6 Issuers view and the issuer dialog](#n6-issuers-view-and-the-issuer-dialog)
  - [N7 CLI, agent token and the agent skill ⚠](#n7-cli-agent-token-and-the-agent-skill--approval)
  - [N8 Interim reports](#n8-interim-reports)
  - [N9 CatalystViewer handed over](#n9-catalystviewer-handed-over)
- [Tests](#tests)
- [Risks](#risks)
- [Done when](#done-when)

## Decisions this plan makes

These settle details the design leaves open. Where the design differs, the design doc is updated.

| Topic | Decision | Why |
|---|---|---|
| Order | Data and computation first (exits, identity, reading, scorecard), then CV's data (N5), then the UI (N6), then the CLI and agent (N7) | The scorecard is checked against CV's on the same companies before anyone relies on it. The UI opens on real data. CV keeps running throughout (owner, 2026-11-07); its data is migrated once (N5), not kept in sync. |
| Code | `core/src/catalyst/issuers/` (identity, scope, scorecard, refinancing, confidence, track record) and `core/src/catalyst/filings/` (parsers, statement lines, checks, import), imported as `@portfolio/core/catalyst/…`; PT never imports them | Module boundary, as phase 1 |
| Reading in the CLI | Parsing, the checks, PDF pages, GLEIF/KRS lookups and the scorecard preview run in the CLI on your machine (it imports `core`). The API receives parsed rows: it checks the schema, re-runs the arithmetic checks on the lines, compares the original's SHA-256, and stores. No file parsing in Lambda, no `pdfjs-dist` in any function. | An analysis needs the backend only to read stored rows and write results; fast, works offline up to the write. A wrong row can't pass the arithmetic checks, and `filings check` re-parses the stored originals at any time. |
| Uploads | The CLI asks for a presigned PUT to `catalyst/uploads/<uuid>`, uploads, then sends `POST /catalyst/filings { key, sha256, rows, … }`; the original is copied to `catalyst/filings/<entityId>/<sha256>.<ext>` | API Gateway's 10 MB payload limit; ESEF packages run to 30 MB |
| PDF reading | Only the transcript route: the agent copies the lines, and the CLI checks each amount on its page. CV's Bedrock extractor (`AiPdfExtractor`) is not ported. | The app has no AI (design). The transcript route has been CV's default since 2026-11-04. |
| Six dimensions | Debt burden, debt service, liquidity, profitability, asset coverage, refinancing. CV's Financial trend becomes arrows on the dimensions its metrics describe (net debt / EBITDA slope on debt burden; margin slope and revenue growth on profitability). | Trend is a direction, not a state: as a colour it repeated what the other dimensions say and couldn't be read on its own (catalyst.md, "Scorecard") |
| CV's reports | CV's 85 originals (43 companies) are copied in N3 for testing on dev and migrated in N5; `catalyst work` never asks for a report already held | Not downloaded again |
| Agent access | Routes `/catalyst/agent/{proxy+}` without the Cognito authorizer; the function checks the token (`Authorization: Bearer`, SHA-256 against `SETTING#agentToken`, as the spreadsheet feed's), then dispatches to the same handlers through an allow-list of reads and writes | One token check in one place; the agent can never reach PT's routes or the module's settings and market data |
| Computed on read | Scorecard, refinancing, confidence and track record computed by pure functions from the rows; `catalyst-metrics` runs them once per company per run and copies the signals into the screen rows | Design ("Derived values aren't stored"); the bond table's filters need them in one query |
| After a company write | The API queues `{ kind: "metrics" }`; the worker coalesces a burst into one full run (12 s today) | No per-company path to maintain; one run is cheap |
| Companies without KRS or LEI | `entityId` = `ZZ:<slug of the legal name>`, replaced by the KRS or LEI when found (names re-pointed, rows moved) | The design's open question; as PT's `ZZ` ISINs |
| Methodology | `CatalystViewer/docs/fundamental-analysis-methodology.md` moves to `Docs/catalyst-methodology.md` in N4 with the scorecard code; from then on PT's copy is the reference and CV's is frozen | One description, next to the code it describes |
| Track record before identity | N1 groups past bonds by the issuer name as listed; N2's names join them to companies | The exits data stands on its own; no wait for identity |
| Backup | `catalyst-export` gains each milestone's items (names, companies, years, interim periods, filings' metadata, known answers, checklist, collected figures, analyses) in the CLI's input formats | Design ("Backup"): a restore is a re-import |

## Owner decisions needed

1. **obligacje.pl's `ai-input=no` and the CLI.** Agreed (2026-11-07): the agent sees only figures the app derived (amount owed, maturity, coupon as numbers, yields), never the site's text or pages.
2. **Agent runs:** by hand in Claude Code only, for now (2026-11-07). No scheduled routine.
3. **CatalystViewer:** not switched off for now, at all (2026-11-07). N9 is on hold; CV keeps running alongside.
4. **Interim reports:** go (2026-11-07), as suggested: the half-year balance sheet, on demand (bonds due within 24 months, a yellow or red in debt service, liquidity or refinancing, or asked); trailing 12 months later, if useful.
5. **AI analysis per company** (new requirement, 2026-11-07): off by default, shown as "AI analysis off" instead of the scorecard, switched on by you in the issuer dialog; only then does `catalyst work` list the company. On from the start: issuers of bonds you hold, and companies with reports (CV's 43). Design: "AI analysis per company".

## What is ported from CatalystViewer

As of CV `7e8a24c` (2026-11-05). This is functionality, not CV's storage or functions.

| CV | Lines | Into | Notes |
|---|---|---|---|
| `core/bonds/fundamentals/filings/FilingParser.ts`, `krsLineLabels.ts` | 1,420 | `filings/krsXml.ts`, `krsLines.ts` | Schemas 1-2, 1-3, 2-0E, (2) 1-0E; XAdES/CAdES; the `Dokument` envelope |
| `EsefParser.ts`, `zip.ts` | 785 | `filings/esef.ts`, `zip.ts` | Calculation tree, anchors, labels |
| `IfrsTextParser.ts` | 305 | `filings/ifrsText.ts` | Best effort, only when the balance sheet ties |
| `pdfText.ts`, the transcript half of `AiPdfExtractor.ts` | ~250 | `filings/pdf.ts`, `transcript.ts` | Statement pages, the copying prompt, amount checks |
| `statementLines.ts`, `filedYears.ts`, `importFiling.ts` | 620 | `filings/lines.ts`, `years.ts`, `import.ts` | Standard items, checks, most recent report wins |
| `scorecard.ts`, `scope.ts`, `confidence.ts`, `maturities.ts` | 750 | `issuers/scorecard.ts`, `scope.ts`, `confidence.ts`, `refinancing.ts` | Rule sets, finance map and overrides, thresholds; Financial trend turned into arrows (six dimensions) |
| `bonds/issuers/identity.ts`, `resolveIssuerIdentity.ts` | 230 | `issuers/identity.ts`, `jobs/catalyst/gleif.ts`, `krs.ts` | GLEIF and KRS lookups |
| `scripts/sort-filings`, `check-filings` (+ `expected.json`, 40 reports), `import-filing`, `reparse-filings` | 680 | CLI commands, known answers | |
| Their tests and fixtures | ~1,900 | `core/test/catalyst/filings/`, `issuers/` | They come with the code and must pass unchanged in substance |

Not ported: Step Functions and Bedrock analysis (`analyzeIssuer`, `classifyIssuer`, `selectIssuers`), whose work moves to the agent, and CV's e-mails.

## Code layout

```
infra/catalyst.ts                              + exits schedule, agent routes, uploads prefix
packages/core/src/catalyst/
  items.ts                                     + NameItem, EntityItem, FinancialYearItem, InterimItem, FilingItem,
                                                 AnalysisItem, CheckItem, KnownItem, CollectedFiguresItem, ExitItem
  repository.ts                                + their reads and writes (history kept: a replaced year's previous version)
  exits.ts                                     parser of GPW's suspension/exclusion pages and markings
  issuers/identity.ts, gleif.ts, krs.ts, scope.ts, scorecard.ts, refinancing.ts, confidence.ts, trackRecord.ts, ttm.ts (N8)
  filings/krsXml.ts, krsLines.ts, esef.ts, ifrsText.ts, zip.ts, pdf.ts, transcript.ts, lines.ts, years.ts, checks.ts
                                                 (checks.ts also used by the API on received rows)
  schemas.ts                                   zod schemas of every CLI input (also `catalyst schema <kind>`)
packages/jobs/src/catalyst/
  handlers/exits.ts                            the exits job
  handlers/api.ts                              + entities, names, filings (rows), checklist, analyses, figures, agent dispatch
packages/cli/                                  `catalyst` (bin), commands, login, API client, --table output; parsing and checks via core
packages/web/src/catalyst/
  IssuersView.tsx, IssuerDialog.tsx, Scorecard.tsx, Financials.tsx, Checklist.tsx
.claude/skills/catalyst-analyst/SKILL.md       the agent's procedure (design, "Agent skill")
Docs/catalyst-methodology.md                   moved from CV in N4
scripts/catalyst-migrate-cv.ts                 N5 (read only on CV)
```

## Preparation

Small changes before the milestones. None of them adds resources or changes data.

| # | Change | Status |
|---|---|---|
| Q1 | Dependencies: `fast-xml-parser` in core, `pdfjs-dist` in the CLI only (versions as CV's, checked for advisories); a zip reader (CV's own `zip.ts`, no new package) | Done in N3: both in core (5.11.2, 4.10.38; no advisories), reached only through `catalyst/filings/index`, which no function imports |
| Q2 | `CatalystView.tsx` (≈ 800 lines) split into `web/src/catalyst/` (table, filters, panel, chart, settings) before the issuer columns and dialog are added | Done 2026-11-07: `catalyst/` with `CatalystView.tsx`, `types.ts`, `labels.ts`, `filters.ts`, `parts.tsx`, `YieldChart.tsx`, `BondPanel.tsx`, `ViewsMenu.tsx`, `AssumptionsPanel.tsx` |
| Q3 | `packages/cli` workspace skeleton: `npx catalyst --version` | Done 2026-11-07: `npx catalyst --version`, `--help`, `where --stage` (the stage's API, the settings directory in the user's profile); unit tests; in `typecheck`. The token login comes with N7 |

## Milestones

### N0 Checks before building

**Done 2026-11-07.** Findings in [catalyst.md](catalyst.md#checked-2026-11-07-phase-2-n0):
- **Exits:** GPW's exits archive is one page since 2018 with the issuer's LEI on every row, but it lists only early ends and suspensions. Ends at maturity come from the daily-file archive. Board resolutions aren't needed.
- **Identity:** GLEIF's ISIN mapping found 36 of 40 sampled issuers, and the KRS API gives PKD codes and liquidation entries.
- **Interim reports:** every Catalyst bond issuer must publish a half-year report (3 months) and an annual one (5 months); companies with listed shares also publish quarterly.
- **CatalystViewer:** 171 identities, 128 years of 43 companies, 85 originals.

No deploy. Findings go into `Docs/catalyst.md` (data sources, open questions).

1. **GPW exits:** the suspensions and exclusions page, Catalyst notices and special markings (`/1`–`/23`): their URLs, layout and depth back to 2018; robots.txt (CV §11 says allowed).
2. **GLEIF and KRS APIs from Lambda:** reachable, rate limits, a KRS extract's fields (name, legal form, PKD, register dates).
3. **Interim reporting duties:** which periodic reports bond-only issuers must publish (GPW main market vs the Catalyst alternative system), from GPW's rules. Then, among the issuers in scope, how many publish quarterly, half-year or only annual reports. This decides N8.
4. **CV's data, read only:** counts of identities, profiles, financial years per format, filings in the bucket, PDF transcripts, analyses; which filings have no original.

Done when: each item has an answer in the design doc, and N8's go/no-go is put to you.

### N1 Exits and the repayment track record

**Done 2026-11-07.** What was built:
- `core/catalyst/exits.ts`: the parser and `planExits`;
- `trackRecord.ts`;
- the `catalyst-exits` job at 10:00;
- the `suspended` and `marked` flags in the metrics;
- the bond detail's `events` and `track`, shown in the panel's *Track record* tab.

First run on dev: 1,859 measures on 706 bonds. Track records of the corporate bonds: 355 repaid, 222 early, 28 below par, none past maturity or unknown (catalyst.md, "Repayment track record").

Changed on the way:
- **Board resolutions aren't used** (N0).
- **Ends at maturity come from the daily-file archive.**
- **Suspensions in the participants' interest and safety are "worth a look", not red flags.** In the first run, 19 of the 30 issuers with flags had only these, mostly one-day technical stops (Marvipol, Robyg, Ronson).
- **The prefix grouping splits a few issuers** (VI1/VID); N2 replaces it with companies.

Design step 8: the `catalyst-exits` job and the track record, per issuer name until N2 joins names to companies.

- `exits.ts`: GPW's current and archive pages (one request each; a row can name several ISINs) → per bond: the date, the action, the reason, the issuer's LEI; the markings page → markings, whose history the job keeps from its first run.
- `handlers/exits.ts` at 10:00 Mon–Fri: archive raw, write the exit on the bond item, markings as `BOND#<isin>/MARK#<date>`; the archive page is the backfill to 2018 (one request, no queue). An LEI found there is offered to N2's identity.
- `trackRecord.ts`: for a set of bonds, the number repaid at maturity, redeemed early, ended below par (last close < 98 within 10 sessions of the end), still listed past maturity, and unknown; red flags (a marking, an extension, a buy-back below par); the period covered. Inferred facts are labelled as inferred.
- Bond panel: a *History* line (how and when a past bond ended); the bonds table gets a "marked" tag.
- Tests: the parser on stored pages; the track record on synthetic and real cases (a GetBack bond, a bond repaid early, an extension).

Done when: every bond that ended since 2020 has a reason or "unknown". On dev, GetBack's bonds show as red flags and Kruk's as repaid. This needs no approval: these are new items in the module's table, rebuildable from the archive.

### N2 Identity: names and companies

**Done 2026-11-08.** What was built:
- `core/catalyst/identity.ts`: the GLEIF and KRS clients (take a fetch function), `planIdentity`, `planFallbackLinks`, short names;
- `jobs/catalyst/identity.ts`: run after the terms job, 60 bonds a run, saving every 50, retrying rate limits and server errors;
- `scripts/catalyst-identity.ts` for the backlog and `scripts/catalyst-ai-holdings.ts`;
- the routes `GET /catalyst/entities[/{id}]`, `GET /catalyst/names`, `PUT /catalyst/names/{name}[/ai]`, `PUT /catalyst/entities/{id}[/ai]`;
- the bond table showing short names; the track record by company;
- the export of companies, names and links.

Dev, 1,030 bonds of companies (2020 on):
- **Linked:** 948. Of these, 312 through GLEIF's ISIN mapping and 325 through the LEI on GPW's measures. Another 18 through their listed name: Orlen's and PKO's bonds GLEIF doesn't map. Another 293 ended bonds through a code prefix only one company has (inferred). That leaves 82 ended bonds without a company.
- **Listed bonds:** all but 3 (ING Bank Hipoteczny: left for the agent).
- **Companies:** 145, 138 with a KRS number. One has a liquidation open (Polski Bank Spółdzielczy w Poznaniu).
- **Names:** 82 resolved, 11 to review, 1 unresolved. The ones to review are mostly full legal names (PKO, Pekao, PZU, PGE) and one financing vehicle (Pepco → PEU (FIN) PLC).
- **Time:** about 25 minutes for the backlog.

Changed on the way:
- **Links are their own items** (`BOND#<isin>/ENTITY`): the daily job rewrites the bond's.
- **GLEIF is asked one ISIN at a time:** a batch doesn't say which record is which ISIN's.
- **Bonds no source maps are marked and asked again a month later.**
- **KRS section 6 is read as "liquidation open"** (an entry without an end) plus the kinds of entries: Vantage's liquidation of 2001 was lifted in 2006.
- **The listed-name and code-prefix fallbacks** were added after the first run left Orlen and PKO's bonds unlinked.
- **Names are compared without diacritics** (Żabka / Zabka).
- **Short names you set are kept** (`shortNameSet`); the code's are refreshed each run.

- Items: `NAME#`, `ENTITY#`; `entityId` on the bond.
- `gleif.ts`, `krs.ts` in core (fetch-based, used by the terms job and the CLI; the job archives responses under `raw/catalyst-identity/`); `identity.ts` ported: ISIN → LEI mapping, exact name match, LEI record and parent, KRS extract.
- `catalyst-terms` resolves new issuer names on its runs (design, "Jobs"). A one-off run resolves the names already in the table. Names that aren't resolved stay `unresolved`; a legal name that differs from the listed one stays `review`.
- API (read): `GET /catalyst/entities`, `GET /catalyst/entities/{id}`, `GET /catalyst/names`. API (write, you): `PUT /catalyst/names/{name}` (link, confirm), `PUT /catalyst/entities/{id}` (short name, industry, sub-type, override) and `PUT /catalyst/entities/{id}/ai` / `PUT /catalyst/names/{name}/ai` (the AI analysis switch, with who and when; a name's passes to its company when linked).
- AI analysis on from the start for the issuers of bonds you hold: a script reads PT's holdings once (read only) and switches their companies on.
- The export gains names and companies.
- Tests: CV's identity tests; the job resolving on fixture responses; the routes (401, validation).

Done when: on dev at least 90 % of the corporate issuer names are resolved automatically (CV: 192 of 208), the rest are listed as `unresolved` or `review`, and the bonds table's issuer column shows short names where they're known. This needs no approval: new items only, and the names can be resolved again.

### N3 Reading reports

**Done 2026-11-08.** What was built:
- **The parsers:** CatalystViewer's moved into `core/catalyst/filings/` behind their own entry point (`@portfolio/core/catalyst/filings/index`, so no function bundles the XML parser or `pdfjs-dist`). The KRS XML, ESEF and IFRS text parsers, the PDF transcript check and the statement lines, with their 175 tests and fixtures, unchanged in substance. The Bedrock call is gone; `filingFromTranscript` takes the agent's copy. The type fixes PT's stricter settings asked for are assertions only.
- **`core/catalyst/financials.ts`:** the rows a filing gives, the most recent report winning (`planYears`), and the app's own checks of received rows (`rowChecks`: the balance sheet adds up, its lines add up to their totals). Also the known-answer comparison.
- **`jobs/catalyst/filings.ts` (`storeFiling`):** the checks, the original's SHA-256, the original into `catalyst/filings/<entity>/…`, the years (replaced ones as `FINOLD#`), the filing record, the metrics queued.
- **The API:** `POST /catalyst/filings/upload-url`, `POST /catalyst/filings` (422 when refused), `PUT /catalyst/entities/{id}/years/{period}` (review); the company view lists its years and filings.
- **The scripts:** `catalyst-import-filing.ts`, `catalyst-cv-filings.ts`, `catalyst-filings-check.ts`.

Dev:
- **CatalystViewer's files:** all 85 originals read again, none downloaded from the sources. The 67 structured ones gave 103 financial years of 37 companies (2023–2025); every year's figures equal CatalystViewer's.
- **Known answers:** the 21 ESEF ones match, both as stored and on a fresh read. The other 18 are PDFs, left for N5 with the 18 PDF files and one company not in the module yet (LEI 213800OVMJPFP79OB449).

Not done here: a lifecycle rule for `catalyst/uploads/` (a change to the files bucket: yours to approve). An import deletes its upload; only abandoned ones (a dry run never followed) stay.

The ported parsers, run locally, and the API that stores their result. The CLI's commands come in N7; until then a script (`scripts/catalyst-import-filing.ts`) parses locally and writes through the repository inside `sst shell`, as phase 1's scripts.

- `filings/*` ported with their tests and fixtures; the PDF transcript route with the amounts checked against each page's text, locally.
- CV's originals (85 files, 43 companies) copied from its prod bucket (read only) into dev's `catalyst/filings/`: the test corpus, not downloaded again.
- API: `POST /catalyst/filings/upload-url`; `POST /catalyst/filings { key, sha256, entityId, rows, extraction }` checks the schema, re-runs `checks.ts` on the lines, compares the SHA-256, stores the original and the rows, and returns what was kept or replaced. `GET /catalyst/filings/{sha}` returns the stored result.
- Rows: `FIN#…` with `filing`, `review: parsed`, `enteredBy`; history kept (`FIN#…#V<n>` for a replaced version); most recent report wins with the per-company exceptions (§16).
- Known answers (`KNOWN#`) and `filings check` as a script (`scripts/catalyst-filings-check.ts`) until the CLI has it.
- Tests: CV's parser tests unchanged in substance; the API refusing rows that fail a check or whose SHA-256 doesn't match; most recent wins (Indos's restated 2024); the 40 known answers.

Done when: every one of CV's 40 known-answer reports imports on dev with the same figures as `expected.json`, and a refused import says which check failed.

### N4 Scorecard, refinancing, confidence

- `scope.ts`, `scorecard.ts`, `refinancing.ts`, `confidence.ts` ported. Rule sets (general, developer, contractor, consumer and services, collector, leasing and factoring, investment firm) with their thresholds; the finance map and overrides now live on the company items.
- `GET /catalyst/entities/{id}` adds the scorecard, refinancing, confidence and track record, computed on read.
- `catalyst-metrics`: per company, once a run, the signals (six colours, trend arrows, rule set, confidence, "no report", "not scored") copied into its bonds' screen rows. A company write queues the metrics.
- `Docs/catalyst-methodology.md` moved from CV (state v1.75) with section numbers kept; the design's "§" references point to it.
- Tests: CV's scorecard tests (sectors, finance, confidence, maturities) unchanged in substance; a screen row carrying its company's signals.

Done when: for the companies imported in N3, every dimension's colour and metric equals CV's for the same year (CV's trend colour against the arrows), or the difference is explained (fresher bonds data from phase 1, for example) and written down.

### N5 Migration of CatalystViewer's issuer data ⚠ approval

This writes data on prod that exists nowhere else (design, "Migration from CatalystViewer").

- `scripts/catalyst-migrate-cv.ts` (read only on CV, `--dry-run` by default):
  - identities, with confirmed ones kept confirmed, become names and companies;
  - profiles, the finance map and overrides go onto the companies, marked as yours; every company with reports gets AI analysis on;
  - every original in CV's filings bucket (85) is copied and re-imported through N3, never downloaded again; a PDF from a transcript rebuilt from CV's stored lines (label, page, amounts) and checked against the PDF; each year compared with CV's `IssuerFinancials` row;
  - `expected.json` becomes known answers, and CV's checklist becomes checklist entries;
  - analyses become judgements and their figures become collected figures, both marked as from CV's agent.
- A report: per company, the years imported, the years that differ from CV (with the reason) and the files without an original.
- Order: dev, a review of the report with you, then prod after your approval.

Done when: prod holds every company CV analysed, each scorecard equals CV's or its difference is on the report, and `filings check` passes.

### N6 Issuers view and the issuer dialog

Design, "UI": "Issuer dialog" and "Issuers".

- Bonds view: the issuer column (six dots and the trend arrows, rule set, confidence; faded when low; "no report yet", "not scored"), the issuer filters (industry, rule set, scorecard, confidence, scored only, track record without red flags, judgement age) and the chart coloured by one chosen dimension.
- The AI analysis switch: "AI analysis off · Enable" in place of the scorecard (table cell, dialog), the switch in the dialog's header and the Issuers view's rows, the filter.
- Issuer dialog (`?issuer=<entityId>`): header, source line, scorecard with metrics, bonds falling due against cash, track record, judgement; tabs *Bonds*, *Financials* (years, lines behind a figure, full statements, review status with the buttons to mark a year `hand-checked` or `flagged`), *Track record*, *Judgements*, *Documents*. It's full screen on a phone.
- `#/catalyst/issuers`: one row per company, with the columns, filters and the *needs work* column; the *Reports checklist* tab.
- Docs: `ui.md`.
- Tests: E2E on a fixed screen and fixed companies (request interception, as phase 1): the filters, the dialog, marking a year hand-checked, phone width.

Done when: on prod you can go from a bond to its company's scorecard and the lines behind each figure, and filter the bonds by "no red in debt service and refinancing".

### N7 CLI, agent token and the agent skill ⚠ approval

This adds a new way into the API (access).

- Agent token: create, revoke and "last used" in the Catalyst settings (`POST`/`DELETE /catalyst/agent-token`, shown once). `/catalyst/agent/{proxy+}` has the token check and the allow-list. The allowed writes are names, companies (not sub-types, overrides or the AI analysis switch), filings, collected figures, analyses and checklist entries. Every write records `enteredBy`.
- `packages/cli`: the commands in the design's table, JSON output by default, `--table`, and `--dry-run` on every write. Parsing, checks, PDF pages, GLEIF/KRS and the scorecard preview run locally; the API only for reading stored rows and writing results. `catalyst login --stage` stores the token in the user's profile, outside the repo. `catalyst schema <kind>` prints the zod schemas as JSON Schema.
- `catalyst work`: only companies and names with AI analysis on; names to resolve, reports due (annual: year end + 5 months; half-year: + 3 months), companies on fallback figures, Finance companies without a sub-type, judgements older than the latest report, new markings and bonds ending below par.
- `.claude/skills/catalyst-analyst/SKILL.md`: the design's eight steps, the limits (N companies a session, never market data, never `--force` without asking) and the robots.txt rules (obligacje.pl and the KRS repository never fetched by the agent).
- Tests: integration on `int` with a test token (each allowed write, each refused route, a revoked token, no PT route reachable); the CLI against `int`.

Done when: an agent session in Claude Code takes one item from `catalyst work` through to a stored judgement on dev, then on prod after your approval of the token's scope. From then on analyses are made in PT; CV keeps running (N9 on hold).

### N8 Interim reports

Design, "Interim reports". Go (2026-11-07): step 1 for the companies that need it (on demand), step 2 only if step 1 proves useful.

1. **Interim balance sheet:** `INT#` rows; the transcript states the period, the months and the columns; the checks also confirm that the columns are labelled with their periods. The scorecard takes the point-in-time items from the latest interim period newer than the year when the scope and standard match. The confidence notes "unaudited", and the source line names the period.
2. **Trailing 12 months:** `ttm.ts` (full year + year to date − the comparative), used in debt service and profitability when every input is present. There's a flag when the next audited year differs by more than 5 %. The *Financials* tab gets the TTM column.
3. `catalyst work` lists the half-year report (30 June + 3 months) for companies with AI analysis on that need it (bonds due within 24 months; debt service, liquidity or refinancing yellow or red; or asked), and quarterly ones only when asked. `filings sort` names them `<year>Q<n>` or `<year>H1`.

Tests: TTM on hand-computed cases (including a part year that must be refused and a scope mismatch); the scorecard switching sources and back once the next year arrives.

Done when: for the issuers in scope that publish interim reports, the latest one is imported on prod, and their scorecards show "+ Q… (TTM)".

### N9 CatalystViewer handed over

**On hold** (owner, 2026-11-07: CV is not switched off for now). When it's taken up, proposed to you once N7 has run for a few weeks:

- switch off CV's issuer jobs and its bonds updater (phase 1's parts);
- keep CV read-only for a month;
- then delete its stacks, tables and buckets.

Each step is your call. This plan only prepares them: it checks that every CV table has been migrated or deliberately left behind, and keeps a final export of CV's tables in PT's files bucket.

## Tests

| Kind | What | Where |
|---|---|---|
| Unit | Exits parser, track record, identity, every filing parser (CV's fixtures), statement lines and checks, most recent wins, scorecard, refinancing, confidence, TTM | `packages/core/test/catalyst/` (+ `filings/`, `issuers/`); fixtures copied from CV |
| Known answers | The 40 reports' hand-read figures; run after any parser change | `filings check` (script in N3, CLI in N7) |
| Integration | Entities, names, filings import (upload, dry run, refusal), agent token (allowed, refused, revoked), the metrics after a company write | `packages/jobs/test/integration/catalyst*.test.ts` on `int` |
| E2E | Issuer columns and filters, issuer dialog, marking a year, Issuers view, checklist, phone width | `packages/web/e2e/`, request interception on fixed data |
| CLI | Every command against `int` with the test token | `packages/cli/test/` |

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Porting changes a parser's result | Wrong figures behind the colours | CV's tests ported unchanged in substance; the 40 known answers; N5 compares every migrated year with CV's row |
| Scorecard differs from CV's | Doubt about which one is right | N4 compares company by company; every difference explained in writing before N5 |
| The agent writes wrong data | Wrong judgement or figures | Dry run on every write; checks refuse bad imports; `review` states and the hand-checked mark; append-only analyses; replaced years kept |
| A token leak | Writes to the issuer data | Only the hash stored; narrow allow-list; no market data, settings or PT; revocable; "last used" shown |
| Rows sent by the CLI don't match the file they claim | Wrong figures stored | The token is yours and narrow; the API re-runs the arithmetic checks and the SHA-256; `filings check` re-parses the stored originals; review states |
| GPW or GLEIF change their pages or API | Exits or identity stop | Raw responses archived; loud failures; alerts as the other jobs |
| obligacje.pl's `ai-input=no` | A rule broken by the CLI | Owner decision 1 before N7; the CLI returns derived figures only |
| CV keeps running beside PT (owner, 2026-11-07) | Two places with diverging judgements | CV's data is migrated once (N5) and not synced; analyses are made in PT from N7 on; CV's later results aren't imported |
| Interim reports cost too much reading | Agent time | N8 is optional and comes last: balance sheet first, TTM after, publishing issuers only |

## Done when

- Every corporate bond is linked to a company, or listed as needing it.
- Every company in scope has a scorecard from its latest full year (and interim period, after N8), with its confidence, refinancing and track record. Otherwise it is listed in `catalyst work`.
- The bonds table filters and colours by the scorecard. The issuer dialog shows each figure's lines and source.
- An agent in Claude Code keeps it current through the CLI, and you check its work in the app.
- CV's issuer data is migrated (CV keeps running; switching it off is on hold).
- The design, the methodology document and the ui, data-storage, ingestion and data-sources docs describe what was built.
