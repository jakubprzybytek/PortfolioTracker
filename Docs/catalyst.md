# Catalyst module (design)

Status: proposal (2026-11-05), nothing built yet. It moves the functionality of CatalystViewer (CV) into PortfolioTracker as a separate module: the whole Catalyst bond market, not the bonds you hold. Functionality is migrated, not CV's solutions: sources, storage and mechanics follow PT.

| Phase | Contents |
|---|---|
| 1 – Market | Daily data of every Catalyst bond; browsing with filters; yield to maturity against an alternative; risk premium over treasury bonds; liquidity |
| 2 – Issuers | Issuers, their yearly financials, a scorecard computed by the app, analyses written by an AI agent outside the app through a CLI; a "does the premium pay for the risk" guide |

## Module boundaries

Catalyst is a module of its own: its own table, jobs, API Lambda, view and backup. It doesn't read or change transactions or holdings; the bonds in it are not the ones held in PT.

| Part | Catalyst | Shared with PT |
|---|---|---|
| Table | `catalyst` | – |
| Jobs | `catalyst-daily`, `catalyst-quotes`, `catalyst-terms`, `catalyst-metrics`, `catalyst-export` | Scheduling (CronV2, Warsaw), raw S3 archive, `runJob` (job runs), alert e-mails |
| API | Lambda `catalyst-api`, routes `/api/catalyst/*` | Domain, Cognito pool, access group `portfolio-tracker` (no separate group) |
| UI | View "Catalyst" (bonds, issuers) | Style, components (`StickyTable`, chart panel, filters, placeholders), Recharts |
| Code | `core/src/catalyst/`, `jobs/src/catalyst/`, `web/src/catalyst/`, `infra/catalyst.ts`, `packages/cli` | Catalyst may import PT's pure functions (bond cash flows, coupon periods, accrued interest, `settlement.ts`, `dates.ts`, XIRR); **PT never imports Catalyst** |
| PT data read | `market`, read-only: `SERIES#` (retail bonds, the alternative) and `CPI*` | Nothing from `transactions` or `holdings` |

## Data sources

| Data | Source | Notes |
|---|---|---|
| End of day, every bond | gpwcatalyst.pl daily statistics file `pub/CATALYST/statystyki/statystyki_dzienne/catalyst_YYYYMMDD.xlsx` (older days `.xls`) | Sheet `instrumenty`, ~1,060 rows (all segments: corporate, municipal, cooperative, bank, covered, treasury): maturity, current coupon rate, accrued interest, nominal, market, trading system, ISIN, code, currency, close, reference price, open/low/high/last, average prices, number of trades, volume, turnover (thousands). **Archived by date: checked 2020-01-02, 2022, 2023, 2025, 2026 all download** (2026-11-05), so history can be backfilled. Close = reference price on a day without trades (`legenda`): use the number of trades for "traded". |
| Bid/ask, order book | gpwcatalyst.pl quotes pages, one per segment (`notowania-obligacji-obligacje-korporacyjne`, `-skarbowe`, `-komunalne`, `-spoldzielcze`, `-bankowe-papiery-wartosciowe`, `-listy-zastawne`) | Snapshot of the current session only: a missed day is lost. Cells have sub-values, read by position (CV's parser `CorporateBondsQuotesPage.ts` shows the layout). |
| Terms | obligacje.pl bond page | Issuer name, issue size, coupon type ("zmienne WIBOR 6M + 3.85%"), first days of interest periods, record and payment days, current rate. One page per bond: crawled a few dozen per run, 2 s apart, then only new bonds (PT's `coupons` job already parses these pages). |
| Treasury curve | The same daily file (treasury segment) | Fixed-rate DS/PS/WS pay a constant coupon (the file's rate) yearly on the maturity's day and month, so their yields need no other source. WZ (floating) margins from the series' terms. |
| Alternative | PT `market`: `SERIES#` (Ministry retail-bond file) | The retail bond on offer with the nearest term, or a rate you set. |
| WIBOR / WIRON | None (assumption in the settings) | No fixings source; floating coupons not yet set use the assumed rate + margin. |
| Issuer identity | GLEIF API (LEI → legal name, KRS number, address) | Free, no key. |
| Issuer financials | ESEF annual reports (iXBRL; GPW regulated-market issuers; indexed by LEI at filings.xbrl.org with an xBRL-JSON version), KRS e-sprawozdania (structured XML, statutory statements of unlisted companies), annual-report PDFs | Fetched and read by the agent, not the app (below). Access to the KRS financial-statements repository still to be verified. |

Reachability: PT's data-sources.md noted gpwcatalyst.pl unreachable from the dev machine on 2026-10-12; on 2026-11-05 it answered normally. Check from Lambda (eu-west-1) before building. Risk: GPW's move to WATS may change the file and the pages; parsers look columns up by header and fail loudly.

## Storage: table `catalyst`

On-demand, PITR on, deletion protection on `prod`, TTL attribute `ttl`. Same key schema as PT (`PK`, `SK`, sparse `GSI1PK`/`GSI1SK`). Dates `YYYY-MM-DD`, numbers as decimals, prices clean in % of nominal.

| Item | PK / SK | GSI1 | Contents | Rebuildable |
|---|---|---|---|---|
| Bond | `BOND#<isin>` / `META` | `BOND` / `<code>` | code, name, type (segment), market, currency, nominal, maturity, issuer (LEI), coupon type (`FIXED`/`FLOATING`/`ZERO`/`INDEXED`), base rate, margin, issue size, callable, amortising, status (`listed`/`suspended`/`delisted`), first/last day seen | Yes |
| Session | `BOND#<isin>` / `D#<date>` | – | close, reference, open, low, high, last, trades, volume, turnover, nominal, rate, accrued interest; from the quotes pages: bid, ask, bid/ask volume and order count | Yes from the archive, **except bid/ask** |
| Coupon period | `BOND#<isin>` / `COUPON#<start>` | – | As PT's `CouponPeriodItem` | Yes |
| Screen row | `BOND#<isin>` / `SCREEN` | `SCREEN` / `<code>` | Computed metrics (below), `computedAt` | Yes |
| Treasury curve | `CURVE#PLGOV` / `<date>` | – | points `{ years, yield, isin }`, fitted curve | Yes |
| Issuer | `ISSUER#<lei>` / `META` | `ISSUER` / `<name>` | short name (shown everywhere), legal name, KRS, ticker, industry, website, parent group, aliases (names on obligacje.pl) | **No** |
| Financials | `ISSUER#<lei>` / `FIN#<year>#<CONS\|SOLO>` | – | Standard line items (below), currency, unit, period end; per value: source document, page or tag, `enteredBy` (`agent`/`you`), `confirmed` | **No** |
| Document | `ISSUER#<lei>` / `DOC#<id>` | – | kind (`ESEF`/`KRS_XML`/`PDF`/`OTHER`), year, URL, S3 key of the stored file, sha256 | **No** |
| Analysis | `ISSUER#<lei>` / `ANALYSIS#<ts>`, mirror `ANALYSIS#LATEST` | – | Agent's Markdown report, judgement (`LOW`/`MEDIUM`/`HIGH`/`VERY_HIGH` risk), red flags, model, the financial years it used, and the scorecard the app computed on them | **No** |
| Setting | `SETTING#<name>` / `META` | – | `assumptions` (WIBOR, WIRON, commission, tax, alternative), `views` (saved filters), `agentToken` (hash) | – |
| Job run | `JOB#<name>` / `RUN#<startedAt>` | – | As PT, `ttl` 90 days | – |

Standard line items (CV's `FinancialYearData`): revenue, EBIT, depreciation, interest expense, net profit, total assets, intangible assets, equity, financial debt, cash, current assets, inventory, current liabilities.

Sizing: ~1,060 bonds × ~250 sessions a year ≈ 265k session items a year; backfill from 2020 ≈ 1.6M items (one-off write cost ≈ $2). The screen is ~600 items (listed bonds), read in one or two pages.

Backup: monthly `catalyst-export` of issuers, financials, documents (metadata; files stay in S3), analyses and settings to `exports/<date>/catalyst/`, in the CLI's input formats so a restore is a re-import. Market data is rebuilt from the file archive.

## Jobs

| Job | When (Warsaw) | What |
|---|---|---|
| `catalyst-daily` | 18:30, recheck 08:00 Tue–Sat | Downloads the day's file (archives it), upserts bonds (new → `listed`; gone from the file → `delisted`), writes sessions. Backfill mode: a date range from the archive, through a queue, a few files per invocation. |
| `catalyst-quotes` | 17:20 (after the close), 08:30 Tue–Sat before the session | Reads the six quotes pages, adds bid/ask to the last session's item (only when the page's session date matches). |
| `catalyst-terms` | 09:30 | obligacje.pl for bonds without terms (up to ~40 per run), then refreshes current coupon rates of floating bonds; adds missing periods, never overwrites a stored date or rate (as PT's `coupons`). |
| `catalyst-metrics` | after `catalyst-daily`, and on a change of assumptions | Treasury curve of the day, then a screen row per listed bond. |
| `catalyst-export` | 1st of the month 04:30 | Backup (above). |

Failures alert as PT's jobs do; `catalyst-quotes` failing after its morning run means that day's bid/ask is lost.

## Metrics (screen row)

- **Yield to maturity, gross and net:** from the bond's cash flows (coupon periods; future floating coupons = assumed base rate + margin; nominal at maturity), bought at the last close + accrued interest to T+2 + commission; net after 19 % tax on interest and on the gain at maturity (PT's `buyMore` logic). Callable bonds also get the yield to the first call date.
- **Vs alternative:** net yield − net yield of the alternative over the same term (pp). The alternative is the retail bond on offer with the nearest term (from `SERIES#`) or a rate set by you.
- **Premium vs gov (gross):** fixed coupon: yield − treasury curve at the same maturity; floating: price-adjusted margin − WZ margin of a similar maturity. Blank for non-PLN bonds and bonds without a trade in 90 days.
- **Liquidity (30 and 90 days):** share of sessions with trades, median turnover on traded days, number of trades, median bid/ask spread, order depth at best bid; "days to sell 10 000 zł" assuming 20 % of the median daily turnover. Level: high (traded ≥ 80 % of sessions and median turnover ≥ 20 000 zł), medium (≥ 40 %), low (less), none (no trade in 30 days). Thresholds to be calibrated on the backfilled history.
- **Flags:** stale price, callable, amortising (nominal fell), suspended, no terms yet.
- **Issuer:** overall scorecard signal, the six dimension signals, analysis date and judgement (copied from the issuer for one-query reads).

## Scorecard (phase 2, computed by the app)

CV's six dimensions with its formulas: debt burden (D/E, net debt/EBITDA), debt service (interest cover), liquidity (current and quick ratio), profitability (EBIT and net margin), asset coverage (tangible net assets/debt, equity ratio), trend (revenue CAGR, EBITDA margin and net debt/EBITDA slopes, 3+ years). Changes:

- Thresholds per industry group; ratios that don't apply are `n/a` (financial companies: no current ratio, D/E judged differently).
- From the market, which only this module has: the issuer's Catalyst bonds falling due per quarter against its cash (refinancing), and how the market prices it (median premium of its bonds, bonds below 90).
- Computed only from confirmed or agent-entered values, showing which.

**Decision guide** (after the scorecard): premium vs expected loss (default probability by scorecard level × loss given default) plus a liquidity charge → "pays for its risk" / "doesn't". Default probabilities roughly calibrated on the 2020+ archive (bonds that fell below ~50 % or disappeared before maturity).

## AI outside the app: the `catalyst` CLI

The app has no AI. It stores, validates, computes and shows. Reading reports, extracting figures and writing analyses is done by an AI agent (Claude Code or another chat) through a CLI.

- **Location:** `packages/cli` in this repo, TypeScript, run with `npx catalyst …`. It uses the zod schemas from `core` (the same ones the API validates with); `catalyst schema <kind>` prints them as JSON Schema for the agent.
- **Transport:** only the API (`/api/catalyst/*`), never DynamoDB directly, so every write is validated by the server. JSON output by default, `--table` for people, `--dry-run` on every write.
- **Auth:** an agent token (same pattern as the spreadsheet feed token: 32 random bytes shown once, only the SHA-256 stored, one at a time, revocable) made in the Catalyst view. It only allows reads of `/api/catalyst/*` and writes of issuers, documents, financials and analyses: no market data, no settings, nothing of PT. `catalyst login --stage <stage>` stores it outside the repo. Tests use the test user on `int`, never prod.

| Command | Purpose |
|---|---|
| `catalyst work` | What needs doing: bonds without an issuer, issuers without financials for the last year, analyses older than N months, issuers whose bonds fell sharply |
| `catalyst bonds [--issuer] [--filter …]`, `catalyst bond <code>` | Screen rows, terms, liquidity |
| `catalyst issuer <lei>` | Profile, bonds and maturities, financials, latest analysis, scorecard |
| `catalyst issuer set <lei> --file issuer.json`, `catalyst issuer link <bond> <lei>` | Create or update an issuer (GLEIF lookup by the CLI), link bonds |
| `catalyst doc add <lei> --kind ESEF --url … [--file …]` | Register a source document; the file goes to S3 through a presigned URL |
| `catalyst extract esef <file>`, `catalyst extract krs-xml <file>` | Deterministic parsers of structured filings (IFRS tags / KRS schema → standard line items, with the tag of each value). No AI. |
| `catalyst financials put <lei> --file fin.json` | Store a year; the server rejects what fails its checks (balance sheet doesn't balance, units, missing source) and says why |
| `catalyst scorecard <lei>` | The app's scorecard (read only) |
| `catalyst analysis put <lei> --file report.md --meta meta.json` | Store an analysis |
| `catalyst schema <kind>` | JSON Schema of an input |

Every write records `enteredBy` and time and keeps history (analyses are append-only; a financials change keeps the previous version), so a bad agent run can be found and undone.

**Agent skill** `catalyst-analyst` (`.claude/skills/` in this repo): the loop `work` → `issuer` → find the filings (ESEF at filings.xbrl.org by LEI, KRS e-sprawozdania, the issuer's investor-relations page) → `doc add` → `extract` for structured filings, reading the PDF only for what's missing → `financials put` (fix and retry if rejected) → `scorecard` → write the analysis from a template (business, debt and maturities, liquidity, trend, industry risks, bond terms: security and covenants, events, judgement and what would change it) → `analysis put`. Rules: consolidated before standalone, a source for every value, `null` rather than a guess, at most N issuers per session, never touch bonds. It can run by hand or as a scheduled cloud routine with the token as a secret.

## UI

Routes: `#/catalyst?<filters>&bond=<isin>&issuer=<lei>` (bonds), `#/catalyst/issuers?<filters>&issuer=<lei>`. Style, sticky filters and header, loading placeholders and the bottom chart panel as in the rest of PT.

### Bonds

One row per listed bond.

```
Catalyst · Bonds                                     as of 2026-11-04 · 612 bonds
[Search code / issuer] [Type ▾] [Coupon ▾] [Maturity 1–4 y] [Nominal ≤ 1000]
[Liquidity ≥ medium ▾] [Scorecard: no red ▾] [+ More filters] [Views ▾] ✕
47 of 612 bonds · Chart ◻
BOND     ISSUER       COUPON   MATUR.  PRICE   YIELD NET        PREMIUM  LIQ  ISSUER SCORECARD
                                               bond · vs alt    vs gov
KRU0829  Kruk     ⓘ   W6M+3,0  2,8 y   101,20  6,41 · +1,22     3,6 pp   ●●●  ● ●●●●●●  3 m
ACH0628  Archicom ⓘ   W3M+3,9  1,6 y   103,01  6,02 · +0,83     3,9 pp   ●○○  ● ●●●○●●  7 m
PCR0827  Pragma   ⓘ   9,0 %    0,8 y    99,10  8,33 · +3,14     5,1 pp   ●○○  ○ not analysed
```

| Column | Shows | Tooltip |
|---|---|---|
| Bond | Code; tags callable, amortising, EUR | Name, ISIN, market, segment |
| Issuer | Short name; opens the issuer dialog | Legal name, industry |
| Coupon | `7,50 %`, `W6M+3,85`, `WIRON+…`, `zero` | Current period's rate, next payment |
| Maturity | Years left | Date |
| Price | Last close (% of nominal); grey "stale" when not traded for long | Date, bid/ask, accrued interest |
| Yield net | Net yield to maturity · vs alternative (pp, green above, red below) | Gross yield, the alternative and its net yield, base rate assumed |
| Premium vs gov | pp over the treasury curve (floating: over WZ) | How it was derived |
| Liquidity | Three dots: high, medium, low; none = empty | Sessions traded, median turnover, spread, days to sell 10 000 zł |
| Issuer scorecard | Overall dot + six dimension dots + age of the analysis | Each dimension's figures; the agent's judgement in a line |

More columns (bid/ask, accrued interest, issue size, gross yield, yield to call) under "Columns" in the More filters panel.

**Filters** (in the URL): text (code, issuer); type (corporate, municipal, cooperative, bank, covered, treasury); market (GPW regulated, alternative system, BondSpot); currency; coupon type and base rate; maturity from–to; nominal max (≤ 1 000, ≤ 10 000, any); exclude callable / amortising; minimum net yield, vs alternative, premium; liquidity level, traded in the last 30 days; issuer industry, scorecard (no red / only green / analysed), agent's judgement, analysis no older than N months; hide suspended and delisted (on by default). The bar holds the common ones, "More filters" the rest; set filters show as removable chips. **Saved views** (setting `views`), e.g. "nominal ≤ 1000, liquidity ≥ medium, ≤ 4 y, no red".

**Chart** (toggle above the table): net yield against years to maturity for the filtered bonds, dots coloured by the issuer's overall signal, with the treasury curve and the alternative as lines; a click selects the row. Replaces CV's "2D stats".

**Row panel** (bottom, as Holdings): tabs *Price & liquidity* (close, bid/ask, turnover bars; 1M/6M/1Y/ALL), *Yield* (cash flows, tax, commission, the alternative, as PT's Buy-more breakdown), *Coupons* (periods, rates, record and payment days, call terms), *Terms* (issue size, security, documents).

**Phone:** three-line rows (code, issuer, scorecard dot / coupon, maturity, liquidity / net yield, vs alternative, premium); filters folded into the search and a Filters button; the chart full width above the list.

### Issuer dialog

Opened from any issuer name (`?issuer=<lei>`); full screen on a phone.

```
Kruk S.A.                       LEI 2594… · KRS 0000… · Finance: debt collection  ✕
Agent: LOW–MEDIUM risk · 2026-08-12 · "Strong cash generation; high leverage…"
┌ Scorecard (FY2025, consolidated) ─────┐ ┌ Catalyst debt falling due ────────────┐
│ ● Debt burden   D/E 2,1× · ND/EBITDA… │ │ ▇▇ ▇ ▇▇▇ ▇  ▇▇   per quarter vs cash  │
│ ● Debt service  ICR 3,4×  …           │ └───────────────────────────────────────┘
└───────────────────────────────────────┘
[Bonds (9)] [Financials] [Analysis] [Documents]
```

- **Bonds:** its bonds with maturity, amount, net yield, premium, liquidity; "Show in table" filters the bonds view to the issuer.
- **Financials:** years × line items; each value with its source (ESEF tag, KRS, PDF page, you); agent values marked until confirmed (✓); edit in place (`enteredBy: you`).
- **Analysis:** the latest report (Markdown) and earlier ones.
- **Documents:** filings with links and stored files.

### Issuers

Columns: name, industry, bonds, amount outstanding on Catalyst, next maturity, median premium, scorecard dots, judgement, latest financial year, analysis age, **needs work** tag (the same list as `catalyst work`). Filters: industry, scorecard, judgement, analysed, needs work. A row opens the issuer dialog.

### Settings

A cog in the view: assumptions (WIBOR, WIRON, commission, alternative: nearest retail bond or a rate), the agent token (create, revoke, last used).

## Testing

As the rest of PT (Development.md): unit tests of the parsers on stored files (a daily file per format, each quotes page, obligacje.pl pages, an ESEF and a KRS XML sample) and of the metrics; `int` seeded with fixture bonds, sessions and issuers; integration tests of `/api/catalyst/*` incl. the agent token's limits; E2E of the bonds view, filters and the issuer dialog. The CLI's commands tested against `int`.

## Plan

Each step goes to prod on its own.

1. Table, `catalyst-api` skeleton, empty view in the menu.
2. `catalyst-daily` + backfill from the 2020+ archive.
3. `catalyst-quotes`.
4. `catalyst-terms`.
5. `catalyst-metrics`: treasury curve, yields, premiums, liquidity.
6. Bonds view: table, filters, saved views, chart, row panel.
7. Run alongside CV, compare yields and liquidity bond by bond; optionally import CV's `BondStatistics` once (its bid/ask history exists nowhere else).
8. Phase 2: issuer, document, financials, analysis items and API; agent token; scorecard and maturities; issuers view and dialog.
9. CLI and the `catalyst-analyst` skill; first run on CV's analysed issuers, compared with CV's stored analyses.
10. Decision guide.
11. Retire CV (its jobs, Bedrock and Tavily use). Deleting its resources is the owner's call.

## Open questions

- CV's notes on annual-report formats that scripts can parse: not found in the CV repo (main and branches, 2026-11-05); ESEF and KRS XML are assumed until they turn up.
- Access to the KRS financial-statements repository from a script (download without a captcha?).
- Issuers without an LEI (expected to be rare): a private id in the same format, as PT's `ZZ` ISINs.
- WIRON: which bonds reference it and what the assumption should be.
