# Catalyst module (design)

Status: proposal (2026-11-05), nothing built yet. It moves the functionality of CatalystViewer (CV) into PortfolioTracker as a separate module: the whole Catalyst bond market, not the bonds you hold. Functionality is migrated, not CV's solutions: sources, storage and mechanics follow PT.

The **methodology** ([catalyst-methodology.md](catalyst-methodology.md), moved from CatalystViewer on 2026-11-08 at its state v1.75) is the reference for phase 2: identity, reports, statement lines, rule sets, thresholds, refinancing, data confidence, the judgement and the known exceptions. Section numbers below (§) point there.

| Phase | Contents |
|---|---|
| 1 – Market | Daily data of every Catalyst bond; browsing with filters; yield to maturity against an alternative; risk premium over treasury bonds; liquidity |
| 2 – Issuers | Company identity, filed annual reports read by code (then interim ones: quarterly and half-year, for a fresher balance sheet and trailing 12 months), the 6-dimension scorecard (with trend arrows) and data confidence, refinancing, repayment track record; the work that needs judgement or reading (finding reports, PDFs, the written judgement) done by an AI agent outside the app through a CLI |

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
  - [AI analysis per company (on/off)](#ai-analysis-per-company-onoff)
  - [Interim reports](#interim-reports)
  - [Later](#later)
- [The `catalyst` CLI (the agent's interface)](#the-catalyst-cli-the-agents-interface)
- [An analysis, end to end](#an-analysis-end-to-end)
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
| Exits | GPW's suspensions and exclusions (current page and the archive since 2018, one page each), Catalyst's special markings of instruments | Why a bond stopped trading early or was suspended, with the issuer's LEI; markings `/1`–`/23` (bankruptcy, restructuring …). Redemptions at maturity aren't listed: they come from the daily-file archive. GPW's robots.txt allows it. Checked 2026-11-07 (below). |
| Treasury curve | The daily file (treasury segment) | Fixed-rate DS/PS/WS pay a constant coupon (the file's rate) yearly on the maturity's day and month, so their yields need no other source; WZ margins from the series' terms. |
| Alternative | PT `market`: `SERIES#` (Ministry retail-bond file) | The retail bond on offer with the nearest term, or a rate you set. |
| WIBOR / WIRON | None (assumption in the settings) | No free fixings source; floating coupons not yet set use the assumed rate + margin. |
| Identity | GLEIF API (ISIN → LEI, name search, LEI record, parent), KRS register API `api-krs.ms.gov.pl/api/krs/OdpisAktualny/<KRS>` | Open; resolved 192 of 208 CV issuer names automatically (§5). |
| Annual reports | KRS repository (by hand), issuers' investor-relations sites, Bankier.pl mirrors of ESPI reports (listed companies; assistants allowed; attachments 404 after about a year), filings.xbrl.org (ESEF by LEI; Polish filings stop at FY2022, foreign issuers later) | Formats and reading below; CV §7. |
| Interim reports | Issuers' investor-relations sites, Bankier.pl mirrors of ESPI/EBI periodic reports | Every Catalyst bond issuer publishes a half-year report (within 3 months); companies with shares on the regulated market also Q1 and Q3. Not in the KRS repository and not ESEF-tagged, so in practice PDFs. Checked 2026-11-07 (below). |

Reachability: PT's data-sources.md noted gpwcatalyst.pl unreachable from the dev machine on 2026-10-12; on 2026-11-05 it answered normally. Check from Lambda (eu-west-1) before building. GPW's move to WATS may change the file and the pages; parsers look columns up by header and fail loudly.

### Checked 2026-11-06

Phase 0 (P7) checks; fixtures in `packages/core/test/fixtures/catalyst/`.

- **Daily file, two layouts.** `.xls` from 2020 (and before) to **2026-10-02**, `.xlsx` from **2026-10-05** (GPW's move to WATS); for a day only one of the two exists (the other answers 302). Sheets `statystyka`, `instrumenty`, `transakcje pozasesyjne`, `legenda` in both. Header rows 1–5 of `instrumenty`, Polish and English labels. Columns A–R are the same in both (maturity, current rate, accrued interest, nominal, market, trading system, segment, ISIN, name, currency, close, reference, change, open, low, high, last); the `.xlsx` adds two average prices (aggregated, order book, cross: S–U instead of S), which moves **number of trades, volume, turnover** from T–V to V–X and block trades from W–X to Y–Z. Columns are therefore found by their labels. Samples of every half-year 2020–2026 share the old layout exactly.
- **One mislabelled file:** `catalyst_20250625.xls` holds the session of 2025-06-24 (its date and figures; a different file otherwise), so 2025-06-25 is missing from the archive. A file whose date isn't its name's is skipped (found by the backfill on 2026-11-06).
- **Segments** (rows without an ISIN): corporate, co-operative, municipal and EIB, treasury and BGK, mortgage covered, public covered; convertible bonds until 2021, then "Bank securities" (from 2022).
- **One ISIN, several rows:** a bond listed on GPW and BondSpot has a row per market (`GPW RR`, `GPW ASO`, `BS RR`, `BS ASO`). BondSpot rows of treasury bonds carry stale reference prices (DS0432 on 2026-11-04: 82.19 on GPW, 99.40 on BondSpot; OK0127 99.48 vs 89.74): sessions are stored per market and **prices, the curve and liquidity use the GPW row**, BondSpot's only for a bond listed on BondSpot alone.
- **Treasury rows:** DS, PS, WS, OK (zero coupon: no rate), WZ and NZ (floating), IZ (indexed nominal, e.g. 1080.1), EUR (in EUR), BGK, PFR, FPC and others. Fixed-rate DS/PS/WS give the curve; WZ's margin isn't in the file (current rate only).
- **2026-11-04 by segment:** 307 corporate rows (36 in EUR, 11 on BondSpot only), 566 municipal, 136 treasury and BGK, 41 covered, 2 co-operative, 0 bank securities.
- **robots.txt of gpwcatalyst.pl** disallows only one NewConnect path: the daily file, quotes pages and instrument pages are allowed.
- **Quotes pages** (all six fetched; same structure as CV's fixtures of 2026-10-26): one table per currency, a row per bond with **issuer** (link `emitenci-obligacji-karta?nazwa=<issuer>`), code (link `o-instrumentach-instrument?nazwa=<code>`), segment, reference, open, low, high, last trade date/time, last trade volume, last, change, best bid (orders, volume, limit), best ask (limit, volume, orders), trades, volume, turnover. **No session date** on the page: the last-trade cell shows a **time** for trades in the page's session and a date for older ones (fetched 2026-11-06 at about 11:25: 61 corporate bonds with times, the latest date 2026-11-05), so the page shows the session under way or the last one, and the job sets the date from when it fetched (a trading day after 09:00: that day; otherwise the trading day before). A code can be followed by marker letters (" /S" Warsaw Sustainable Segment, also " /K", " /N", " /P", " /W", " /Z", up to two at once, e.g. "PKO1034-K /W /K"); the daily file names the bond without them. The issuer's cell spans all its bonds' rows. Today's full pages: 297 corporate rows (261 PLN, 36 EUR), 78 treasury, 518 municipal, 2 co-operative, 36 covered. "Bank securities" lists nothing now.
- **Instrument page** (`o-instrumentach-instrument?nazwa=<code>`): issuer name, authorisation date, first listing, maturity, nominal, **issue value**, coupon type (fixed / floating), current rate, issuer's website. Not the margin, base rate or coupon dates (still obligacje.pl). An allowed source for the issuer and the issue value.
- **WZ margins:** checked by `catalyst-terms` on dev (2026-11-06; obligacje.pl blocks AI assistants, so not by an agent): every WZ series is "zmienne WIBOR 6M + 0%"; the NZ series are "zmienne POLSTR 6M + 0%" (a new reference rate).
- **obligacje.pl's pages aren't always consistent:** 17 of the first 444 have date lists that don't add up (e.g. 13 record days for 12 periods, a period whose dates are in the wrong order); one code's page is another bond's (GRU1138). The terms job keeps what it can (issuer, issue value, coupon) and records the problem.

### Checked 2026-11-07 (phase 2, N0)

- **GPW's exits** ([gpw.pl/zawieszenia-i-wykluczenia](https://www.gpw.pl/zawieszenia-i-wykluczenia)): robots.txt (gpw.pl and gpwcatalyst.pl) disallows only one NewConnect path.
  - **The current page** lists the 129 measures in force.
  - **The archive** (`zawieszenia-i-wykluczenia-archiwum`) is **one page**: 2.2 MB, 3,269 rows from 2018-01-04, no paging.
  - **Columns of both:** published, action (suspension, lifting, exclusion), reason, from, to, in force, MIC, issuer, **issuer LEI**, ISIN(s) (comma-separated, one row can cover a whole series), code(s), notes.
  - **Catalyst rows** (MIC `WBON`, `WMTF`, `BOSP`): 1,253, for 623 ISINs, every one with an LEI.
  - **Ordinary redemptions at maturity aren't listed.** The exclusions are 37 early redemptions, 10 redemptions/cancellations, 7 at the issuer's request, 4 bankruptcies. The suspensions are mostly routine: at the issuer's request before a redemption (533), missing interest data for settlement (441). Some are signals: in the participants' interest (74), at the KNF's demand (31).
  - **So the track record** = the daily-file archive (when a bond stopped trading, its last price) + this archive (why it stopped early or was suspended) + markings.
- **Special markings** ([gpwcatalyst.pl/szczegolne-oznaczenia-instrumentow-finansowych](https://gpwcatalyst.pl/szczegolne-oznaczenia-instrumentow-finansowych)): a small table (issuer, marking); today one issuer (Kancelaria Medius, `/8`). It shows the current state only, so the job keeps its own history from its first run.
- **Board resolutions** (`gpwcatalyst.pl/uchwaly-zarzadu`): 10 a page, each with its own page, about 1,500 a year (mostly municipal suspensions before redemption). Not used: the exits archive covers the same events with the ISIN and the LEI in one request.
- **GLEIF:** `api.gleif.org/api/v1/lei-records?filter[isin]=<ISIN>` found the LEI for 36 of 40 randomly chosen listed corporate bonds (dev, 297 listed corporate). The LEI record gives the legal name, **the KRS number** (`registeredAs`), legal form, status and parent. 0.2–0.3 s a request from the dev machine; Lambda is checked on N2's first dev run. The exits archive adds the LEI of 623 bonds' issuers, ended ones included.
- **KRS register API:** `api-krs.ms.gov.pl/api/krs/OdpisAktualny/<KRS>?rejestr=P&format=json` (open, 0.3 s) gives name, legal form, PKD (business activity: e.g. a developer's "realizacja projektów budowlanych …") and `dzial6` (liquidation, dissolution, merger/division/transformation).
- **Periodic reports of Catalyst bond issuers:**
  - **Bond issuers on the Catalyst alternative system** must publish **a half-year report within 3 months of 30 June and an annual report within 5 months of the year end** (GPW, Annex 4 to the Alternative System's rules, § 11–15). Group (consolidated) ones when the issuer is a parent. Exempt from the half-year: issuers of bonds with a nominal of at least EUR 100,000 whose parent is listed on GPW's regulated market (the parent's reports instead). Municipalities: budget reports instead.
  - **Companies whose shares are on the regulated market** report quarterly (Q1, H1, Q3) and annually under the Ministry of Finance regulation.
  - **So every corporate issuer** has at least a half-year report, mostly as a PDF in EBI and on its website.
- **CatalystViewer's issuer data** (prod, read only):
  - 171 identities (all confirmed) and 172 profiles (11 industries);
  - 128 financial years of 43 companies: 85 ESEF, 27 PDF read by transcript, 16 KRS XML; 113 group, 15 single; all 12 months; FY2023–2025;
  - 43 companies with a latest analysis (88 analyses in all, May–November 2026);
  - its filings bucket holds 85 originals (49 ESEF packages, 19 PDFs, 11 KRS XML, 6 xhtml).

  The PDF years' lines (label, page, amounts) are stored, so their transcripts can be rebuilt.

## Storage: table `catalyst`

On-demand, PITR on, deletion protection on `prod`, TTL attribute `ttl`. Same key schema as PT (`PK`, `SK`, sparse `GSI1PK`/`GSI1SK`). Dates `YYYY-MM-DD`; prices clean in % of nominal; report figures in units of their currency.

### Market (phase 1, rebuildable)

| Item | PK / SK | GSI1 | Contents |
|---|---|---|---|
| Bond | `BOND#<isin>` / `META` | `BOND` / `<code>` | code, name, type (segment), markets (GPW, BondSpot: one ISIN counted once), currency, current nominal, issued nominal, issue value, maturity, coupon type (`FIXED`/`FLOATING`/`ZERO`/`INDEXED`), base rate, margin, callable, amortising, `issuerName` (as listed), status (`listed`/`suspended`/`ended`), first and last session seen, exit (date, reason, source, last price before it) |
| Session | `BOND#<isin>` / `D#<date>#<market>` | – | close, reference, open, low, high, last, trades, volume, turnover, block trades, nominal, rate, accrued interest (the daily file) |
| End-of-session quotes | `BOND#<isin>` / `Q#<date>#<market>` | – | best bid and ask (price, volume, orders) and the page's trades; only bonds with a bid or an ask (the quotes pages; its own item, as the quotes come before the daily file in the evening). Before 2026-11-06: CatalystViewer's history (2023-12 on, source `catalystviewer`: snapshots during the session, no order sizes) |
| Loaded sessions | `DAYS` / `<date>`, `QUOTEDAYS` / `<date>` | – | a daily file loaded (rows, bonds, file); a session's quotes stored |
| Coupon period | `BOND#<isin>` / `COUPON#<start>` | – | As PT's `CouponPeriodItem` |
| Screen row | `BOND#<isin>` / `SCREEN` | `SCREEN` / `<code>` | Computed metrics (below), the issuer's signals copied for one-query reads, `computedAt` |
| Treasury curve | `CURVE#PLGOV` / `<date>` | – | points `{ years, yield, isin }`, fitted curve |
| GPW measure | `BOND#<isin>` / `EVENT#<published>#<action>` | – | A suspension, lifting or exclusion from GPW's pages (`catalyst-exits`): reason, its signal (`routine`, `data`, `early-redemption`, `redemption`, `distress`, `attention`, `other`), from, to, in force, issuer, issuer LEI. Rewritten each run that sees it |
| Marking | `MARKS` / `<issuer>#<marking>` | – | A special marking of an issuer's instruments, first and last day seen, current or not (the page shows only the current ones: the history is ours) |
| In force now | `EXITS` / `CURRENT` | – | The latest run's suspended bonds (reason, from) and marked issuers: read by the metrics for the `suspended` and `marked` flags |
| Job run | `JOB#<name>` / `RUN#<startedAt>` | – | As PT, `ttl` 90 days |

Amount owed per bond = issue value × current nominal / issued nominal (§4: instalment bonds such as KRU0228, RES0228; IZ bonds).

### Issuers (phase 2, mostly not rebuildable)

Bonds are joined to reports **through the company's identity, never by matching names** (§1 principle 4, §5).

| Item | PK / SK | GSI1 | Contents |
|---|---|---|---|
| Bond's company | `BOND#<isin>` / `ENTITY` | `LINK` / `<isin>` | `entityId` and LEI (null when no source names the issuer yet: asked again a month later), how (`gleif-isin`, `gpw-exits`, `listed-name`: another bond of the same listed name was linked; `code-prefix`: an ended bond whose code prefix only one company has, inferred; `hand`; `none`), when. Its own item: the daily job rewrites the bond's |
| Issuer name | `NAME#<issuer name as listed>` / `META` | `NAME` / `<name>` | `entityId`, `aiAnalysis` (a switch set before the name is linked; it passes to the company), `financialsEntityId` (a financing vehicle points at its group: PEU (FIN) PLC → Pepco Group N.V.), evidence (ISIN mapping, exact name match, by hand), status (`resolved`, `confirmed`, `review`, `unresolved`). Several names can point at one company (Orlen / PKN Orlen; Kredyt Inkaso → Best) |
| Company | `ENTITY#<entityId>` / `META` | `ENTITY` / `<short name>` | `entityId` = the KRS number for a Polish company, else `LEI:<lei>`; **short name** (shown everywhere, e.g. "Kruk": from a listed name that agrees with the legal name, else the legal name, without legal forms; refreshed by the code unless you set it, `shortNameSet`), legal name, country, KRS, LEI, LEI status (`ISSUED`/`LAPSED`/…), register, category, parent; industry (fixed list, §6), business summary, website; finance sub-type (`collector`/`leasing`/`investment`/`out`) and rule-set override with its reason; year end; **`aiAnalysis`** (`off` default / `on`, by whom and when; see "AI analysis per company"); notes and exceptions (§16) |
| Financial year | `ENTITY#<entityId>` / `FIN#<period end>#<group\|single>`; replaced versions `FINOLD#<period>#<importedAt>` | – | CV's `IssuerFinancials` row (§15, `core/catalyst/financials.ts`): period, months, currency, standard, presented unit, line signs, `lines` (every line of the three statements: label, value, code or XBRL concept, anchor, parent, page, standard item), `items` (item totals, `debtDueWithinYear`), `figures` (each with its sources), `review` (`parsed`/`hand-checked`/`flagged`), `column` (current/previous), `reportPeriodEnd`, `filing` (S3 key, sha256, format, schema, checks, notes, extraction: who read it), `enteredBy`, `importedAt` |
| Interim period | `ENTITY#<entityId>` / `INT#<period end>#<GROUP\|SINGLE>` | – | A quarterly or half-year report's statements, as a financial year's row (lines, items, figures, review, filing, `enteredBy`) plus `months` (year to date: 3, 6 or 9; a quarter-only column is kept in the lines but not used), the fiscal year it belongs to, `audit` (`none`/`reviewed`/`audited`), and the prior-year comparative column (needed for trailing 12 months) |
| Collected figures | `ENTITY#<entityId>` / `AIFIG#<collectedAt>` | – | Fallback figures collected from the web by an agent when no report is available (§9): marked as such, never for lenders, confidence medium at most |
| Filing | `ENTITY#<entityId>` / `FILING#<sha256>` | – | Original document: format, fiscal year, scope, source URL, S3 key, import result |
| Analysis | `ENTITY#<entityId>` / `ANALYSIS#<ts>`, mirror `ANALYSIS#LATEST` | – | The agent's written judgement (§13, §14 layout), red flags with source and quote, what to watch, sources read, model, and the scorecard version it saw |
| Document | `ENTITY#<entityId>` / `DOC#<sha256>` | – | Another document a judgement rests on (auditor's report, management report, interim or current report, bond terms): kind, its date, title, where it came from, who stored it; the original at `catalyst/documents/<entity>/<date>-<kind>-<sha12>.<ext>`, once per SHA-256 (N8) |
| Payment event | `ENTITY#<entityId>` / `PAY#<date>#<id>` | – | What the company's own report says about its bonds' payments ("Payment events" below): kind, date, the bonds (none: the company), text, amount, the report, the stored document's SHA-256 and the passage; who and when; `retracted` (who, when, why) instead of deletion |
| Checklist entry | `CHECK#<entityId>` / `<year>#<scope>` | `CHECK` / `<status>` | A report to fetch: company, KRS, year, group/single/any, where it can be found, status (`missing`, `downloaded`, `imported`, `not available`) |
| Known answer | `KNOWN#<entityId>` / `<period end>#<scope>` | – | Figures read by hand from printed statements (CV's `expected.json`, 40 reports), for `check-filings` |
| Setting | `SETTING#<name>` / `META` | – | `assumptions` (WIBOR, WIRON, commission, tax, alternative), `views` (saved filters), `agentToken` (hash) |

**Derived values aren't stored on the company** (as in CV): the scorecard, refinancing and confidence are computed from the rows when read, so a rule change reaches every company at once. `catalyst-metrics` copies the signals into the screen rows for the bond table's filters, and recomputes a company's bonds whenever its rows change.

**The most recent report wins** (§7): a year that appears in two reports keeps the newer report's figures; a row is written only if none exists or the stored row's report is not newer. Exceptions per company (Vindexus FY2024 keeps its own report). The same holds for interim periods; an annual report replaces nothing of the interim rows, which are simply superseded once a full year ends later than them.

Sizing: ~1,060 bonds × ~250 sessions a year ≈ 265k session items a year; backfill from 2020 ≈ 1.6M items (one-off write cost ≈ $2). The screen is ~600 items. Issuers: ~200 names, ~100 companies, a few hundred financial years.

**Backup:** monthly `catalyst-export` of names, companies, links, financial years (with their lines), collected figures, filings and documents (metadata; originals stay in S3, versioned), analyses, checklist, known answers and settings to `exports/<date>/catalyst/`, so a restore is a re-import. (Built in full 2026-11-08; until then it held settings, companies, names and links only.) Market data is rebuilt from the file archive; bid/ask history can't be (accepted).

## Jobs

| Job | When (Warsaw) | What |
|---|---|---|
| `catalyst-daily` | 21:00 (GPW publishes the file between about 19:00 and 20:00), recheck 08:00 Tue–Sat | Downloads the day's file (archives it), upserts bonds (new → `listed`; gone from the file → `ended`), writes sessions, updates current nominals. Backfill mode: a date range from the archive, through a queue, a few files per invocation. |
| `catalyst-quotes` | 17:20 (after the close), 07:45 Tue–Sat (before the pre-opening) | Reads the six quotes pages (archived), stores the best bid and ask of every known bond that has one, for the session the pages show (`quotesSession`: today's after 09:00 on a trading day, else the trading day before). The morning run fills a session the evening missed. |
| `catalyst-terms` | 09:30 | obligacje.pl for bonds without terms (150 a run), then refreshes current coupon rates of floating bonds; adds missing periods, never overwrites a stored date or rate (as PT's `coupons`). Then links up to 60 bonds without a company (company segments, listed first): GLEIF's ISIN mapping, else the issuer LEI on GPW's measures; the LEI records; the KRS extract of a new Polish company. Listed names follow their bonds: `resolved` when the listed and legal names agree, `review` when they differ; names no bond links are `unresolved` for the agent. The backlog: `scripts/catalyst-identity.ts`. |
| `catalyst-exits` | 10:00 Mon–Fri | GPW's suspensions and exclusions (the current page and the archive since 2018: one request each, so the archive is the backfill) and Catalyst's special markings, archived raw: the measures on the bonds the table holds, the markings' history, what's in force now; then queues the metrics. First run on dev (2026-11-07): 1,859 measures on 706 bonds, 73 suspended, 1 issuer marked, 66 ISINs of bonds that ended before 2020 skipped. |
| `catalyst-metrics` | after `catalyst-daily`; on a change of assumptions; after a write to a company | Treasury curve of the day, then a screen row per listed bond. |
| `catalyst-export` | 1st of the month 04:30 | Backup (above); with the settings, in M7. Bid/ask needs none: the quotes pages are archived raw (versioned bucket) and can be parsed again. |

Failures alert as PT's jobs do; `catalyst-quotes` failing after its morning run means that day's bid/ask is lost.

### How jobs run

As PT's jobs: an EventBridge Scheduler schedule (`sst.aws.CronV2`, `timezone: Europe/Warsaw`) invokes a Lambda; one FIFO queue carries the work that doesn't come from a schedule. No Step Functions: CV needed them for the AI analysis (a loop over issuers, steps of up to 10 minutes, a summary e-mail), which now happens outside the app; what's left is short, idempotent jobs whose only chaining ("after the daily file, recompute the metrics") is a queue message. One way of running jobs across PT, with the same job runs, watchdog and alarms.

| Job | Triggered by | Runs as |
|---|---|---|
| `catalyst-daily`, `catalyst-quotes`, `catalyst-terms`, `catalyst-exits`, `catalyst-export` | Their schedules (above) | One Lambda invocation each, seconds to ~1.5 min (`catalyst-terms`: at most ~40 pages 2 s apart; the rest waits for the next day). Scheduler retries a failed run (`retries: 2`, as PT) |
| `catalyst-metrics` | Messages on `CatalystQueue`: from `catalyst-daily` when it finishes, from the API after a change of assumptions or a write to a company (the CLI's writes included) | Lambda subscribed to the queue |
| Backfill of the 2020+ archive (~1,500 files) | The CLI or the API puts date-range messages on `CatalystQueue` (e.g. 20 sessions each) | The same Lambda, one message at a time |

**Why a queue only for these two.** A scheduled job has one trigger at a known time: it can't pile up or overlap with itself, Scheduler retries it, its job run records it, and it fits in one invocation; a queue in front of it would add a hop and give nothing. The two queued kinds differ:

- **Metrics** has many triggers that can come in bursts (an agent session writes ten companies in minutes). The worker takes up to 10 waiting requests at once and runs the metrics once for all of them, one batch at a time, so two recomputes never write the same screen rows at once, and no sender needs to know whether a run is going. An asynchronous invoke with concurrency 1 would serialise too, but not coalesce: ten writes would be ten full recomputes.
- **Backfill** doesn't fit one invocation (~1,500 files at one request every 2 s is about an hour, over Lambda's 15 minutes). The queue holds the chunks, keeps the pace (one at a time), retries a failed chunk on its own and keeps the ones that keep failing in the dead-letter queue, where a Lambda re-invoking itself would lose track of them.

**`CatalystQueue`:** FIFO, one message group (strictly one at a time), a random deduplication id per message (content-based deduplication would drop a request sent while an identical one is still running, which may have read the data before the write), batches of up to 10 merged by the worker (`planBatch`: each backfill range, then the metrics once), visibility timeout above the Lambda's timeout, dead-letter queue after 3 failures (14 days' retention); a malformed message is logged and dropped. Messages: `{ kind: "metrics" }`, `{ kind: "backfill", from, to }`. As PT's `ValuationQueue`.

**Monitoring:** every run writes its job run (`runJob`); the existing watchdog finds runs that didn't happen or didn't finish; a new alarm on the Catalyst dead-letter queue; `catalyst-quotes` failing on its morning run alerts at once (that day's bid/ask can't be fetched later).

## Market metrics (phase 1, screen row)

- **Yield to maturity, gross and net:** from the bond's cash flows (coupon periods on the current nominal; future floating coupons = assumed base rate + margin; nominal at maturity), bought at the last close + accrued interest to T+2 + commission; net after 19 % tax on interest and on the gain at maturity (PT's `buyMore` logic). Callable bonds also get the yield to the first call date.
- **Vs alternative:** net yield − net yield of the alternative over the same term (pp). The alternative is the retail bond on offer with the nearest term (from `SERIES#`) or a rate set by you.
- **Premium vs gov (gross):** fixed coupon: yield − treasury curve at the same maturity; floating: price-adjusted margin − WZ margin of a similar maturity. Blank for non-PLN bonds and bonds without a trade in 90 days.
- **Liquidity (30 and 90 days):** share of sessions with trades, median turnover on traded days, number of trades, median bid/ask spread, order depth at best bid; "days to trade 10 000 zł": sessions to buy or sell that much taking at most 20 % of the average session's turnover (last 30, untraded ones count as 0). Level: high (traded ≥ 80 % of sessions and median turnover ≥ 20 000 zł), medium (≥ 40 %), low (less), none (no trade in 30 days). Thresholds to be calibrated on the backfilled history.
- **Flags:** stale (no trade in 30 sessions: no premium), no terms yet, no periods (the page's dates don't add up), periods extended (obligacje.pl lists them only up to the current one: the rest repeat the last period's length to maturity, projected), amortising (nominal below the issue's), matures soon (under 90 days: no yield), indexed (IZ: not computed).

## Issuer analysis (phase 2)

The procedure is CV's (§3): bond → company → industry and rule set → reports → reading → (fallback figures) → scorecard → refinancing → confidence → judgement. Who does each step here:

| Step | Done by | How |
|---|---|---|
| 1 Bond, amount owed | App | Daily file + terms |
| 2 Company | App, then agent | GLEIF ISIN mapping and exact name match in `catalyst-terms`; the rest (renames, mergers, financing vehicles, legal-name mismatches) by the agent through the CLI, confirmed by hand where §5 says so |
| 3 Industry, rule set | Agent; finance sub-types and overrides by you | Industry from the fixed list, with a summary and website; a Finance company has no scorecard until you give its sub-type (hand-reviewed map, §6) |
| 4 Getting reports | Agent; KRS repository downloads by you | `catalyst work` lists reports due (annual: year end + 5 months, Catalyst's deadline; half-year: 30 June + 3 months; quarterly, for companies with listed shares: quarter end + 2 months); the agent fetches what robots.txt allows (issuer sites, Bankier, filings.xbrl.org) and adds the rest to the checklist for you |
| 5 Reading | Code; PDFs copied by the agent | KRS XML, ESEF package and IFRS text are parsed by code; a PDF's statement lines (annual or interim) are copied by the agent and checked by code (below) |
| 6 Fallback figures | Agent | Only operating companies without a report; marked, confidence medium at most |
| 7–9 Scorecard, refinancing, confidence | App | Computed on read |
| Repayment track record | App | From exits and the session history (below) |
| 10 Judgement | Agent; you can edit | Written from the scorecard, the reports' notes, auditor's opinion, current reports (§13), in the §14 layout |

### Reading reports (code, ported from CV)

The parsers move from CV (`packages/core/src/bonds/fundamentals/filings/`) into `core/src/catalyst/filings/`. They run in the CLI on your machine (sort, pages, parse, checks, dry run); the API only re-runs the arithmetic checks on the lines it receives:

| Format | Who files it | Reading |
|---|---|---|
| **KRS XML** | Unlisted companies under the Polish accounting act (most issuers) | Fixed line codes (`JednostkaInna…`, `SkonsolidowanaJednostkaInna…`, `…WTys`/`…WZlotych`; schemas 1-2, 1-3, 2-0E, the 2025 "(2) 1-0E"); signed XAdES (base64 in `ds:Object`) or CAdES; the 2025 `Dokument` envelope with base64 attachments. Small and micro entities not supported. |
| **ESEF package** (`.zip`, `.xbri`) | Listed IFRS reporters | Inline XBRL with the filer's calculation tree, anchors and labels (prefer the package to a bare `.xhtml`) |
| **IFRS text** (`.xhtml`) | Untagged separate statements | By labels, best effort, only when the balance sheet ties |
| **PDF** | Unlisted IFRS reporters (P4, art.Locum, Ronson), foreign issuers (Allegro.eu, Pepco, MOL) | Code finds the statement pages; **the agent copies every line** (label, page, amount per column exactly as printed, standard item) into a `record_statements` transcript, computing nothing; code parses the amounts and checks that each appears on its page. This is CV's "read by hand" route (`--print-prompt` / `--transcript`), its default since 2026-11-04. Scanned PDFs not supported. |

Every line keeps its source and gets a **standard item** from one vocabulary (§8: income, assets, equity and liabilities, cash flow items such as `revenue`, `ebit`, `debtBonds`, `debtLeases`, `debtSecuritisation`, `operatingCashFlow`, `interestPaid` …). **Checks refuse an import** when total assets ≠ total equity and liabilities, assets ≠ non-current + current, net profit differs between statements (KRS XML), children don't add up to their parent, or a PDF amount isn't on its page. Group accounts first, full 12-month years only, never mixed (§7). The original file goes to S3. `check-filings` compares stored rows and fresh parses with the known answers after any parser change.

### Scorecard (app)

**Built (N4, 2026-11-08):** `core/catalyst/issuers/` (the company view's `analysis`, the bonds' `issuer` signals). As the methodology, §10 to §12:

- **Six dimensions:** Debt burden, Debt service, Liquidity, Profitability, Asset coverage, Refinancing; each green / yellow / red / n/a with its metrics and notes.
- **Trend is an arrow, not a colour.** This changes CV v1.75, where Financial trend was dimension 6. Its metrics, over at least three years, sit on the dimension they describe: the slope of net debt / EBITDA on Debt burden; the EBITDA margin's slope and revenue growth on Profitability. The arrows are ↑ better, → flat, ↓ worse, and none under three years. An arrow doesn't change a colour; the judgement weighs it (§13: a borderline year at the end of a three-year slide reads worse than its colour). **No aggregate score** (§1 principle 1): the reader sees the dimensions, helped by the written judgement.
- **Rule sets** with their own metrics and thresholds: general, developer, contractor, consumer and services; for lenders debt collector, leasing and factoring, investment firm. Chosen by the finance map, then a per-company override, then the industry (§6, §10).
- **Out of scope:** banks, mortgage banks, insurers, state bodies, municipalities: no colours, but identity, bonds and refinancing data.
- **No data is n/a, never a colour**; a dimension coloured by one metric where it has more is "thin".
- **Refinancing:** the company's listed bonds (all its names and its financing vehicle, each ISIN once, at the amount owed) due within 12 and 24 months against cash and operating cash flow; EUR bonds at the NBP rate (§11).
- **Data confidence** high / medium / low with its facts: source and year, years behind, metrics computed and missing (§12). Low-confidence signals are shown faded.

### Repayment track record (app)

**Built (N1, 2026-11-07):** `core/catalyst/trackRecord.ts`, computed on read in `GET /catalyst/bonds/{isin}` (the bond panel's *Track record* tab). How each bond ended:
- **excluded by GPW** for an early redemption or a redemption: stated;
- **ended with a last close under 90:** below par (inferred);
- **last session within 21 days of maturity:** repaid (inferred);
- **left more than 30 days before maturity:** redeemed early (inferred);
- **still listed or suspended after maturity:** past maturity;
- **otherwise:** unknown.

**Red flags:** suspensions at the KNF's demand, bankruptcy or liquidation, restructuring, the BFG; ends below par; bonds past maturity; GPW markings. Suspensions "in the participants' interest and safety" are listed apart as *worth a look*: they are often a one-day stop (a bondholders' meeting, a late report).

**Grouping:** until companies are linked (N2), an issuer's bonds are those sharing the code's leading letters (KRU0228, KRU0829). This is imperfect: a few issuers use two prefixes (VI1…/VID…, KA1…/KAN…, CO1…/COG…).

**Dev, corporate bonds:** 355 repaid, 222 early, 28 below par, 0 past maturity, 297 listed, 0 unknown. GetBack's and Getin Noble's bonds show their red flags; Kruk shows 23 repaid and 1 early.

Planned in CV (§11); here the data is at hand from the start: the daily-file archive since 2020 gives every bond's last session and last price, `catalyst-exits` gives GPW's reason (back to 2018) and markings. Per company: bonds repaid at maturity, redeemed early, ended below par, still listed past maturity, unknown; the period covered ("since 2020-01"), so a short record isn't read as a clean one; red flags (a missed payment, a marking, an extension, a buy-back below par). Inferred facts are labelled as inferred; confirmation of payment comes from issuers' current reports, read by the agent. Shown next to the scorecard, not as an eighth colour.

#### Payment events (from the issuer's reports)

**Built (2026-11-09):** `core/catalyst/paymentEvents.ts`. Trading shows *that* a bond left and at what price; only the issuer's own reports say whether it was paid. The agent reads the company's current reports (ESPI/EBI) and records what they say, each event resting on a stored document and the passage that says it:

| Kind | Reads as |
|---|---|
| `missed-payment` (with `resolvedOn` when paid after all), `late-payment` | red flag; the bond's outcome becomes **not paid** (a missed payment not made since, even while it trades) or **paid late** (once it has ended) |
| `terms-changed` (maturity moved, coupon changed), `covenant-breach`, `insolvency`, `buyback-below-par` | red flag |
| `bondholders-meeting`, `waiver` | worth a look |
| `paid` | confirms the outcome trading suggested: "inferred" becomes "report" |
| `reviewed` | no document: the current reports were read up to its date and nothing else was found |

- An event names its bonds (ISINs, which must be the company's) or none: then it's the company's and stands at the record's level.
- **Checks:** the CLI reads the document's text (PDF or web page) and refuses a quote that isn't in it, whatever the line breaks and hyphenation; the API refuses a document that isn't stored for the company, bonds that aren't its own, a date in the future, and stores an event already recorded (same kind, date and bonds) only once. The API doesn't read files, so the quote check is the CLI's.
- **Never overwritten:** a wrong event is retracted (who, when, why) and no longer read; it stays stored and in the monthly export (`payment-events.json`).
- **`catalyst work`** lists a `payments` item for a company with AI analysis on whose reports were never read, or when a bond has ended or GPW took a measure (KNF's demand, bankruptcy, "participants' interest") after the date they were read to. Only a `reviewed` event sets that date: an event alone doesn't say the rest was read.
- **Shown** in the Track record tab: "From the issuer's reports" (kind, date, bonds, text, the report with its link, the passage), the *Not paid* and *Paid late* figures when there is one, and how far the reports were read.

### AI analysis per company (on/off)

The agent works only on companies you switch on. Each company has `aiAnalysis`: `off` (the default), or `on` with who switched it and when.

- **Off:** the bond table's issuer column and the issuer dialog show **"AI analysis off"** where the scorecard would be, with **Enable** (the dialog and the Issuers view; the table's cell opens the dialog). Identity resolution by code (GLEIF, KRS) and the track record still run: they need no agent.
- **On:** `catalyst work` lists the company (identity, reports due, judgement), and the scorecard shows once there's a report.
- **Switched off again:** the agent stops; what was stored stays and the scorecard is still shown, marked "AI analysis off since <date>: not kept current". Nothing is deleted.
- **A listed name not yet linked to a company** can be switched on too: the switch is kept on the name and passes to the company once the identity is set. Its first item in `catalyst work` is resolving the identity.
- **Only you switch it**, in the app (Cognito); the agent token can't (it's outside its allow-list).
- **On from the start:**
  - companies that issued bonds you hold in PT (read once from PT's holdings when the companies are created; later purchases are switched on by you);
  - companies that already have reports: CatalystViewer's 43, migrated.

### Interim reports

**Built (N8, 2026-11-08):** `core/catalyst/issuers/interim.ts`. Interim periods are stored as rows like years (`FIN#<period end>#<scope>`, `months` < 12; not `INT#`: the full-year code already takes 12-month rows only). The latest interim period newer than the year, of the same scope and standard, gives the balance sheet (the point-in-time items) and, with its comparative period, TTM flows item by item; the trend arrows stay the full years'; each dimension says which figures it used; the confidence notes "interim, usually unaudited"; refinancing counts the interim's cash; the source line reads "FY2025 + H1 2026 (TTM to 2026-06-30, unaudited)". A transcript's interim comparative may have no balance sheet (it's skipped from the balance checks) and must be the same months a year earlier. `catalyst work` lists the half-year report (period end + 3 months) only for companies that need it: bonds due within 24 months, or debt service, liquidity or refinancing yellow or red. Not built: quarterly reports on request, the flag when the next audited year differs from the interim by more than 5 %, `filings sort`'s names for interim files.

Decided 2026-11-07: the half-year balance sheet, on demand (below); trailing 12 months later, if the balance sheet proves useful. After the annual path works, in two steps (the first is cheap and the most valuable):

1. **Interim balance sheet.** The latest interim balance sheet newer than the last full year replaces the year end's point-in-time items (debt, cash, debt due within a year, equity, assets) in Debt burden, Liquidity, Asset coverage and Refinancing. A year end can be up to 15 months old when its report arrives; a quarter is at most 5.
2. **Trailing 12 months (TTM) for flows.** Revenue, EBIT, EBITDA, interest, net profit and cash flows over the 12 months to the interim's end = the last full year + this year to date − the same period a year earlier (the interim report's comparative column). Never quarters added up into a "year" (CV §7: Dadelo's "2026" was Q1 only). Used in Debt service and Profitability; Financial trend keeps comparing full years.

Rules:

- **Same scope, same standard:** an interim period is used only when it has the same scope (group or single) and standard as the full year it extends; otherwise the scorecard stays on the full year and says why.
- **Complete inputs or none:** TTM needs the year to date and its comparative for the same items; a missing one leaves that metric on the full year (never part TTM, part year).
- **Unaudited:** most interim statements are neither audited nor reviewed (half-years of listed companies are reviewed). Data confidence notes it; a flag when the next audited year differs from the interim figures it replaces by more than 5 %.
- **Seasonality:** TTM handles flows; a single quarter's balance sheet (developers before handovers, retailers before the season) is shown with its date, and the judgement reads it with care.
- **Shown as:** the source line "FY2025 + H1 2026 (TTM to 2026-06-30, unaudited)"; each metric says whether it uses the year, the interim balance sheet or TTM.
- **Reading:** the PDF route (copied by the agent, checked by code): the same checks as an annual report, plus that year to date and comparative columns are labelled with their periods. KRS XML and ESEF don't cover interim periods.
- **On demand:** an interim report is fetched only for a company with AI analysis on that has bonds due within 24 months, or debt service, liquidity or refinancing yellow or red, or when you ask. Every Catalyst bond issuer publishes a half-year report (Checked 2026-11-07), so it exists for all of them.
- **Cost:** two to four documents a year per publishing issuer instead of one, all copied by the agent. Monitoring (a dimension changing colour mid-year, a covenant ratio worsening) builds on it.

### Later

- **Risk vs premium:** with the scorecard, confidence and track record next to each bond's premium, the bond table and chart already show mismatches (a high premium with greens, a low one with reds). A "does the premium pay for the risk" verdict (expected loss from default probabilities) waits for the calibration on past Catalyst defaults (§18 item 8: GetBack 2018 and others; the 2020+ archive and the exits give a first set).
- CV's §18 list: notes read with checked quotes (debt schedule, covenants, collateral, auditor's opinion), more lender metrics, developers' escrow and land bank, undrawn credit lines, holding-company flag (trailing 12 months: above, Interim reports).

## The `catalyst` CLI (the agent's interface)

The app has no AI. It stores, parses, checks, computes and shows. Finding and reading documents, resolving hard identities and writing judgements is done by an AI agent (Claude Code or another chat) through the CLI.

**Built (N7, 2026-11-08):**
- **The token and the agent route:** `core/catalyst/agent.ts` (`AGENT_WRITES`, `agentMayCall`), the API's `ANY /catalyst/agent/{proxy+}` (no Cognito; the token's SHA-256, then the route if allowed, as `agent (<x-catalyst-by>)`). The agent's name links are `resolved` when the names agree, else `review`; it can make a company from its LEI (GLEIF, KRS); its company writes can't carry a lender's kind, an override or the switch (403); its imports are recorded as its own.
- **New routes** (yours and the agent's): `GET /catalyst/work`, `POST …/analyses|figures|known`, `GET /catalyst/checklist`, `PUT /catalyst/checklist/{id}/{year}/{scope}`; a filings dry run returns the scorecard it would give.
- **The CLI:** every command of the table but `filings sort` and `filings check` (the check stays `scripts/catalyst-filings-check.ts`, inside the stage's shell). A dry run of an import uploads the file (7-day area) so the server checks the same things it would store.
- **The skill:** `.claude/skills/catalyst-analyst/SKILL.md`; at most 5 companies a session.
- **The app:** the token in the Catalyst settings, "needs work" and the reports checklist in the Issuers view.
- **Known answers** (`catalyst known put`) are also open to the token: they only feed `filings check`.
- **Documents** (N8): `catalyst documents put <id> <file> --kind … --date …` keeps what a judgement rests on beside the statements (auditor's and management reports, interim and current reports, bond terms); one already held isn't uploaded again. The issuer dialog's Documents tab lists them with the statements.

- **Location:** `packages/cli` in this repo, TypeScript, run with `npx catalyst …`. It uses `core`'s zod schemas and parsers (the same ones the API uses); `catalyst schema <kind>` prints an input as JSON Schema.
- **Where the work runs:** on your machine. The CLI imports `core`'s parsers, checks, scorecard and identity clients, so none of these needs the backend: sorting files, finding PDF pages, parsing, the checks, GLEIF and KRS lookups, and a dry run (with the scorecard the import would give). The app is called only to read a company's stored rows and to write results.
- **Transport:** only the API (`/api/catalyst/agent/*`), never DynamoDB directly. The server checks what it receives (the zod schemas, the arithmetic checks re-run on the submitted lines, the original's SHA-256) and stores the original; it doesn't parse files. `filings check` re-parses the stored originals locally against the known answers at any time. JSON output by default, `--table` for people, `--dry-run` on every write.
- **Auth:** an agent token (same pattern as the spreadsheet feed token: 32 random bytes shown once, only the SHA-256 stored, one at a time, revocable), made in the Catalyst view. It allows reads of `/api/catalyst/*` and writes of names, companies (not finance sub-types, overrides or the AI analysis switch), filings, collected figures, analyses and checklist entries; not market data, settings or anything of PT. `catalyst login --stage <stage>` stores it outside the repo. Tests use the test user on `int`, never prod.
- **Review:** everything the agent writes records `enteredBy` and keeps history (analyses are append-only; a replaced financial year keeps the previous version). Imported years start as `parsed`; you mark them `hand-checked` or `flagged`. Identities whose legal name differs from the listed name stay `review` until you confirm them.

| Command | Purpose |
|---|---|
| `catalyst work` | What needs doing, **only for companies (and names) with AI analysis on**: names `unresolved`/`review`; companies in scope without a report for a year that is due, or without an interim report that is due (for those that publish them); companies on fallback figures; Finance companies without a sub-type; analyses older than their latest report; new markings or bonds ending below par; the payment record never checked against the current reports, or bonds ended or GPW measures since they were read |
| `catalyst bonds [--entity] [--filter …]`, `catalyst bond <code>` | Screen rows, amounts owed, liquidity (no obligacje.pl content) |
| `catalyst entity <id>` | Identity, names, bonds, financial years with lines, scorecard, refinancing, confidence, track record, latest analysis |
| `catalyst identity resolve [<name>]` | GLEIF and KRS lookups, made by the CLI itself (ISIN mapping, exact name match, by KRS or LEI, parent), printed with the evidence |
| `catalyst identity set <name> --entity <id> [--financials <id>] --evidence "…"` | Link a listed name to a company (and a financing vehicle to its group) |
| `catalyst entity set <id> --file entity.json` | Short name, industry, summary, website, notes |
| `catalyst checklist [--add <id> <year> <scope> --where "…"]` | Reports to download by hand from the KRS repository, and their state |
| `catalyst filings sort <folder> [--copy\|--move]` | Identify hand-downloaded files (zips, signed XML, PDFs: company, KRS, year, scope, duplicates, part years, drafts), check them against the checklist, file them as `sorted/<KRS>-<company>/FY<year>-<scope>.<ext>` (interim: `<year>Q<n>-<scope>` or `<year>H1-<scope>`) |
| `catalyst filings import <file> [--entity <id>] [--dry-run] [--force]` | Parse and check a KRS XML, ESEF or IFRS text report locally; print the figures, the checks, what would be kept (most recent report wins) and the scorecard it would give. Without `--dry-run`: upload the original and store the rows |
| `catalyst filings pages <pdf> --out pages.txt` | The statement pages and the copying instructions for a PDF |
| `catalyst filings import <pdf> --transcript t.json --by "<model or name>"` | Import a PDF from the agent's transcript, annual or interim (the transcript states the period and months); code checks every amount |
| `catalyst filings check [--entity <id>]` | Compare stored rows and fresh parses with the known answers |
| `catalyst known put <id> --file known.json` | Hand-read figures of a report, for `filings check` |
| `catalyst figures put <id> --file fig.json` | Fallback figures from the web (operating companies only), marked as collected |
| `catalyst bonds schedule <code> --file schedule.json --document <terms>` | A bond's amortization schedule from its terms of issue (the nominal per bond after each instalment; `instalments: []` for a bullet bond): Refinancing counts instalments on their dates. The terms are stored with `documents put` first; the quote is checked against their text unless they're scanned |
| `catalyst analysis put <id> --file judgement.md --meta meta.json [--provisional]` | Store a judgement (layout below). Refused while a listed bond has no schedule (its terms unread) or the current reports weren't read within 45 days (`entity <id>` shows `judgementGaps`); `--provisional` stores it marked so, with the gaps, shown in the app |
| `catalyst events list <id>`, `catalyst events put <id> --file event.json --document <file>`, `catalyst events retract <id> <event id> --reason "…"` | What the company's reports say about payments ("Payment events"): the document is one stored with `documents put`, and the event's quote must stand in it; kind `reviewed` goes without a document |
| `catalyst schema <kind>` | JSON Schema of an input |

**Agent skill** `catalyst-analyst` (`.claude/skills/` in this repo), built on the methodology document:

1. `catalyst work` → pick an item.
2. Identity: `identity resolve`; renames, mergers, financing vehicles (guarantee in the bond terms?) by the §5 rules; `identity set`.
3. Industry and summary: `entity set`. A Finance company: propose the sub-type to you, don't set it.
4. Reports: latest full year, group first; then the interim reports after it (quarterly or half-year, same scope), once the annual path is in place. Issuer site, Bankier (listed), filings.xbrl.org; download into a new directory, 2 s apart; the KRS repository only through `checklist --add` for you.
5. `filings import --dry-run`, then import; a PDF via `filings pages` → transcript (copy, never compute) → import. Refused? Read the checks, fix the transcript, never `--force` without asking.
6. No report available and an operating company: `figures put`, avoiding §9's failure modes (part years, today's date, units, the wrong company).
7. `entity <id>`: read the scorecard against the rule set (§13); read each listed bond's terms of issue (amortization, covenants, collateral, call) and store its schedule (`bonds schedule`); read the auditor's opinion, going-concern notes, related parties, current reports for red flags, each with a source and quote.
8. `analysis put` in the §14 layout: header (company, identity, industry, rule set), bonds and amounts due, figures and confidence, the 6 dimensions and trend arrows, judgement (2–5 sentences), red flags (or "none found in <documents read>"), what to watch, sources.

Limits: at most N companies per session; never touch bonds or market data. It runs by hand in Claude Code, or later as a scheduled cloud routine with the token as a secret (the KRS checklist then waits for you).

## An analysis, end to end

How one company goes from "analyse it" to a scorecard in the app. The example is a made-up bond ABC1227 of "ABC Development S.A."; the commands are the CLI's (above). Who does what:
- **you** decide and review;
- **the agent** (Claude Code, run by hand, with the `catalyst-analyst` skill) finds and reads;
- **the CLI** parses, checks and computes on your machine;
- **the app** stores, recomputes the bonds' signals and shows them.

**0. The agent's access (once per stage).**
1. You create an agent token in the Catalyst settings. It's shown once; the app keeps only its SHA-256.
2. In Claude Code you type `! npx catalyst login --stage prod` and paste the token at a hidden prompt. The CLI stores it in your user profile, outside the repo, and prints only its last four characters, so the agent never sees it.
3. Every call the CLI makes sends `Authorization: Bearer <token>` to `/api/catalyst/agent/…`. The function compares the hash and applies an allow-list:
   - **allowed:** reads, and writes of names, company descriptions, filings, collected figures, analyses and checklist entries;
   - **refused:** market data, settings, finance sub-types and PT.
4. You can revoke the token in the settings. Dev and prod have separate tokens.

**1. The decision.** You switch AI analysis on for the company (or its listed name) in the issuer dialog: it is off by default ("AI analysis per company"). Then you ask ("analyse the issuer of ABC1227", "work through the list"), and the agent runs one of:
- `catalyst work`: what needs doing, i.e. unresolved names, reports due, judgements older than the latest report, new markings;
- `catalyst bond ABC1227`: ISIN, the issuer name as listed, the company id if known, amount owed, maturity, coupon as numbers, yields and liquidity. These are figures the app derived, never obligacje.pl's text.

**2. Identity.** `catalyst identity resolve "ABC Development S.A."`: the CLI itself queries:
- **GLEIF:** the bond's ISIN → LEI, then the LEI record: legal name, KRS number, status, parent;
- **the KRS register API:** legal form, registered name, PKD codes.

It prints the candidates with the evidence. The agent applies §5 (renames, mergers, a financing vehicle guaranteed by its group) and links the name: `catalyst identity set "ABC Development S.A." --entity 0000123456 --evidence "…"`. A legal name that differs from the listed one stays `review` until you confirm it.

*Extracted:* KRS, LEI, legal name, parent, register status.

**3. The company.** The agent reads the company's website (where robots.txt allows) and its PKD codes, then writes `catalyst entity set 0000123456 --file entity.json`:
- short name;
- industry from the fixed list, which picks the rule set (e.g. developer);
- a two-line summary;
- website.

A financial company's sub-type (collector, leasing …) is proposed to you; you set it in the app.

**4. The report.**
- `catalyst entity 0000123456` lists the stored years and the files already held. These include CatalystViewer's 85 originals, migrated, so they're never downloaded again.
- `catalyst work` names what's due: annual reports at year end + 5 months (Catalyst's deadline), group accounts first.

The URL isn't guessed; the agent finds it as a person would:

| Issuer | Where | How the URL is found |
|---|---|---|
| Shares listed on GPW | ESEF package (`.zip`) on the investor-relations site; ESPI reports mirrored on Bankier.pl; filings.xbrl.org by LEI (Polish filings to FY2022) | Website → investor relations → periodic reports → the year's annual report; or a web search ("ABC Development raport roczny 2025"); or filings.xbrl.org's API by LEI |
| Bond-only issuer | PDF annual report published through EBI and on the IR site | The same navigation or search |
| Unlisted, Polish accounting act | KRS financial documents repository (XML) | **You download it.** The repository has no API and bot protection, so the agent never touches it. The agent adds `catalyst checklist --add 0000123456 2025 group --where "KRS repository, KRS 0000123456"`; the entry shows in the app's Reports checklist with the KRS number to copy. Then `catalyst filings sort <folder>` identifies and files what you downloaded. |

When the agent downloads, it checks robots.txt first, uses an honest user agent, waits 2 s between requests and saves into a new empty directory. It never fetches obligacje.pl or the KRS repository.

**5. Reading (on your machine).** `catalyst filings import FY2025-GROUP.zip --entity 0000123456 --dry-run`: the CLI parses the file with the ported code (ESEF, KRS XML or IFRS text) and, without calling the app, prints:
- period, months, scope (group/single), currency and unit, standard;
- every line of the three statements (label, value, code or XBRL concept, parent) and its standard item (`revenue`, `ebit`, `netProfit`, `totalAssets`, `equity`, `debtBonds`, `debtBank`, `debtLeases`, `cash`, `operatingCashFlow`, `interestPaid`, `debtDueWithinYear` …);
- the checks: assets = equity + liabilities, assets = non-current + current, profit agrees between statements, children add up to their parents;
- the years it would keep: FY2025, plus FY2024 from the comparative column, which replaces a stored FY2024 only if this report is newer;
- the scorecard the company would get with them.

Without `--dry-run`, the CLI uploads the original (through a presigned S3 URL) and sends the rows. The app checks the schema, re-runs the arithmetic checks on the lines and checks the file's SHA-256, stores the year as `parsed`, and queues the metrics.

A PDF goes through three steps:
1. `catalyst filings pages report.pdf --out pages.txt`: code finds the statement pages and prints their text with the copying rules.
2. The agent writes `t.json`: each line's label, page, amounts per column exactly as printed, and its standard item. It copies; it computes nothing.
3. `catalyst filings import report.pdf --transcript t.json --by "<model>" --dry-run` checks that every amount appears on its page and that the sums tie.

If the import is refused, the agent fixes the transcript; it never uses `--force` without asking you.

**6. The scorecard (code).** `catalyst entity 0000123456` (or the dry run) shows what the app computes from the stored years:
- the rule set;
- the six dimensions (debt burden, debt service, liquidity, profitability, asset coverage, refinancing), each green / yellow / red / n/a with its metrics, plus the trend arrows;
- the confidence, e.g. "high: audited group report, FY2025, 0 years behind, 14 of 15 metrics";
- the repayment track record from the exits, e.g. "since 2020-01: 4 repaid, 1 early, no red flags".

**7. The judgement (agent).** The agent reads what code doesn't judge: the auditor's opinion, going-concern notes, covenants, security, related parties, and the last year's current reports (ESPI/EBI) for red flags. It writes:
- `judgement.md`: 2–5 sentences, red flags (or "none found in …"), what to watch;
- `meta.json`: each red flag's source and quote, the sources read, the model, and the scorecard version it saw.

Then it runs `catalyst analysis put 0000123456 --file judgement.md --meta meta.json`, with a dry run first. Analyses are append-only.

**8. In the app.**
- The queued metrics copy the company's signals into its bonds' rows: ABC1227 shows six dots, "developer · high", and the judgement's first line on hover.
- The issuer dialog shows the scorecard, bonds falling due against cash, the track record and the judgement. In *Financials*, each figure opens the lines behind it and the original file.
- You mark FY2025 `hand-checked` (or `flagged`) and confirm an identity left in `review`.

Every write records who made it.

## UI

**Built (N6, 2026-11-08):** the bonds table's scorecard column and issuer filters, the chart coloured by a dimension, the issuer dialog, the Issuers view (Docs/ui.md, "Catalyst"). Not yet: the track-record and judgement-age filters, the interim and TTM columns (N8). The type is a bond tag and a filter, not a column, so the table fits a laptop.

Routes: `#/catalyst?<filters>&bond=<isin>&issuer=<entityId>` (bonds), `#/catalyst/issuers?<filters>&issuer=<entityId>`. Style, sticky filters and header, loading placeholders and the bottom chart panel as in the rest of PT. Companies are always shown by their **short name**; legal name, KRS and LEI in tooltips and the issuer dialog.

### Bonds

One row per listed bond (figures in the sketches are illustrative).

```
Catalyst · Bonds                                     as of 2026-11-04 · 612 bonds
[Search code / issuer] [Type ▾] [Coupon ▾] [Maturity 1–4 y] [Nominal ≤ 1000]
[Liquidity ≥ medium ▾] [Scorecard: no red ▾] [+ More filters] [Views ▾] ✕
47 of 612 bonds · Chart ◻
BOND     ISSUER       COUPON   MATUR.  PRICE   YIELD NET        PREMIUM  LIQ  ISSUER (B S L P A R)
                                               bond · vs alt    vs gov
KRU0829  Kruk     ⓘ   W6M+3,0  2,8 y   101,20  6,41 · +1,22     3,6 pp   ●●●  ●●●●●● collector · high
ACH0628  Archicom ⓘ   W3M+3,9  1,6 y   103,01  6,02 · +0,83     3,9 pp   ●○○  ●●●●●● developer · high
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
| Issuer | **"AI analysis off"** (the default) until you switch it on; then **six dots** in a fixed order (debt burden, debt service, liquidity, profitability, asset coverage, refinancing), trend arrows beside them, the rule set and the confidence; faded when confidence is low; "no report yet", "not scored: bank" | Each dimension's metrics with values and colours, notes; source line ("annual report, ESEF, group accounts, FY2025"); the judgement's first line and its date |

More columns (bid/ask, accrued interest, amount owed, gross yield, yield to call, track record) under "Columns" in the More filters panel.

**Filters** (in the URL): text (code, issuer); type (corporate, municipal, cooperative, bank, covered, treasury); market (GPW, BondSpot); currency; coupon type and base rate; maturity from–to; nominal max (≤ 1 000, ≤ 10 000, any); exclude callable / amortising / marked; minimum net yield, vs alternative, premium; liquidity level, traded in the last 30 days; issuer: industry, kind of financial company, rule set, **scorecard** (no red; no red in debt service and refinancing; a chosen dimension green), confidence at least, scored only, track record without red flags, judgement newer than N months; hide suspended and ended (on by default). The bar holds the common ones, "More filters" the rest; set filters show as removable chips. **Saved views** (setting `views`), e.g. "nominal ≤ 1000, liquidity ≥ medium, ≤ 4 y, no red in debt service and refinancing".

**Chart** (toggle above the table): net yield against years to maturity for the filtered bonds, with the treasury curve and the alternative as lines; dots coloured by **one chosen dimension** (default: debt service, the one that matters most for a bondholder, §13), faded at low confidence, grey when not scored; a click selects the row. It shows the risk vs premium mismatches at a glance and replaces CV's "2D stats".

**Row panel** (bottom, as Holdings): tabs *Price & liquidity* (close, bid/ask, turnover bars; 1M/6M/1Y/ALL), *Yield* (cash flows, tax, commission, the alternative, as PT's Buy-more breakdown), *Coupons* (periods, rates, record and payment days, call terms).

**Phone:** three-line rows (code, issuer, six dots / coupon, maturity, liquidity / net yield, vs alternative, premium); filters folded into the search and a Filters button; the chart full width above the list.

### Issuer dialog

Opened from any issuer name (`?issuer=<entityId>`); full screen on a phone. The **AI analysis** switch sits in its header; while it's off, "AI analysis off · Enable" stands where the scorecard is.

```
Kruk                     Kruk S.A. · Poland · KRS 0000… · LEI 2594…   collector rules · high confidence  ✕
Annual report (ESEF, IFRS), group accounts, FY2025 and 2 earlier + Q3 2026 (TTM, unaudited) · judgement 2026-11-02
┌ Scorecard ──────────────────────────────────────┐ ┌ Bonds falling due vs cash ──────────────┐
│ ● Debt burden    net debt / equity 1,2×         │ │ ▇▇ ▇ ▇▇▇ ▇  ▇▇   12 m: 1,1 bn · cash 0,9│
│ ● Debt service   pre-tax interest cover 2,9×    │ └─────────────────────────────────────────┘
│ ● Liquidity  ● Profitability  ● …  ● Refinancing│  Track record since 2020-01: 14 repaid, 3 early, 0 red flags
└─────────────────────────────────────────────────┘
Judgement: …  Red flags: none found in FY2025 report, auditor's report.  Watch: …
[Bonds (9)] [Financials] [Track record] [Judgements] [Documents]
```

- **Scorecard:** a dimension opens into its metrics; each scored ratio shows a gauge of red, yellow and green zones (worse to better, left to right) with its two thresholds under the borders and a mark at the value. The thresholds come with the metric from the API (`bands`).
- **Bonds falling due:** one bar per year of maturity and one for cash, on one scale, with the amounts beside them.
- **Bonds:** its bonds (all its names and financing vehicles) with maturity, amount owed, net yield, premium, liquidity; "Show in table" filters the bonds view to the company.
- **Financials:** up to six years with the source per year (link to the original), and the interim periods after the last year with the TTM column; a figure opens the lines behind it; *Full statements*: a year's lines as printed; review status per year (parsed / hand-checked / flagged), with buttons to mark it; collected figures marked, and years where collected and filed figures differ by more than 2 %.
- **Track record:** past bonds with how and when they ended, last price, source.
- **Judgements:** the latest in full, earlier ones by date.
- **Documents:** filings and their import results.

### Issuers

One row per company with listed bonds. Columns: short name, AI analysis (off / on, switchable in the row), industry (and kind of financial company), rule set, bonds, amount owed on Catalyst, due in 12 months, median premium, the six dots and trend arrows, confidence, latest financial year, track record, judgement date, **needs work** (what `catalyst work` lists for it). Filters: AI analysis on / off, industry, rule set, scorecard, confidence, scored / not scored / no report, needs work. A row opens the issuer dialog.

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
| Filings bucket originals (prod, 2026-11-07: 85 files of 43 companies: 49 ESEF packages, 19 PDFs, 11 KRS XML, 6 xhtml) | Copied, never downloaded again, and re-imported through the ported parsers. A PDF is re-imported from a transcript rebuilt from CV's stored lines (label, page, amounts) and checked against the PDF again. Compared with CV's `IssuerFinancials` rows and the known answers |
| `expected.json` (known answers), the checklist | Known answers, checklist entries |
| AI analyses with their figures | Collected figures (marked) and judgements (marked as from CV's agent) |
| `BondStatistics` (bid/ask since 2023) | Sessions (bid/ask only; the rest comes from the file archive) |
| Inactive bonds since 2023-03 | Cross-check of the exits job |

CV's methodology document moves to `Docs/catalyst-methodology.md` with the code it describes, and is kept current from then on as CV's is (it is the single description the agent starts from).

## Plan

Each step goes to prod on its own. Phase 1 (steps 1–7) in detail: [catalyst-phase1-plan.md](catalyst-phase1-plan.md); phase 2 (steps 8–12 and interim reports): [catalyst-phase2-plan.md](catalyst-phase2-plan.md).

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
