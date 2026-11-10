# Fundamental analysis of Catalyst bond issuers: methodology

How the Catalyst module (Docs/catalyst.md) judges whether a bond issuer can pay its bonds back: what to find, where, how to read it, which rules apply to which company, how to compute and colour every metric, how sure the result is, and how to present it. Written so that an analyst or an AI agent (the `catalyst-analyst` skill, through the `catalyst` CLI) can do the whole analysis on an empty context from nothing but a bond name.

Moved from CatalystViewer (`docs/fundamental-analysis-methodology.md`, state 2026-11-05, release v1.75) on 2026-11-08 with the code it describes (Docs/catalyst-phase2-plan.md, N4). From now on this copy is the reference; CatalystViewer's is frozen. Section numbers are kept, so the design's "§" references point here. What is marked **built** below was built in CatalystViewer; PortfolioTracker ports it milestone by milestone (the plan says what is in PT so far).

The code is the reference: when this document and the code disagree, the code is right and this document needs fixing.

## Changes in PortfolioTracker

- **Six dimensions, not seven** (2026-11-07): Financial trend (dimension 6 below) isn't a colour. Its metrics, over at least three years, are arrows on the dimension they describe: the slope of net debt / EBITDA on Debt burden; the EBITDA margin's slope and revenue growth on Profitability (↑ better, → flat, ↓ worse; down when either worsens). An arrow doesn't change a colour; the judgement weighs it (§13: "the trend can override the snapshot"). Code: `core/src/catalyst/issuers/company.ts` (`sixDimensions`).
- **No AI in the app.** The agent works outside it, through the CLI: CatalystViewer's model calls (classification, the AI analysis, the PDF reader) aren't ported. A PDF is read from the agent's transcript, checked in code (§8, "PDF route").
- **Reading runs in the CLI**, on the user's machine; the app checks what it's sent again and stores it (Docs/catalyst.md, "The catalyst CLI").
- **The company's fields replace name lists:** industry, the kind of lender (`financeRuleSet`) and a rule-set override with its reason are stored on the company (§6). CatalystViewer's name lists (`FINANCE_RULE_SETS`, `RULE_SET_OVERRIDES`) are still read by listed name until N5 moves them onto the companies.
- **AI analysis per company** is off by default and switched on by the owner (Docs/catalyst.md, "AI analysis per company").
- **Interim reports** (half-year balance sheet, on demand) are planned (Docs/catalyst.md, "Interim reports"); §7's "12-month years only" stays for the scorecard's years.
- **Where things are:** §15 (data model) and §19 (where things are, how to run them) describe CatalystViewer. In PT: Docs/catalyst.md ("Storage", "The catalyst CLI") and Docs/catalyst-phase2-plan.md ("Code layout").

## Contents

- Part A: foundations
  1. [The question, the output, the principles](#1-the-question-the-output-the-principles)
  2. [The Catalyst market in brief](#2-the-catalyst-market-in-brief)
  3. [The procedure in brief](#3-the-procedure-in-brief)
- Part B: the steps
  4. [Step 1: the bond](#4-step-1-the-bond)
  5. [Step 2: the company behind the bond](#5-step-2-the-company-behind-the-bond)
  6. [Step 3: industry, scope and rule set](#6-step-3-industry-scope-and-rule-set)
  7. [Step 4: getting the reports](#7-step-4-getting-the-reports)
  8. [Step 5: reading the reports](#8-step-5-reading-the-reports)
  9. [Step 6: figures when there is no report](#9-step-6-figures-when-there-is-no-report)
  10. [Step 7: the scorecard](#10-step-7-the-scorecard)
  11. [Step 8: refinancing](#11-step-8-refinancing)
  12. [Step 9: data confidence](#12-step-9-data-confidence)
  13. [Step 10: the judgement](#13-step-10-the-judgement)
  14. [Presenting the result](#14-presenting-the-result)
- Part C: reference
  15. [Data model](#15-data-model)
  16. [Known issuers, exceptions and open data issues](#16-known-issuers-exceptions-and-open-data-issues)
  17. [Worked example](#17-worked-example)
  18. [Not covered yet](#18-not-covered-yet)
  19. [Where things are, and how to run them](#19-where-things-are-and-how-to-run-them)
  20. [Glossary (Polish terms)](#20-glossary-polish-terms)

---

# Part A: foundations

## 1. The question, the output, the principles

**The question:** how likely is this issuer to fail to pay interest or principal on its bonds? It is not a
valuation: no fair price, no DCF, no equity upside. The reader is a retail or semi-professional bondholder.

**The output** for one issuer:

| Part | What it is |
|---|---|
| Identity | the company (legal name, country, KRS and/or LEI), whose accounts are used, other names of the same company |
| Industry and rule set | e.g. Developer → developer rules; Finance → debt collector rules, or out of scope |
| Scorecard | 6 dimensions plus Refinancing, each green / yellow / red / n/a, with the metrics and notes behind each |
| Data confidence | high / medium / low, with the facts: source, year, how far behind, metrics computed and missing |
| Judgement | a short written verdict: the reds that matter, what offsets them, red flags outside the metrics, what to watch |
| Sources | each figure traceable to a document, statement line and year |

**Principles** (each one learned from a mistake):

1. **No aggregate score.** Five greens and one red is a different story from two greens and four reds;
   one number would hide it. The reader sees the dimensions, helped by the written judgement.
2. **Numbers come from documents and are read by code.** A model may copy lines from a PDF, but code
   checks every amount. A model retyping numbers from web pages (the app's first approach) is a fallback
   only, and is marked as such.
3. **No data is n/a, never a colour.** A metric without its inputs is n/a; a dimension with only n/a
   metrics is n/a; thin data lowers the confidence and is shown faded. A card built on one figure must
   never read like a full one.
4. **The company, not the name.** Bonds are joined to reports through the company's identity (KRS or
   LEI), never by matching names.
5. **Group accounts first, full years only, never mixed.** The group carries the subsidiaries' debt;
   part years break every ratio.
6. **The most recent report wins.** A year shown in two reports takes the newer report's (restated)
   figures, with exceptions recorded per issuer.
7. **Rules fit the business model.** A developer, a shop and a debt collector are judged by different
   metrics and thresholds; a red caused by the business model is a rule problem, not a company problem.
8. **Respect every source's terms.** robots.txt, bot protection and rate limits are followed, also by
   scripts someone else runs (section 7).
9. **Say what wasn't checked.** Every caveat (listed bonds only, derived EBIT, gross debt without cash)
   is a note on the card.

## 2. The Catalyst market in brief

- **Catalyst** is the Warsaw Stock Exchange's (GPW) bond market, run on two platforms: GPW (regulated
  market and ASO) and BondSpot. A bond may be listed on both.
- **Bond types** in the data: corporate, municipal, treasury (State Treasury, including inflation-linked
  IZ series), covered (mortgage banks' *listy zastawne*). Only corporate issuers are scored.
- **Who issues:** about 90 corporate issuers with active bonds, half of them developers. Most are **not
  listed on the stock exchange**, so they publish no ESEF report: their accounts are in the KRS (Polish
  accounting act). A minority are large listed groups (Orlen, PGE, KGHM, Cyfrowy Polsat) and foreign
  groups (Allegro.eu, Żabka, Pepco, MOL).
- **Currency:** about 8% of active bonds are in EUR (Kruk, Echo, Orlen); the rest in PLN.
- **Retail-heavy:** many issues are sold to retail investors. Catalyst issuers often repay bonds by
  issuing new ones, so a weak issuer depends on the market staying open.
- **Defaults:** the largest, **GetBack (2018)**, was a debt collector that had sold bonds widely to retail
  investors. Defaults of small developers and lenders recur. A calibration set of past defaults is planned
  (section 18).
- **Reports:** annual reports are approved within 6 months of the year end, then filed in the KRS;
  listed issuers also publish them through ESPI (shares) or EBI (bonds only).

## 3. The procedure in brief

```
bond name (e.g. "ATA0128") or ISIN
  1. bond        → ISIN, issuer name as listed, type, amount owed, currency, maturity  (Catalyst file, BondDetails)
  2. company     → LEI, KRS, legal name, country; group or financing vehicle            (GLEIF, KRS API)
  3. industry    → rule set: developer / contractor / consumer / general, or for lenders
                   collector / leasing / investment; or out of scope                     (classification, FINANCE_RULE_SETS)
  4. reports     → latest full-year annual reports, group accounts first                (KRS repository, issuer site, ESPI/EBI, Bankier)
  5. read        → statement lines → figures, checked (balance ties, net profit ties)
  6. no report?  → AI-collected figures as a fallback, marked as such (never for lenders)
  7. scorecard   → 6 dimensions with the rule set's metrics and thresholds
  8. refinancing → listed bonds due in 12 / 24 months vs cash and operating cash flow
                   + repayment track record: how past bonds ended (planned)
  9. confidence  → high / medium / low with facts
 10. judgement   → verdict, red flags, what to watch
```

Each step below says what to do, where the data is, the rules, and the traps found so far.

---

# Part B: the steps

## 4. Step 1: the bond

**Where:**

- **Catalyst daily statistics file** (catalyst.gpw.pl, XLS): every listed bond with ISIN, market (GPW or
  BondSpot), type, **current nominal value**, maturity date, trading currency, current coupon, accrued
  interest, quotes. The app reads it three times a working day (Bonds Updater).
- **In the app:** the `BondDetails` table (`getActive('Corporate bonds')`), filled by the Bonds Updater:
  issuer name, ISIN, issue value, nominal, the nominal on the day the issue value was read
  (`issuedNominal`), currency, maturity and coupon terms.
- **obligacje.pl** (`https://obligacje.pl/pl/obligacja/<BOND NAME>`): issuer name, issue value ("Wartość
  emisji w obrocie"), interest schedule. **Its robots.txt blocks AI crawlers and assistants (ClaudeBot,
  Claude-User, GPTBot, …): an AI agent must not fetch it.** The Bonds Updater's stored data, the Catalyst
  file, or the issuer's terms of issue serve instead.

**Rules:**

- **Count each ISIN once** (a bond can be on GPW and BondSpot).
- The **issuer name on the bond is not the company's identity:** it can be an old name, a merged company or
  a financing vehicle (step 2).
- The **amount owed** = issue value × current nominal / issued nominal (`amountOwed` in `maturities.ts`).
  Buy-backs and new tranches after the issue value was read aren't seen (below).
- An issuer's **other bonds** matter as much as this one: maturities are judged over all the company's
  listed bonds, under all its names (step 8).

### A bond's nominal value can change

Read the nominal **from Catalyst's daily file on the day you need it**, never once at listing. On
2026-11-04, 53 of 1,051 listed bonds had a nominal different from the one first stored. **Built
(2026-11-04):** the Bonds Updater stores the current nominal on every run and keeps the issue-day one.

**Instalment redemptions (amortising bonds).** Part of the principal is repaid before maturity, so the
nominal per bond falls:
- 45 municipal bonds (e.g. Kraków KRA0528 1,000 → 500, Radomsko RMS1126 940 → 200);
- 2 corporate: Kruk KRU0228 (1,000 → 550) and Resi Capital RES0228 (1,000 → 709.27);
- probably more first seen after an instalment (corporate nominals of 500, 550, 600).

For these:
- **Amount outstanding** = issue value × current nominal / issued nominal. KRU0228: prod read 350m PLN at
  nominal 1,000, dev read 192.5m at 550; both give 192.5m outstanding now.
- obligacje.pl's "Wartość emisji w obrocie" is the amount **in circulation on the day it's read**; it also
  moves with new tranches (taps) and buy-backs. IZ0836 read 1.1bn PLN in prod and 24.2bn on dev, because
  the Treasury keeps issuing it.
- **Instalments are payments due before maturity.** They belong in the 12 and 24 month windows on their
  own dates (from the terms of issue). The app doesn't know them: the remainder is counted at maturity,
  noted.
- **Interest and accrued interest** run on the current nominal.

**Inflation-linked treasury bonds (IZ series: IZ0831, IZ0836).** Nominal = 1,000 PLN × the index ratio,
which follows CPI with a three-month lag:

```
W(n)       = ROUND(100 × Π (1 + WR_k), 5)          monthly reference index chained from 2003-07; WR_k = CPI m/m of month k
Ref(d)     = W(M−3) + (day−1)/daysInMonth(M) × (W(M−2) − W(M−3))     for a date d in month M
ratio(d)   = ROUND(Ref(d) / BaseRef, 5)            BaseRef of IZ0836 = 194.28509 (= Ref of its issue date, 2023-08-25)
nominal(d) = 1000 × ratio(d)
accrued(d) = ROUND(1000 × coupon × days since coupon start / days in coupon period × ratio(d), 2)   IZ0836: 2 %, from 25 Aug
```

- It reproduced every published Ministry of Finance value checked (PortfolioTracker, 11 of 11).
- Taken at the **settlement date** (T+2 working days, Polish holidays excluded): Catalyst's file for the
  session of 2026-11-03 gave IZ0831 1,079.85 and IZ0836 1,109.02, the Ministry's ratios for 2026-11-05.
- The **gpw.pl archive's "Cena nominalna" is unreliable for IZ** (since 2025-09-29 mostly 1,000).
- A month of negative CPI lowers the nominal three months later.
- Treasury bonds are outside the scorecard, but any yield or value of an IZ bond must use this nominal.

### Coupons and accrued interest

- **Prices are clean**, in % of nominal. Value = clean price × nominal + accrued interest.
- **Corporate coupons:** ACT/365. Per bond: nominal × rate × days since the period started / 365, rounded
  to the grosz, counted to the **settlement day** (T+2).
- From the **record day** the whole coupon goes to whoever holds the bond that day; a bond bought on the
  record day, or the business day before, doesn't get it.
- **Fixed coupons** ("stałe 7.5%"): one rate for every period. **Floating** (WIBOR 3M/6M or WIRON +
  margin): a new rate each period; obligacje.pl shows only the current period's rate, and no free fixing
  history source was found.
- **obligacje.pl has had errors:** on 2026-10-14 two record days of PLY1227 were listed a period early.
  A record day more than 31 days before its payment is wrong. A new period's rate can lag a few days.
- **Fixed-rate treasury bonds** (DS, PS, WZ): terms from the Ministry's calculator (sheet "Stałe").

## 5. Step 2: the company behind the bond

Bonds are joined to reports **by company**. **Built:** an `#IDENTITY` row per issuer name in
`IssuerProfiles` (design `2026-11-03-issuer-identity-design.md`).

### How to find it

1. **ISIN → LEI** (GLEIF ISIN mapping, open data, CC0):
   `GET https://api.gleif.org/api/v1/lei-records?filter[isin]=<ISIN>`. Try up to 3 of the issuer's ISINs.
   Resolved 162 of 208 issuer names.
2. **Name search, exact only:** `GET https://api.gleif.org/api/v1/lei-records?filter[fulltext]=<name without legal form>&page[size]=10`.
   Accept only when **exactly one** result has the same name with legal forms (S.A., Sp. z o.o., SE,
   spółka akcyjna, …) removed. Resolved 30 more.
3. **By KRS:** `filter[entity.registeredAs]=<KRS>`; by LEI: `/lei-records/<LEI>`; parent:
   `/lei-records/<LEI>/direct-parent`.
4. **Otherwise by hand**, from the company's site or filings (16 cases, e.g. Pekao, CCC, LPP, Grenevia
   formerly Famur, municipalities, PKN Orlen, i2 Development).

GLEIF allows 60 requests a minute: send about one a second.

The LEI record gives the legal name, country, local register and number, category (`GENERAL`, `FUND`,
`RESIDENT_GOVERNMENT_ENTITY`, …), LEI status (`ISSUED`, `LAPSED`, `RETIRED`) and the parent.

- A **Polish company's KRS number** is the register id when the registration authority is **`RA000484`**.
- Check it against the open **KRS register API**:
  `GET https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/<KRS>?rejestr=P&format=json` (registered name, NIP,
  REGON). A different registered name is a warning (renames happen), not an error.

### Rules

- **Entity id** = the KRS number for a Polish company, else `LEI:<lei>` (Allegro.eu and Żabka in
  Luxembourg, Pepco in the Netherlands, MOL in Hungary).
- **Names whose identities share an entity are one company:** one issuer, "also issued as …", all bonds.
- **A financing vehicle uses its group's accounts** (`financialsEntityId` points at the group). Pepco's
  bonds are issued by PEU (FIN) PLC (UK), wholly owned and guaranteed by Pepco Group N.V. Check the
  guarantee in the bond terms; without one, the claim is only on the vehicle.
- **When the LEI's legal name differs from the bond name, review before confirming:** the same body in
  another form ("Miasto Łódź" = "ŁÓDŹ-MIASTO NA PRAWACH POWIATU"), a rename or merger (Santander → Erste,
  Kredyt Inkaso → Best), a financing vehicle, or a wrong mapping. Confirmed identities are marked
  ("confirmed by hand").
- **A lapsed LEI** is shown: a small sign of administrative neglect.
- **Country matters:** a foreign issuer has another insolvency regime and no KRS filings. Show it.

### Holding companies (planned)

When the bond is issued by a holding and the debt sits in subsidiaries, the holding's bondholders rank
**behind** the subsidiaries' creditors (structural subordination). Use group figures, and flag it.

## 6. Step 3: industry, scope and rule set

### Industry (built)

One industry per issuer from a fixed list, chosen by an AI classification step with web search
(`IssuerClassification.ts`), which also stores a 2–3 sentence business summary and the official website.
The legal name is often not the brand ("P4 Sp. z o.o." is the Play network).

`Developer, Finance, Health Services, Energy, Retail, Manufacturing, Municipal, Telecommunications,
Transportation & Logistics, Media, Construction, Other`

### Scope

| Issuers | Scorecard | AI analysis | Why |
|---|---|---|---|
| Operating companies (every industry but Finance and Municipal), and unclassified | yes | yes (fallback, step 6) | |
| Non-bank lenders listed in `FINANCE_RULE_SETS` | yes, finance rules, **from reports only** | **no** | borrowing is their business: net debt / EBITDA is always high, revenue isn't meaningful, operating cash flow is negative while they grow (portfolio purchases are operating outflows) |
| Other Finance: banks, mortgage banks, insurers, state bodies | no | no | regulated (capital ratios, solvency) or state-backed |
| Municipal | no | no | public bodies |

Out-of-scope issuers still get the bond schedule, the identity and Refinancing data, without colours.
`isInFundamentalScope(industry)` (`scope.ts`) decides the AI analysis (button and schedule); lenders are
scored because `getIssuerProfiles` also accepts a name in `FINANCE_RULE_SETS`.

### Rule set (built)

| Rule set | Chosen by |
|---|---|
| developer | industry Developer |
| contractor | industry Construction |
| consumer (consumer and services) | industry Retail, Telecommunications, Media, Other |
| general | Energy, Manufacturing, Health Services, Transportation & Logistics, unclassified, any other |
| collector (debt collector) | name, in `FINANCE_RULE_SETS` |
| leasing (leasing and factoring) | name, in `FINANCE_RULE_SETS` |
| investment (investment firm) | name, in `FINANCE_RULE_SETS` |

Order of precedence (`ruleSetFor`): the finance map, then a per-issuer override, then the industry, then
general.

**Finance sub-types** (design `2026-11-05-finance-rules-design.md`). Industry "Finance" doesn't tell a
debt collector from a bank, so the sub-type is a hand-reviewed map. A new lender is added by hand, with
its sub-type; a Finance issuer not listed has no scorecard.

| Sub-type | Issuers (2026-11-05) |
|---|---|
| debt collector | Kruk, Best, Best Niestandaryzowany FIZ Wierzytelności, Kredyt Inkaso (its bonds resolve to Best S.A.), Vindexus, Grupa Corpus Iuris, Indos |
| leasing and factoring | Vehis Finanse, Internetowy Fundusz Leasingowy, AOW Faktoring, PragmaGO |
| investment firm | MCI Management |
| out of scope | Alior, Bank Millennium, BOŚ, Bank Pekao, Bank Pocztowy, BS Rzemiosła w Krakowie, Erste, Krakowski Bank Spółdzielczy, mBank, PKO BP, the mortgage banks (Millennium, PKO, ING, mBank, Pekao), BGK, PZU, EIB, PFR, State Treasury |

**Per-issuer overrides** (`RULE_SET_OVERRIDES`), each with a stated reason:

- **AB S.A. → general.** An IT distributor classified Retail: it holds stock on its own money, unlike a
  shop, so the consumer rules' operating cash flow / current liabilities (0.04×) made it red for the wrong
  reason.

## 7. Step 4: getting the reports

### Which report

- The **audited annual report** of the **latest full fiscal year**.
- **Group (consolidated) accounts first**; single-company accounts only when there are no group ones.
  **Never mix** the two across years. Small lenders often file only single accounts (Vehis, IFL, AOW).
- **12-month years only:** a quarter or half-year summed into a "year" breaks every ratio (Dadelo's
  "2026" was Q1 only).
- **Fiscal year ends vary:** Pepco and AB end on 30 September.
- **The most recent report wins (built 2026-11-05):** a year that appears in two reports keeps the newer
  report's figures, its comparative column included, because companies restate (Indos's 2024 profit
  became a loss; Unibep, PGE, Orlen, Allegro.eu, Vehis, BBI, Dekpol, Erbud, Lokum, P.A. Nova restated
  too). Exceptions are recorded per issuer (section 16): Vindexus FY2024 keeps its own report (the newer
  one hides the bonds), and Pepco's original FY2024 report isn't imported (different perimeter).
- **Three years at least** for the trend. Each report carries the previous year as a comparative column,
  so two reports give three years.
- **When a report is due:** treat a year as due **9 months** after it ends (approval within 6 months,
  then filing). On 2026-11-05 that means FY2025 for December year ends.

### Where

| Source | What | Access |
|---|---|---|
| **KRS financial documents repository**, https://rdf-przegladarka.ms.gov.pl | every Polish company's filed annual accounts since 2018: KRS XML for Polish GAAP filers; the ESEF package (zip) or PDF for IFRS filers | search by KRS number. **No API and Imperva bot protection: download by hand only, never work around it** (not with a script someone else runs either). Paid APIs with the same documents: MGBI, Transparent Data |
| **The issuer's investor relations site** | annual reports (ESEF zip, XHTML, PDF) | "Relacje inwestorskie" → "Raporty okresowe". Some reject automated downloads (Orlen, PGE): by hand |
| **ESPI / EBI** | periodic reports and current reports (defaults, rating changes, buy-backs) | via the issuer's site or GPW |
| **filings.xbrl.org** | ESEF packages, older years | `https://filings.xbrl.org/api/filings?filter[entity.identifier]=<LEI>`; Polish filings stop at FY2022; foreign issuers' later years can be there (Pepco) |
| **Bankier.pl** | mirrors of ESPI periodic reports with attachments, for **listed** companies: the ESEF package (`.zip` / `.xbri`), PDFs, the auditor's report | robots.txt (checked 2026-11-04) blocks only training crawlers (GPTBot, CCBot, Google-Extended, Bard); assistants may read it. A company's filings: `bankier.pl/gielda/notowania/akcje/<SLUG>/komunikaty[/<page>]` (slug e.g. `DEVELIA`, `BBIDEV`); the annual report is titled "<NAME> Wyniki finansowe SRR <year>" (group) or "RR <year>" (single) since 2026, "<NAME> wyniki finansowe" before. Attachments on `bonnier.pl/static/att/…` (no robots.txt); **files older than about a year answer 404**. A page links other companies' attachments too: a filing's own files share its number in their names. Bond-only (EBI) issuers aren't listed. One request every 2 s |
| **money.pl** | mirrors of ESPI filings | robots.txt allows assistants but disallows every `.pdf` for everyone (its CDN money2.wpcdn.pl included): don't fetch its PDFs |
| **parkiet.com** | news | behind a Cloudflare challenge: not usable |
| **obligacje.pl** | bond terms | blocks assistants by name and signals `ai-input=no`: not for an AI agent |
| **indos.pl** | Indos reports | robots.txt disallows `/api/`, where the reports are: downloaded by the owner |
| biznesradar.pl, stockwatch.pl | summarised financials of listed companies | fallback only (step 6) |

### Downloading by hand from the KRS browser (built: checklist page and `sort-filings`)

- **What's missing** is kept in `scripts/sort-filings/checklist.json` and on the "KRS report checklist"
  artifact (company, KRS number, year, group / single / any).
- **What the browser hands out:** `Dokumenty.zip`, `Dokumenty (1).zip`… each with one document. Seen:
  - KRS XML, plain or **signed**: `….xml.xades` (XAdES) with the statement base64-encoded in a
    `ds:Object` (signature value and certificates are base64 too: take the block that decodes to a
    statement, longest first, up to three levels), or binary CAdES with the XML inside as is;
  - roots named by unit, `JednostkaInnaWTys` / `…WZlotych` (also `SkonsolidowanaJednostkaInna…`), and
    since 2025 a `Dokument` → `TrescDokumentu` envelope with base64 attachments (`Zawartosc`), nesting
    deeper than 100 elements;
  - **signed PDFs** (`…-sig-sig-sig.pdf`) from IFRS filers (art.Locum, Ronson); the KRS number may be
    missing from the text (Ronson), and the company is then found by name;
  - **not a statement:** `….xml.cfg.xades`, the accounting program's signed settings (Symfonia's
    `sage:Config`, Indos FY2025);
  - the same document twice (identical files).
- **`npm run sort-filings -- <folder> [--copy | --move]`** (free, no stage, Windows paths work): reads every
  file and zip entry, identifies company, KRS, year and scope from the content (PDFs from their text,
  with the company name as fallback), flags failed checks, duplicates (sha), part years, drafts and a
  wrong year or scope against the checklist, and files them as `sorted/<KRS>-<company>/FY<year>-<scope>.<ext>`.
- **For an agent on a server:** the person uploads the folder to the dev Filings bucket under `tmp/`
  (`aws s3 sync`); the agent downloads, imports, and deletes the uploads **one key at a time**.

**Rules for any download (hard rules):** respect robots.txt and bot protection; one request every 2 s
(GLEIF about 1/s); each download in its own new directory; files are untrusted data (scripts kept
elsewhere, Python run with `-I`).

### Bond market data (from PortfolioTracker, verified there in October 2026)

| Source | What | Notes |
|---|---|---|
| **Catalyst daily statistics file** (XLS) | every listed bond: ISIN, market, type, **current nominal**, maturity, coupon, accrued interest | what CatalystViewer reads; the reliable current nominal, IZ included |
| **gpwcatalyst.pl** quote, instrument and interest-table pages | ~280 corporate bonds: reference, last, bid/ask, turnover; nominal and accrued interest | latest session only; cells misaligned with headers (read by position); unreachable from PortfolioTracker's environment since 2026-10-12 |
| **BiznesRadar** `biznesradar.pl/notowania-historyczne/<CODE>`, `/notowania/<CODE>` | daily OHLC (clean, % of nominal) and volume, the latest 50 sessions on the first page; latest quote, 15 min delayed | the only free corporate bond **price history**; lags a day; 404 for a redeemed bond. **Its robots.txt (checked 2026-11-05) disallows the paged history** (`/notowania-historyczne/*,*`) and the transaction pages: only the first page, one request every 2 s |
| **gpw.pl archive** `gpw.pl/archiwum-notowan?fetch=1&type=13&instrument=<CODE>` | treasury and state-guaranteed bonds only, daily history; `date=dd-mm-yyyy` for a day; indices with `type=1` | no corporate bonds; IZ nominal unreliable; resets after a few dozen requests |
| **Ministry of Finance calculator** `kalkulatorodsetek.xlsm` (gov.pl/web/finanse/kalkulatory2) | CPI reference index `W(n)` since 2003-07; every IZ series; fixed-rate treasury series | read as data; VBA macros never run |
| **Ministry of Finance index ratios** gov.pl/web/finanse/wspolczynniki-indeksacji2 | daily IZ ratio and accrued interest | cross-check |
| **Ministry of Finance retail bonds file** (gov.pl/web/finanse/obligacje-detaliczne1) | retail treasury series (EDO, COI, ROD, ROS, TOS, ROR, DOR) | not traded on Catalyst |
| **GUS CPI** (stat.gov.pl, CSV, Windows-1250, `;`) | monthly CPI in five bases | ~15th of the month; file name changes; GUS revises January, the Ministry keeps the first figure |
| **NBP** `api.nbp.pl/api/exchangerates/tables/a/` (current), `/rates/a/{code}/{from}/{to}/` (≤ 93 days) | table A mid rates | CatalystViewer uses the current table, cached for a day |
| Bossa EOD, Stooq | | gone / behind a JavaScript challenge |
| Cbonds (trial), GPW paid history (1,900 PLN per year of data) | Catalyst history | only if the free sources fail |

### Formats

| Format | Who files it | Notes |
|---|---|---|
| **KRS XML** | companies under the Polish accounting act (most unlisted issuers) | fixed line codes from the Ministry of Finance schemas (`JednostkaInna…`, `SkonsolidowanaJednostkaInna…`, also `…WTys` / `…WZlotych`; schema versions 1-2, 1-3, 2-0E, the 2025 "(2) 1-0E"); złoty or thousands (`KodSprawozdania`); signed or not; the 2025 envelope. Small and micro entities (`JednostkaMala`, `JednostkaMikro`) not supported |
| **ESEF package** (`.zip`, `.xbri`) | listed IFRS reporters; consolidated statements tagged with inline XBRL | prefer the package to the bare `.xhtml`: it carries the filer's calculation tree, anchors and labels |
| **IFRS text** (`.xhtml`) | listed companies' separate statements (untagged) | by labels, best effort, not extended further |
| **PDF** | unlisted IFRS reporters (P4, art.Locum, Ronson), foreign issuers (Allegro.eu, Pepco, MOL), issuers with only a PDF | read by a model or by hand, checked in code (step 5); Polish, English, Hungarian; scanned PDFs not supported |

## 8. Step 5: reading the reports

### Principle

**Numbers come from documents and are read by code wherever possible. A model may copy lines from a PDF,
but code checks every amount.** The audit of 2026-10-29 found the earlier approach unreliable: a model
retyped about 70 numbers per issuer from web pages, unchecked. Every figure keeps its sources (statement
lines or XBRL concepts), its period, its scope and its accounting standard.

### Statement lines (built)

Every line of the three primary statements is stored per year (`lines`): the label as printed; the value
in units of currency; the filing's identifier (KRS code like `Pasywa_B_III_3_A`, XBRL concept like
`ifrs-full:Inventories`); the anchor of an ESEF extension; the parent subtotal; the PDF page; and a
**standard item** from one vocabulary across formats:

```
income:    revenue, costOfSales, grossProfit, ebit, depreciation, interestExpense, financeCosts,
           financeIncome, profitBeforeTax, incomeTax, netProfit, impairment
assets:    totalAssets, noncurrentAssets, propertyPlantEquipment, investmentProperty, intangibleAssets,
           goodwill, loansGranted, currentAssets, inventory, tradeReceivables, cash
equity &   equity, minorityInterests, totalLiabilities, noncurrentLiabilities, currentLiabilities,
liabs:     totalEquityAndLiabilities, debtBankLoans, debtBonds, debtLeases, debtMixed, debtOther,
           debtSecuritisation, otherFinancialLiabilities, tradePayables, contractLiabilities, provisions
cash flow: operatingCashFlow, capex, investingCashFlow, financingCashFlow, interestPaid, dividendsPaid,
           borrowingsRaised, borrowingsRepaid
```

How items are given:
- **From the figures:** each line a scorecard figure is made of gets that figure's item; debt lines get
  their kind from label or concept (`debtKind`: loan / bond / lease; two kinds in one label = mixed).
- **By code from label or concept** (`markLineItems`), for lines without an item, in every format:
  - `impairment`: an income-statement write-down of non-financial assets ("utrata wartości", "odpis
    aktualizujący", impairment, write-down), not of receivables, loans or financial assets, not a reversal
    or a subtotal;
  - `debtSecuritisation`: balance-sheet lines naming securitisation ("sekurytyzac", "securitis/z");
  - `otherFinancialLiabilities`: "pozostałe / inne (krótko-, długoterminowe) zobowiązania finansowe",
    "other (current / non-current) financial liabilities", `…:Other(Current|Noncurrent)FinancialLiabilities`.
- The PDF prompt (version `pdf-statements-6`) doesn't ask the model for the three code-found items, so
  every format is judged by the same rule and no AI call changed.

**Item totals** (`items`, built): per year, the sum of lines per item, counted only in the item's home
statement; a line under a parent of the same item isn't counted again; paid amounts positive; a
write-down positive for a loss. Two extra totals:
- `debtDueWithinYear`: the debt lines (bank loans, bonds, leases, mixed, other, securitisation) under
  current liabilities. The section is found by the lines' parents; without parents, by order: the lines
  after the current liabilities line up to the next section (non-current liabilities, equity, total
  liabilities, total equity and liabilities), or, when the total is printed **under** its lines ("…
  razem", "Total …", "összesen"), the lines above it back to the previous section. It is 0 when the
  section has no debt, and absent when there's no current liabilities line (balance sheets in order of
  liquidity: Kruk, Best);
- `otherFinancialDueWithinYear`: the same for other financial liabilities.

**Signs:** printed formats (PDF, IFRS text) show a cost in brackets as negative; tagged formats (KRS XML,
ESEF) show a cost as positive. Treat the size, and read the label.

### Scorecard figures and how each is defined

| Figure | Definition and choices |
|---|---|
| Revenue | sales revenue total. A financial company without one (Kruk): its operating income total (portfolio interest income, services, sales) |
| EBIT | operating profit. **When the statement prints none** (KGHM, Polenergia): profit before tax + finance costs − finance income, noted on the card; it then includes associates and joint ventures. ESEF: `ProfitLossFromOperatingActivities`, unless the calculation tree sums the operating lines into another line (Orlen FY2024 swapped the tag with the share of associates) |
| Profit before tax | income statement line (item total); used by the lenders' interest cover and the derived EBIT |
| Depreciation | of all assets (both intangible lines, right-of-use assets); from the cash flow when the income statement has none; when the line includes impairment, the tagged impairment is taken off |
| Interest expense | interest costs; ESEF filers rarely tag them, so total finance costs are used (this overstates interest) |
| Interest paid | cash flow line, positive |
| Net profit | for the period, including minorities |
| Financial debt | interest-bearing debt to third parties: bank loans, bonds, other borrowings, **leases**, bills of exchange. Not trade payables, provisions or other operating liabilities. KRS XML can't separate debt owed to related parties, so it's left out. A line combining loans and bonds ("financial liabilities", P4) counts with no bond split. A balance sheet in order of liquidity takes the debt lines under total liabilities. **Plus, in the scorecard** (`filedYears`): securitisation funding, always (Vehis); and a **lender's** "other financial liabilities" when it has listed bonds and the year shows no bonds line nor a mixed line (Vindexus FY2025), counted as bonds and noted |
| Bonds | the bonds lines of the balance sheet (`debtBonds`), plus the lender case above |
| Cash | cash and cash equivalents |
| Current assets / liabilities | totals; when only totals excluding held-for-sale items are tagged, the held-for-sale lines are added |
| Inventory | for developers: land, work in progress, finished flats |
| Investment property | separate line (developers) |
| Contract liabilities | customer and buyer advances |
| Leases | lease liabilities, part of financial debt |
| Debt due within 12 months | `debtDueWithinYear` above (+ the lender's other financial liabilities due, when counted as bonds) |
| Operating cash flow, capex | cash flow statement; capex as paid, positive |
| Write-downs | the `impairment` total, added back to EBIT for EBITDA and interest cover **only when the depreciation figure doesn't already include them** (PGE, Allegro, Pepco, MOL print "depreciation, amortisation and impairment" as one line; Cyfrowy Polsat's takes the goodwill write-down out again) |

### Checks (the import is refused when they fail)

- total assets = total equity and liabilities;
- total assets = non-current + current (KRS XML, ESEF);
- net profit in the income statement = in the balance sheet (KRS XML);
- where parents are known, the lines under total assets, and under total equity and liabilities, add up;
- PDF: every copied amount appears on its page, the balance sheet ties, equity and net profit present; a
  UK-style balance sheet (net assets, Pepco) checks total assets = equity + total liabilities;
- IFRS text only when the balance sheet ties.

`--force` stores a filing whose checks failed (the failures are kept in `filing.checks`).

### PDF route in detail (built)

1. Code reads the PDF text (pdfjs-dist) and finds the statement pages: a statement heading (Polish,
   English, Hungarian) near the top of a page that is mostly table lines. Tables of contents are skipped.
2. A model copies every line of the three statements through a fixed-schema tool (`record_statements`),
   computing nothing: label, page, amount per year column exactly as printed, the standard item.
3. Code parses the amounts (Polish `1 792,2` or English `1,792.2`, decided per report; Polenergia prints
   Polish numbers in English) and sums the figures; the checks above run.
4. If a statement comes back empty, the model is asked once more and the fuller answer kept.

About $0.15 per report with Sonnet 4.6 (~8k tokens in, ~10k out). Re-reads aren't identical; a re-read
whose figures differ is left alone. The row records model, prompt version and pages (`filing.extraction`).

**Read by hand instead of a model call** (built; used for every PDF since 2026-11-04 at the owner's
request, so no Bedrock cost):
1. `import-filing <pdf> --print-prompt <file>` writes the pages and the instructions.
2. The reader (Claude in a chat) writes the `record_statements` JSON, copying labels exactly and amounts
   as printed, never computed.
3. `import-filing <pdf> --transcript <file.json> --transcript-by "<who>"` runs the same checks and stores
   it, with the reader as the extraction's model.

### Company check on import

- KRS XML and IFRS text carry the KRS number; ESEF carries the LEI (the KRS number comes from GLEIF).
- A PDF's KRS number whose registered name differs from the report's company is refused (probably a
  subsidiary's, from the list of group companies): pass `--krs`, or `--lei` for a foreign issuer.
- The issuer is matched by the filing's or the registered name (legal forms ignored) or by `--issuer`; a
  second company for the same issuer is refused without `--force`.

### Storing (built)

- The original file goes to the Filings bucket (`filings/<entityId>/<period end>-<scope>-<hash>.<ext>`).
- One row per fiscal year: the report's own year (`column: current`) and its comparative year
  (`previous`). Each row records `reportPeriodEnd`, the year of the report it came from.
- **Write condition:** a row is written only if no row exists, or the stored row's report is not newer
  (its `reportPeriodEnd` ≤ the incoming report's). An older report never overwrites a newer report's
  year; the importer prints "kept the existing row (from a more recent report)".

### Quality control (built)

The known-answers set (`scripts/check-filings/expected.json`, 40 reports) holds figures read by hand from
the printed statements. `check-filings` compares them with the stored rows and with a fresh parse of the
original (PDFs only with `--pdf`, which costs a model call each). A stored row that now comes from a newer
report isn't compared; only the re-read is. Run it after any parser or prompt change, and add each new
report's hand-read figures. `--mark` sets review status `hand-checked`.

## 9. Step 6: figures when there is no report

The app's first approach, kept as a fallback for **operating companies** without an imported report.
Lenders never use it.

- **How (built):** `IssuerAnalysis.ts`, an AI agent (default model `sonnet_4.6` on Bedrock) with web
  search (Tavily), the biznesradar and stockwatch tools, and a Polish task prompt with today's date. It
  makes at most 5 tool calls and collects up to 5 full years in PLN millions, with nulls where nothing was
  found. Output: `{ companyName, currency, unit, notes, years: [{ year, revenue, ebit, depreciation,
  interestExpense, netProfit, totalAssets, intangibleAssets, equity, financialDebt, cash, currentAssets,
  inventory, currentLiabilities }] }`. Stored figures are re-scored when the rules change.
- **When it runs:** the card's "Run Fundamental Analysis" button (signed-in users), and the scheduled
  Bonds Updater step (`selectIssuers`: the stalest in-scope issuers, 2 per run by default). Changes to
  the schedule, the state machine or the AI calls need the owner's approval.
- **When it's used:** the filed report wins whenever its latest year is at least as recent as the
  agent's.
- **Confidence:** medium at best.

Known failure modes, which any agent doing this must avoid:

- **Part-year figures labelled a full year:** skip the current year and any year with fewer than four
  quarters.
- **Not knowing today's date:** pass it (a model once skipped a complete 2025 in October 2026).
- **Units:** the tools return PLN thousands; a mix of units within a year breaks the ratios.
- **The first search hit for the company:** check that it is the company from step 2.
- **No figure is better than a guessed one.**

The direction: an issuer without a report gets a report imported, rather than a better agent (section 18).

## 10. Step 7: the scorecard

### Definitions

- **Net debt** = financial debt − cash (leases included). For a lender without a cash figure: gross debt,
  noted.
- **EBIT before write-downs** = EBIT + write-downs outside depreciation (≥ 0).
- **EBITDA** = EBIT before write-downs + depreciation.
- **ICR** (interest cover) = EBIT before write-downs / interest expense. Developers: / interest paid when
  known. Lenders: (profit before tax + |interest|) / |interest|, EBIT-based only without profit before
  tax.
- **Asset coverage ratio** = (total assets − intangibles − current liabilities) / financial debt.
- **Equity ratio** = equity / total assets.
- **ROE** = net profit / the average of this and last year's equity (this year's alone if last year is
  missing). **ROA** = net profit / total assets.
- The **latest full year** gives dimensions 1–5; dimension 6 uses up to 5 years; dimension 7 uses the
  bonds and the latest report.

### Signal rules

- "Lower is better" metric: green below the first threshold, yellow up to the second inclusive, else red.
  "Higher is better": green above the first, yellow from the second inclusive, else red.
- Without inputs, or on a division by zero: **n/a**, never a colour.
- **Negative equity** makes D/E and net debt / equity red; **EBITDA ≤ 0** makes net debt / EBITDA red;
  average equity ≤ 0 makes ROE red. **Negative revenue** (a lender's portfolio written down: GetBack 2017) gives no margins: a loss is red, a profit n/a.
- A dimension takes the **worst** of its scored metrics, ignoring n/a; it is n/a when all are n/a.
- **"Shown, not scored"** metrics are context only (grey on the card).
- **Trend:** n/a with fewer than 3 years or no computable metric; red when 2 or more metrics are red;
  green when all computable ones are green and there are at least 2; yellow otherwise.
- **Quick ratio: removed** for every rule set (it was red for 12 of 27 issuers, KGHM included, whose
  inventory is copper).

### Trend formulas (dimension 6, every rule set; in PT the arrows, not a colour)

Years sorted oldest to newest, up to 5:

- **Revenue CAGR** = (newest / oldest)^(1 / (years − 1)) − 1; n/a when the oldest is ≤ 0. Green > 5%,
  yellow ≥ 0.
- **EBITDA margin trend** = least-squares slope of EBITDA / revenue per year (years with revenue > 0),
  needing ≥ 3 margins. Green when the slope is > 0, or within ±0.005 with the latest margin above 10%;
  yellow when ≥ −0.005; red below.
- **Net debt / EBITDA trend** = least-squares slope of net debt / EBITDA (years with EBITDA > 0), needing
  ≥ 3 values. Green < −0.1, yellow ≤ 0.1, red above.

### Thresholds: operating companies

Green / yellow.

| Dimension | General | Developer | Contractor | Consumer and services |
|---|---|---|---|---|
| **1 Debt Burden** | D/E < 1.0 / ≤ 2.0 · Net debt / EBITDA < 2.5 / ≤ 4.0 | Net debt / (inventory + investment property) < 0.3 / ≤ 0.6 · Net debt / equity < 0.5 / ≤ 1.0 | as General | Net debt incl. leases / EBITDA < 3.0 / ≤ 4.5 · Net debt excl. leases / EBITDA shown · Free cash flow (OCF − capex) / net debt > 15% / ≥ 5%, net cash = green |
| **2 Debt Service** | ICR > 3.0 / ≥ 1.5 | EBIT / **interest paid** when known, else / interest expense: > 3.0 / ≥ 1.5 | as General | as General |
| **3 Liquidity** | Current ratio > 1.5 / ≥ 1.0 | Current ratio > 2.0 / ≥ 1.3 · Buyer advances / inventory shown | Current ratio > 1.2 / ≥ 1.0 · (Cash − contract liabilities) / revenue > 5% / ≥ 0 | OCF / current liabilities > 0.5 / ≥ 0.3 · Current ratio shown |
| **4 Profitability** | EBIT margin > 10% / ≥ 5% · Net margin > 5% / ≥ 1% | EBIT > 15% / ≥ 8% · Net > 10% / ≥ 5% | EBIT > 4% / ≥ 2% · Net > 2.5% / ≥ 0.5% | as General |
| **5 Asset Coverage** | ACR > 1.5 / ≥ 1.0 · Equity ratio > 30% / ≥ 15% | ACR as General · Equity ratio > 35% / ≥ 25% | as General | ACR shown · Equity ratio > 20% / ≥ 10% |
| **6 Financial Trend** (PT: arrows on 1 and 4) | formulas above | same | same | same |
| **7 Refinancing** | step 8 | same | same | same |

### Thresholds: lenders (finance rules)

| Dimension | Debt collector | Leasing and factoring | Investment firm |
|---|---|---|---|
| **1 Debt Burden** | Net debt / equity < 1.5 / ≤ 2.5 · Bonds / financial debt shown | Net debt / equity < 4.0 / ≤ 6.0 · Bonds / debt shown | Net debt / total assets < 25% / ≤ 40% · Bonds / debt shown |
| **2 Debt Service** | ICR (profit before tax + interest) > 2.5 / ≥ 1.5 | > 1.5 / ≥ 1.2 | shown |
| **3 Liquidity** | Cash / debt due within 12 months > 0.5 / ≥ 0.2 (none due = green) · Operating cash flow shown | > 0.3 / ≥ 0.1 · OCF shown | > 0.5 / ≥ 0.2 · OCF shown |
| **4 Profitability** | ROE > 12% / ≥ 6% · ROA > 5% / ≥ 2% | ROE > 12% / ≥ 6% · ROA > 1.5% / ≥ 0.75% | ROE and ROA shown (revaluations) |
| **5 Asset Coverage** | Equity ratio > 35% / ≥ 25% | > 15% / ≥ 10% | > 50% / ≥ 35% |
| **6, 7** | as operating companies | same | same |

Notes the lender rules add to the card: securitisation in debt (amount, share, "bondholders rank behind
it"); bonds taken from other financial liabilities; "no cash figure: net debt is gross debt"; "net profit
above revenue: a one-off or a revaluation is likely in it"; for investment firms, profit "shown, not
scored".

### Why each rule set differs

- **Developers:** flats and land are inventory, so the quick ratio was always red. Revenue is booked on
  handover, so EBITDA swings (Echo 13×). Interest is capitalised into inventory, so income-statement
  interest flatters: use interest paid. Judge debt against the stock it finances.
- **Contractors:** margins of 2–5% are normal. Their cash is largely customers' advances, which aren't
  theirs to spend: count cash net of advances.
- **Consumer and services:** suppliers finance the stock and customers pay upfront, so current
  liabilities exceed current assets by design: judge liquidity by operating cash flow. Shop, mast and gym
  leases are debt under IFRS 16: debt including leases, shown also without.
- **Debt collectors:** they buy defaulted receivables at a discount and recover them over years; the
  portfolio is the asset and its recoveries are estimates. Leverage against equity and the pre-tax margin
  over interest are what their bond covenants watch. Buying portfolios is an operating outflow, so
  operating cash flow is negative when they grow, and it isn't scored.
- **Leasing and factoring:** their assets are receivables repaid on a schedule, so they run on thinner
  equity than collectors. Their funding often includes securitisation, which ranks ahead of the bonds.
- **Lenders' interest cover from profit before tax:** under the Polish accounting act their income from
  portfolios and loans is often finance income, below EBIT (Corpus Iuris: EBIT 3.5m PLN, profit before tax
  36.5m; EBIT cover 0.53, pre-tax cover 6.53).
- **Investment firms:** profit is mostly revaluation of holdings, and interest is paid from exits and
  dividends, which the statements don't show as income. Only the balance sheet is scored.
- **Write-downs (all operating rule sets):** a non-cash one-off (Cyfrowy Polsat's 2,717m PLN goodwill
  write-down in 2025) shouldn't decide debt service. EBITDA and ICR are measured before it, noted; the net
  margin keeps it, because the loss was real.

**Provenance:** the thresholds are starting values from common credit practice (CFA, S&P criteria,
leveraged finance convention), adjusted per sector and checked on the imported issuers. They are **not
calibrated** on Catalyst defaults yet (section 18).

## 11. Step 8: refinancing

The bondholder's main near-term question: can the issuer pay the bonds due soon from cash and the cash
its business makes, or does it depend on refinancing? **Built** for every issuer with bonds or a report
(design `2026-11-03-bond-maturities-vs-cash-design.md`).

- **Schedule:** the company's active listed bonds under all its names, plus a group's financing vehicle;
  one per ISIN; maturity ≥ today; at the amount owed (step 1), by maturity date.
- **Currency:** converted to the report's currency at the NBP table A mid rate; a bond without a rate is
  shown but left out of the totals, noted.
- **Windows:** 12 and 24 months from **today**; the cash is from the report date; both dates are given.
- **Covers:**
  - cash cover 12m = cash / bonds due within 12 months;
  - liquidity cover 24m = (cash + 2 × operating cash flow) / bonds due within 24 months; a negative
    operating cash flow counts as negative; without one, cash alone against 24 months, noted.
- **Signal** from the weaker cover: green ≥ 1.5×, or nothing due within 24 months; yellow ≥ 0.75×; red
  below; n/a without a cash figure.
- **Notes:** the cash report date; "listed bonds only, as issued less instalments repaid: loans, unlisted
  bonds and bonds bought back are not included"; instalment bonds by name; listed bonds vs the balance
  sheet's bonds when they differ by more than 5% (Cyfrowy Polsat: 2,670m listed vs 4,020m).

Not included yet: bank loans due, undrawn credit lines, developers' escrow accounts, the dates of later
instalments, taps and buy-backs after the bond was first seen (section 18).

### Repayment track record (planned)

In PortfolioTracker this is built: approaches 1 to 3 below by code (Docs/catalyst.md, "Repayment track record"), and
approach 4 by the agent, which records what the issuer's current reports say as **payment events** (`catalyst events
put`: missed or late payments, changed terms, bondholders' meetings, covenant breaches, insolvency, buy-backs below
par, or a payment made), each with its report and the passage that says it.

How an issuer handled its past bonds is direct evidence for the question this analysis asks. An issuer
that has repaid twenty series on time, several of them early, is a different risk from one that extended
maturities, paid late or restructured. Catalyst issuers often repay old bonds with new ones, so the record
also shows whether they could still raise money when it mattered. It complements the scorecard; it is not
a seventh colour.

**What to show, per company** (all its names and financing vehicles, as in Refinancing):

- counts: bonds repaid at maturity, redeemed early (call, buy-back, mandatory redemption), restructured
  or extended, not paid (default), unknown;
- a "Past bonds" table: bond, ISIN, amount, maturity, when trading ended, how it ended, the last price
  before the end, and the source of each fact;
- the period covered ("since 2023-03", "since 2018"), so a short record isn't read as a clean one;
- red flags: any missed payment, a suspension because of a payment, a GPW marking (below), a maturity
  extended by a bondholders' meeting, a bond bought back well below par.

**Signals and their meaning:**

| Signal | Reads as |
|---|---|
| left trading within ~2 weeks of maturity (the redemption record date), last price near par | repaid at maturity (inferred; confirmed by a GPW notice or the issuer's report) |
| left 30+ days before maturity, last price near par | early redemption: an issuer call (bank MREL bonds leave a year before maturity), a buy-back, a refinancing; or a merger (Kredyt Inkaso → Best) |
| still listed or suspended after maturity | not paid, or paid late |
| last price well below par before the end, or a buy-back below par | distress, or a restructuring at a loss for bondholders |
| GPW marking `/1`–`/23` on the issuer's instruments | bankruptcy petition or ruling, liquidation, arrangement or sanation proceedings, information breaches |
| suspension "na wniosek emitenta" before a redemption | routine (trading stops for the redemption) |
| issuer report "niezrealizowanie świadczenia", "niedokonanie wykupu", "nieterminowa wypłata" | payment missed |

**What the app's own data shows already** (prod, 2026-11-05). The daily update keeps a bond after it leaves
the Catalyst file, as `inactive`, since 2023-03-10:
- 314 corporate bonds ended; 151 left at maturity;
- 163 left more than 30 days before it, all last trading at ≥ 90% of nominal (161 at ≥ 98%): calls,
  buy-backs and mergers rather than distress;
- no listed corporate bond is past its maturity.

This matches the market reports (analizy.pl: 2024 had no corporate credit incident apart from the Getin
Noble Bank restructuring). A bond on two markets (GPW and BondSpot) is stored twice and must be counted
once.

**Possible approaches**, cheapest first (they combine):

1. **From the app's own records (no new source).** Classify each inactive bond by when it left against
   its maturity and by its last price, per company. Labelled "inferred from trading", it can say "repaid"
   only as "left at maturity, trading near par". Covers 2023-03 onwards only; can't tell a call from a
   buy-back, nor see unlisted bonds.
2. **Record the reason going forward (Bonds Updater).** On each run, also read:
   - GPW's [suspensions and exclusions](https://www.gpw.pl/zawieszenia-i-wykluczenia): ISIN, issuer LEI,
     action, reason, dates, since 2018;
   - the Catalyst notices ("zakończenie obrotu … w związku z przedterminowym wykupem / z wykupem");
   - the [special markings](https://gpwcatalyst.pl/szczegolne-oznaczenia-instrumentow-finansowych) of
     instruments.

   Store the reason with the bond when it leaves. GPW's robots.txt allows this. It adds an external
   source to the schedule, so it needs the owner's approval.
3. **Backfill the past from GPW.** The same pages for 2018 onwards, and the board resolutions
   ([gpwcatalyst.pl/uchwaly-zarzadu](https://gpwcatalyst.pl/uchwaly-zarzadu), older items behind "show
   earlier") for exclusions and suspensions before that. That gives every bond that ever left Catalyst with
   a reason, also bonds the app never saw. One request every 2 s.
4. **Confirm payment from the issuer.** Its EBI/ESPI current reports: "terminowy wykup" (paid on time),
   "przedterminowy wykup" (early), "niezrealizowanie świadczenia" (not paid), a bondholders' meeting
   changing the terms. Mirrors:
   - Bankier: listed companies; the report text stays, attachments go after about a year;
   - PAP Biznes article pages: its robots.txt disallows `/api`, `/search/`, `/wyszukiwarka`;
   - GPW's issuer reports page;
   - not Parkiet: it's behind a Cloudflare challenge, so not automatically.

   A model can read the report text, with the quote checked in code (as for the notes, section 18).
5. **From the annual reports already imported.** The debt note lists the series issued and repaid in the
   year; the cash flow has `borrowingsRepaid`. Confirms repayment for the years with reports, also of
   bonds outside Catalyst; it needs the notes read (section 18, item 2).
6. **Named defaults from market statistics.** The monthly default-rate articles based on Obligacje.pl's
   index (republished by analizy.pl, bank.pl, Parkiet) name the defaulted series and issuers: a
   cross-check, and the calibration set (GetBack 2018, PBG, Braster, Europejskie Centrum Odszkodowań, …).
7. **Legal status.** The KRS register API (open) shows liquidation, bankruptcy and restructuring entries
   in the company's current record. The court register of insolvent companies (KRZ) refuses automated
   access (its robots.txt answers 401), so it's by hand only.

**Not available, or not for an agent:**
- obligacje.pl's archive of past bonds and defaults: it blocks AI assistants (a person may browse it);
- a per-bond list of missed payments from KDPW: it notifies (e.g. PTI's unpaid interest), but no list
  was found;
- price history of bonds that are gone: BiznesRadar answers 404, and its paged history is disallowed;
- unlisted private placements.

**Reliability:** a GPW notice says *that* and usually *why* trading ended; the issuer's report or a
default list says *whether it was paid*. Well-known defaults are covered by several sources. Small issuers
years back will have gaps, shown as "unknown", never as "repaid".

## 12. Step 9: data confidence

How much the colours rest on. **Built** (`confidence.ts`, design `2026-11-03-data-confidence-design.md`).

- **Source:** imported report (format, scope, year) or AI-collected figures (date).
- **Years behind:** later fiscal years whose report is due (year end + 12 × n + 9 months ≤ today) but not
  used.
- **Metrics computed:** the scored metrics of the five snapshot dimensions that have a value, and the
  names of the missing ones. Trend (needs years) and Refinancing (needs bonds) aren't counted.
- **Thin dimension:** coloured by one metric where it has two or more scored ones.
- **Level:**
  - **low:** under 50% of metrics computed, or 2 or more snapshot dimensions n/a, or 2 or more years
    behind;
  - **high:** an imported report, at least 80% of metrics, not behind;
  - **medium:** the rest. AI-collected figures are never high.
- **Facts** shown in the tooltip: source and year, years behind, "n of m metrics computed; missing: …",
  "fewer than 3 years: no trend", thin dimensions.

A low-confidence card is shown faded.

## 13. Step 10: the judgement

The scorecard is the start, not the verdict. Write a short judgement (a few sentences, figures with their
year) from these principles.

### Reading the scorecard

- **Debt service is the most important dimension for a bondholder.** ICR below 1.5× is a serious warning
  whatever else is green; below 1.0×, profit doesn't pay the interest and the issuer borrows or uses
  reserves to pay it.
- **Refinancing is the nearest risk.** A red with bonds due in months matters more than a three-year
  trend. Ask where the money comes from: cash, operating cash flow, asset sales, new bonds.
- **The trend can override the snapshot.** A borderline yellow year at the end of a three-year slide is
  worse than the same year after a recovery.
- **Read the reds against the rule set.** A developer's low current ratio, a shop's negative working
  capital and a contractor's thin margin are normal for them; check the business model (the AB case).
- **Separate one-offs from the trend:** write-downs, disposals, acquisitions that lift leverage for a
  year, revaluations (Corpus Iuris). Read the notes before calling a red structural.
- **Seasonality:** a year-end balance sheet may catch a seasonal low (developers before handovers,
  retailers after Christmas).
- **Group vs single:** a holding's own accounts can look clean while the debt sits in subsidiaries, and
  the reverse; note structural subordination.
- **Lenders:** look at the funding structure. Securitisation or secured bank funding ranks ahead of the
  bonds (Vehis: 85% of debt). A lender funded almost only by bonds (IFL, Indos, Corpus Iuris: over 90%)
  depends on the bond market to roll over. A collector's ROE built on revaluations, a growing portfolio
  financed by new bonds, and falling collections against purchases are the GetBack pattern.

### Red flags outside the metrics

Look for these in the report, the auditor's report and current reports; any of them can outweigh good
ratios.

- **The auditor's opinion:** a qualified opinion, a disclaimer, an **emphasis of matter on going concern**
  (*istotna niepewność dotycząca kontynuacji działalności*), a change of auditor.
- **A late or missing annual report.** Missing or restated data is a signal (Indos restated its 2024
  profit to a loss).
- **Covenant breaches,** waivers, debt reclassified to current because of a breach.
- **Bond terms:** collateral and security, guarantees (a financing vehicle's guarantor), ranking,
  cross-default clauses, secured or unsecured.
- **Pledges and owners' debt:** the issuer's shares pledged for its owner's bonds (Ronson: all shares, for
  Luzon Ronson N.V.'s bonds) tie it to its parent's finances.
- **Related-party transactions:** loans to owners, sales to related companies, receivables from related
  parties (KRS XML can't separate related-party debt).
- **Defaults and restructurings:** missed coupons, extended maturities, buy-backs below par,
  restructuring proceedings, Catalyst suspensions (ESPI/EBI current reports).
- **Market signals:** a price well below par, a widening spread, collapsing liquidity: not proof, but a
  reason to look. The app's own quote history (since 2023) shows when the market started to doubt the
  issuer; a bond that stops trading before maturity needs an explanation (step 8, "Repayment track
  record").
- **The repayment track record:** missed or late payments, extended maturities, buy-backs below par (step
  8, "Repayment track record").

### Benchmarks to compare with (planned)

Polish bankruptcy-prediction models (Mączyńska, Hołda, Gajdka–Stos) as a cross-check; past Catalyst
defaults, GetBack 2018 first, to calibrate the thresholds.

## 14. Presenting the result

**Built** in the app:

- **Issuer card:**
  - a row of 7 dots in the header, faded when confidence is low;
  - expanded, a grid of dimensions with a tooltip each: metrics with values and colours, "not scored"
    metrics in grey, notes;
  - a title line "Fundamental Analysis · <rule set> rules · <level> confidence", with the facts in a
    tooltip. Rule set labels: developer, contractor, consumer and services, debt collector, leasing and
    factoring, investment firm (general isn't named);
  - the analysis button only for issuers in AI scope.
- **Industry filter** (corporate bonds): the filter drawer's Industry chips (companies per industry among
  the bonds the other filters leave), with a "Kind of financial company" row when Finance is chosen (debt
  collector, leasing & factoring, investment firm, banks & other, from `FINANCE_RULE_SETS`); a card's
  industry chip shows that industry alone. It filters both views, and the page title names it
  (`packages/web/src/bonds/fundamentals/industries.ts`).
- **Source line:** "Figures from the annual report (ESEF, IFRS), group accounts, fiscal year ending
  2025-12-31 and 1 earlier", or AI-collected.
- **Registration line:** country, KRS or local register number, LEI, "LEI lapsed".
- **Financials view** (`/financials`):
  - up to six years of figures, with the source per year, a link to the original and the lines behind
    each figure;
  - years where AI-collected and filed figures differ by more than 2% are marked;
  - *Full statements*: a year's lines as printed;
  - *Bond maturities*: year by year, the amount due per currency against cash and operating cash flow,
    "Owed" for instalment bonds.

**An analysis written by an agent** follows this layout:

```
<Company> (<legal name>, <country>, KRS <…> / LEI <…>) — <industry>, <rule set> rules
Bonds: <n> listed, <amount> due in 12 months, <amount> in 24 months; this bond <name>: <amount owed>, matures <date>, <coupon>
Figures: <source>, <scope> accounts, FY<year> (+<n> earlier) — confidence <level> (<facts>)

| Dimension | Signal | Metrics (value, colour) |
… 7 rows …

Judgement: 2–5 sentences. The reds that matter and why; what offsets them; refinancing.
Red flags: auditor, late filing, covenants, related parties, defaults — with source and quote, or "none found in <documents read>".
Watch: what would change the view (next report date, a maturity, a covenant).
Sources: each document with year and link.
```

Give every number with its year and unit; never present a figure not found in a document as if it were;
say what wasn't checked.

---

# Part C: reference

## 15. Data model

| Table / store | Key | Holds |
|---|---|---|
| `BondDetails` | bond | every listed bond: issuer name, ISIN, type, market, issue value, `nominalValue` (current, from the Catalyst file each run), `issuedNominal`, currency, maturity, coupon |
| `IssuerProfiles` | issuer name + record type | profile (industry, business summary, website); AI analyses (`#ANALYSIS#<ts>`, `#LATEST_ANALYSIS`, with the agent's figures); identity (`#IDENTITY`: entityId, financialsEntityId, KRS, LEI, legal name, country, register, category, LEI status, evidence, status) |
| `IssuerFinancials` | `entityId` (KRS or `LEI:<lei>`) + `period` (`<period end>#single\|group`) | one fiscal year from a filed report (below) |
| Filings bucket | `filings/<entityId>/<period end>-<scope>-<hash>.<ext>` | the original files; the dev bucket's `tmp/` for uploads |

An `IssuerFinancials` row holds:
- `issuerName`, `companyName`, `scope`, `periodStart`, `periodEnd`, `months`;
- `currency` (figures are in units of it), `standard`, `presentedUnit`, `lineSigns` (printed / tagged);
- `figures` (each `{ value, source[] }`), `lines`, `items` (item totals, `debtDueWithinYear` included);
- `review` (parsed / hand-checked / flagged), `column` (current / previous), `reportPeriodEnd`;
- `filing` (S3 key, sha256, format, schema, checks, notes, extraction), `importedAt`.

The API (`getIssuerProfiles`) builds each issuer's card on every request:
1. identity → the reports of its financials entity;
2. `filedYears`: group accounts if any, else single; full years; the newest 5; in PLN millions; the
   lender extras;
3. `computeScorecard(years, ruleSet)`;
4. the Refinancing dimension;
5. confidence.

Nothing derived is stored, so a rule change reaches every card at once.

## 16. Known issuers, exceptions and open data issues

Check here before treating a strange result as the company's problem.

| Issuer | Case | Handling |
|---|---|---|
| Orlen S.A. / PKN Orlen S.A. | two bond names, one company (old name); FY2024 ESEF swapped the operating profit tag with the share of associates | one identity, one card; EBIT from the calculation tree |
| Best S.A. / Kredyt Inkaso | Kredyt Inkaso merged into Best (KRS, 1 April 2025); Best took over its bonds | one company; Kredyt Inkaso shows Best's figures |
| Best funds | Best Capital FIZAN and others merged into Best Niestandaryzowany FIZ Wierzytelności (30 January 2025) | one LEI, confirmed; no report imported, so no card |
| Pepco | bonds by PEU (FIN) PLC, guaranteed by Pepco Group N.V.; year ends 30 September; English PDF; UK-style balance sheet | the group's figures under its LEI |
| Pepco FY2024 | the original report (ESEF on filings.xbrl.org, LEI 213800OVMJPFP79OB449) includes Poundland, sold since; FY2025 restates FY2024 without it (revenue 4,160 vs 6,167m EUR, EBIT 323 vs −445); that package leaves right-of-use depreciation (365m EUR) untagged | not imported (owner's choice, 2026-11-05); two years until FY2026 |
| Gmina Słupsk / Redzikowo, Santander / Erste | renames | one company |
| AB S.A. | IT distributor classified Retail; year ends 30 September | general rules override |
| KGHM | no operating profit line (the derived EBIT includes 2.9bn PLN from the Sierra Gorda JV); two intangible lines; only a PDF on its site | derived EBIT, noted; both intangible lines |
| Polenergia | no operating profit line; English report with Polish numbers | derived EBIT; per-report number format |
| Cyfrowy Polsat | depreciation line includes impairment, and a 2,717m PLN goodwill write-down; part of its bonds not on Catalyst | impairment off depreciation, added back to EBIT; listed vs balance-sheet bonds noted |
| PGE, Allegro, Pepco, MOL | depreciation line includes impairment | write-downs not added back twice |
| P4 | one "financial liabilities" line for loans and bonds; FY2023 column restated | debt with no bond split |
| Kruk | financial company: no revenue total, balance sheet in order of liquidity | operating income total as revenue; debt lines under total liabilities; collector rules, liquidity n/a |
| Cognor | several amortisation lines; current liabilities total printed under its lines | all count; section total handled |
| Dekpol | consolidated statements only as a .7z archive | unpacked by hand |
| Erbud | bare ESEF report, no package | filer debt lines by name |
| MOL | Hungarian PDF, foreign issuer; the FY2024 statements are in the integrated report (pp. 51–55, HUF million, costs positive); `ifrs-consolidated-fs-eng-esef.pdf` is the auditor's report only | Hungarian headings; under its LEI; read by hand |
| Allegro.eu, Żabka Group | Luxembourg; FY2024 ESEF inside the reporting packages on their sites | under the LEI; imported |
| Echo Investment | developer with investment property; EUR bonds | investment property in the stock; NBP rates |
| WB Electronics | no LEI | no identity |
| Ronson Development SE | the KRS file is a signed PDF named "…_draft.pdf" (the text is the final audited version); no KRS line in the text; land shown as non-current; all shares pledged for the parent's bonds | read by hand with `--krs`; the land counts as inventory; red flag |
| art.Locum S.A. | IFRS group statements as signed PDFs in the KRS, in złoty | read by hand |
| BBI Development | works through joint ventures (174m PLN equity-accounted, 3.4m inventory): net debt / stock 21× | the rule doesn't fit; a holding view is planned |
| Vehis Finanse | KRS XML (`JednostkaInnaWTys`, 2025 envelope); funded by securitisation, 2,395m PLN in FY2025 (85% of debt), 3% equity; FY2024 revenue 118.1m in its own report, 78.8m restated | securitisation in debt (`debtSecuritisation`), noted; the newer report's FY2024 |
| Vindexus FY2024 | the KRS group entry holds the untagged single statement; the group ESEF package is `Raport_roczny_2024.zip` on gpm-vindexus.pl (bonds tagged: debt 114.6m) | imported from the site; keeps its own report (FY2025's tagging gives 2.4m for 2024) |
| Vindexus FY2025 | bonds in "other financial liabilities" (72.4m + 28.2m) next to loan lines | counted as bonds for a lender with listed bonds and no bonds line (debt 102.8m), noted. Only for lenders: Atal's other financial liabilities (443m) are something else |
| Indos | the KRS holds only a Symfonia settings file for FY2025; the report is on indos.pl under `/api/` (disallowed); FY2025 restates 2024 net profit to −19k PLN from 3.93m | owner downloaded the PDF, read by hand; red flag |
| Grupa Corpus Iuris | net profit (29.8m) above revenue (22.4m): portfolio gains below EBIT | collector rules; note; pre-tax interest cover |
| Internetowy Fundusz Leasingowy | single company only; no short-term debt (debt due 0) | leasing rules |
| Kruk KRU0228, Resi Capital RES0228 | instalment redemptions | amount owed from the current nominal, the remainder at maturity |
| IZ0831, IZ0836 | inflation-indexed nominal | nominal from the Catalyst file; formula in step 1 |

**Open data issues** (known, not fixed):

- Pepco ESEF: right-of-use depreciation untagged (if FY2024 is ever imported).
- PragmaGO's FY2025 PDF is collected but not imported, so its card is on FY2024.
- Best FIZ: no report collected.
- Debt due within 12 months reads 0 for a few PDF and older KRS years whose layout isn't recognised
  (Corpus Iuris and Indos FY2023, some operating-company PDFs). Only lenders use it, and their latest
  years are right.
- KRS XML can't separate debt to related parties (left out of debt).
- Interest expense is total finance costs for most ESEF filers.

**State on 2026-11-05 (prod):**
- **Coverage:** 34 operating issuers scored from reports (30 with 3 or more years; Pepco has two by
  choice), 11 from AI-collected figures, 29 in scope with no scorecard, and 12 lenders scored from their
  reports.
- **Lenders' signals** (Debt Burden, Debt Service, Liquidity, Profitability, Asset Coverage, Trend,
  Refinancing): Kruk GG.GGRR; Best and Kredyt Inkaso Gy.yGRR; Vindexus GGGyGRR; Corpus Iuris GGGGGRG;
  Indos GyGyyRy; IFL GGGGGGG; PragmaGO GyRyG.R; AOW GyRRGRR; Vehis RRyRRyR; MCI G.R.GyG.
- **Trend red:** Atal, Archicom, Benefit Systems, Cavatina, Cognor, Echo, Lokum, Marvipol, PCC Exol, PCC
  Rokita, Polenergia.
- **Refinancing red** for Atal (130m PLN due in 12 months, 146m cash, operating cash flow −657m).

## 17. Worked example

**Vehis Finanse, FY2025** (leasing and factoring rules), from its KRS XML filing (single accounts, PLN
million):

| Input | Value | From |
|---|---|---|
| Total assets | 3,200.7 | "Aktywa razem" |
| Equity | 95.1 | "Kapitał (fundusz) własny" |
| Debt lines: bonds 243.8 + 39.8, bank loans 32.2 + 120.1, other 0.9 | 436.9 | the debt lines (the figure) |
| Securitisation 1,850.2 + 545.0 | 2,395.2 | "zobowiązania z tytułu sekurytyzacji" (`debtSecuritisation`) |
| Financial debt for the scorecard | 2,832.1 | 436.9 + 2,395.2 |
| Debt due within 12 months | 705.8 | debt lines under "Zobowiązania krótkoterminowe" |
| Cash | 111.8 | |
| Profit before tax / interest expense / net profit | 13.8 / 113.4 / 11.0 | income statement |

| Dimension | Metric | Value | Signal |
|---|---|---|---|
| Debt Burden | Net debt / equity = (2,832.1 − 111.8) / 95.1 | 28.6× | red (> 6.0) |
| Debt Service | (13.8 + 113.4) / 113.4 | 1.12× | red (< 1.2) |
| Liquidity | 111.8 / 705.8 | 0.16× | yellow (≥ 0.1) |
| Profitability | ROE 15.2% (green); ROA 11.0 / 3,200.7 = 0.3% (red) | | red (the worse) |
| Asset Coverage | Equity ratio 95.1 / 3,200.7 | 3.0% | red (< 10%) |
| Trend | revenue CAGR 76.9% (green), EBITDA margin slope up (green), net debt / EBITDA slope up (red) | | yellow |
| Refinancing | listed bonds: 28m due in 12 months (cash cover 3.99×), 105m in 24 months against cash + 2 × OCF (OCF −1,379.5) | −25× | red |

The judgement, as an agent would write it: a fast-growing lessor with 3% equity, funded 85% by
securitisation that ranks ahead of the bonds. Pre-tax profit covers interest 1.12 times. Cash covers the
listed bonds due within a year, but growth consumes operating cash, so repaying the 2026–27 bonds depends
on new funding. Watch: the FY2026 report, the securitisation terms, new bond issues.

## 18. Not covered yet

In the order the roadmap would take them:

1. **More reports:** PragmaGO FY2025 (collected); Best FIZ; the 29 in-scope issuers with no scorecard;
   FY2025 reports for the 11 scored from AI-collected figures.
2. **From the notes, by a model (or by hand), with quotes checked in code:**
   - the debt maturity schedule, loans included;
   - covenants, collateral, guarantees and ranking;
   - the auditor's opinion;
   - related-party transactions, one-offs and late filing;
   - a short narrative with citations.

   The answer goes through a fixed-schema tool, and every quoted number must appear in the source.
3. **Lenders, next:**
   - for collectors: cash collections, cash EBITDA, net debt / cash EBITDA, ERC (estimated remaining
     collections), portfolio purchases vs collections;
   - for leasing and factoring: cost of risk and the non-performing share;
   - thresholds from each issuer's bond covenants (net debt / equity caps).
4. **Developers:** escrow accounts and pre-sales from the notes, the land bank. **Contractors:** the
   order backlog.
5. **Undrawn credit lines** and bank loans due, in Refinancing. **Repayment track record** (step 8,
   "Repayment track record"): from the app's records first, then GPW's exit reasons going forward and
   back to 2018 or earlier, confirmed by the issuers' reports.
6. **Instalments and amounts in circulation:** the dates of later instalments (from the terms of issue);
   re-reading the amount in circulation for taps and buy-backs.
7. **Trailing 12 months** from half-year and quarterly reports.
8. **Calibration** on past Catalyst defaults (GetBack 2018 and others) and Polish bankruptcy models (started, on hold: [catalyst-default-calibration.md](catalyst-default-calibration.md)). The
   sample is small, so this is calibration, not machine learning.
9. **Holding-company flag** (structural subordination), and a holding view for developers working
   through joint ventures (BBI).
10. **With market data:** a risk vs yield chart, mismatch alerts, risk band filters, an issuer page, peer
    ranking.
11. **Monitoring:** re-runs on new reports; alerts (late report, auditor change, covenant breach, a
    dimension changing colour); a watchlist from holdings.

## 19. Where things are, and how to run them

| What | Where |
|---|---|
| Scorecard rules, rule sets, overrides, finance map | `packages/core/src/bonds/fundamentals/scorecard.ts` |
| Scope (AI analysis) | `packages/core/src/bonds/fundamentals/scope.ts` |
| Refinancing, amount owed | `packages/core/src/bonds/fundamentals/maturities.ts`; NBP rates `packages/core/src/bonds/fx/nbp.ts` |
| Data confidence | `packages/core/src/bonds/fundamentals/confidence.ts` |
| Report parsers | `packages/core/src/bonds/fundamentals/filings/`: `FilingParser.ts` (KRS XML), `EsefParser.ts`, `IfrsTextParser.ts`, `AiPdfExtractor.ts` |
| Statement lines, items, write-downs, finance lines, debt due within a year | `filings/statementLines.ts`; the scorecard's years (lender extras included) `filings/filedYears.ts` |
| Financials rows, most-recent-report rule | `packages/core/src/storage/issuerFinancials/` |
| Identity | `packages/core/src/bonds/issuers/identity.ts`, `scripts/resolve-issuers/` |
| Classification and AI analysis | `packages/core/src/ai/issuers/IssuerClassification.ts`, `IssuerAnalysis.ts`; tools in `packages/core/src/ai/tools/` |
| Assembling a card (scorecard, refinancing, confidence) | `packages/functions/src/issuers/getIssuerProfiles.ts` |
| Card and views | `packages/web/src/components/BondReportsBrowser/issuers/` (`IssuerCard.tsx`, `IssuerScorecard.tsx`, `IssuerMaturities`) |
| Scripts | `scripts/import-filing/`, `scripts/check-filings/` (known answers), `scripts/reparse-filings/`, `scripts/item-totals/`, `scripts/sort-filings/` |
| Commands in detail | `docs/development.md`, "Importing filed statements" |
| Design records | `docs/superpowers/specs/`: `2026-05-11-fundamental-analysis-design.md` (v1 framework), `2026-10-29-fundamental-analysis-v2-roadmap.md` (audit, roadmap, progress), `2026-11-02-statement-lines-design.md`, `2026-11-03-issuer-identity-design.md`, `2026-11-03-bond-maturities-vs-cash-design.md`, `2026-11-03-sector-rules-design.md`, `2026-11-03-data-confidence-design.md`, `2026-11-05-finance-rules-design.md` |

**Runbook: one report, from download to card**

```sh
npm run sort-filings -- <download folder> --copy                                  # identify and file the downloads
npm run import-filing -- --dry-run <file>                                          # parse only: check the figures
npx sst shell --stage prod -- npm run import-filing -- <file> [--issuer "<name>"] [--krs <n> | --lei <code>]
npx sst shell --stage prod -- npm run import-filing -- <pdf> --print-prompt pages.txt          # PDF read by hand: pages out
npx sst shell --stage prod -- npm run import-filing -- <pdf> --transcript t.json --transcript-by "<who>"
npx sst shell --stage prod -- npm run check-filings [-- --only "<issuer>"]         # after parser changes
npx sst shell --stage <stage> -- npm run item-totals [-- --write]                  # recompute item totals (dry run first)
npx sst shell --stage prod -- npm run resolve-issuers [-- --write]                 # identities for new names
```

Then add the report's hand-read figures to `expected.json`, update the checklist, and record any
exception in section 16.

**Rules for working on prod data:** reading is fine. Writing figures, items or identities is a data
change: dry run first, dev second, and the owner's approval before prod. Tests never run against prod.

### Keeping this document current

Update it with every change to the rules, sources or data model, and with every new exception: it is the
single description an agent starts from. The design records stay as the history of why.

## 20. Glossary (Polish terms)

| Polish | English | Where it matters |
|---|---|---|
| sprawozdanie finansowe (jednostkowe / skonsolidowane) | financial statements (single / consolidated) | which report; scope |
| raport roczny, RR / SRR | annual report, single / consolidated (Bankier titles) | finding reports |
| bilans; aktywa, pasywa | balance sheet; assets, equity and liabilities | |
| rachunek zysków i strat (RZiS) | income statement | |
| rachunek przepływów pieniężnych | cash flow statement | |
| przychody ze sprzedaży | sales revenue | revenue |
| zysk z działalności operacyjnej, wynik operacyjny | operating profit | EBIT |
| zysk brutto | profit before tax | lenders' interest cover |
| przychody / koszty finansowe | finance income / costs | interest; derived EBIT |
| amortyzacja | depreciation and amortisation | EBITDA |
| odpis aktualizujący, utrata wartości | write-down, impairment | `impairment` |
| kapitał (fundusz) własny | equity | |
| zobowiązania długo- / krótkoterminowe | non-current / current liabilities | debt due within a year |
| kredyty i pożyczki | bank loans and borrowings | `debtBankLoans` |
| z tytułu emisji dłużnych papierów wartościowych, obligacje | bonds issued | `debtBonds` |
| zobowiązania z tytułu leasingu | lease liabilities | `debtLeases` |
| zobowiązania z tytułu sekurytyzacji | securitisation liabilities | `debtSecuritisation` |
| pozostałe zobowiązania finansowe | other financial liabilities | `otherFinancialLiabilities` |
| zaliczki otrzymane, zobowiązania z tytułu umów | advances received, contract liabilities | contractors, developers |
| zapasy | inventory | developers' land and flats |
| nieruchomości inwestycyjne | investment property | developers |
| środki pieniężne i ich ekwiwalenty | cash and cash equivalents | |
| nabyte wierzytelności | purchased debt portfolios | collectors |
| razem / ogółem / suma | total | section totals |
| wartość emisji w obrocie | amount in circulation | bond amount |
| dzień ustalenia prawa (do odsetek) | record day | coupons |
| istotna niepewność dotycząca kontynuacji działalności | material uncertainty related to going concern | red flag |
| KRS, NIP, REGON | court register number, tax id, statistical id | identity |
| ESPI / EBI | GPW current and periodic report systems (shares / bonds) | sources |
| Repozytorium Dokumentów Finansowych (RDF) | KRS financial documents repository | sources |
