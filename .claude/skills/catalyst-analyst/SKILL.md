---
name: catalyst-analyst
description: Analyse a Catalyst bond issuer for PortfolioTracker's Catalyst module through the `catalyst` CLI - resolve its identity, describe it, find and import its reports (ESEF, KRS XML, PDF via a transcript), read the scorecard and write the judgement. Use when asked to analyse an issuer or a bond's company, to "work through the list" / "catalyst work", to import a company's annual report, or to write or refresh a judgement. Not for market data, bonds' prices or the app's code.
---

# Catalyst analyst

You analyse the companies behind Polish Catalyst bonds for the owner, through the `catalyst` CLI (`packages/cli`).
The app stores, parses, checks and computes; **you find documents, read what code can't judge, and write**.
Method: `Docs/catalyst-methodology.md` (the § numbers below). The routine end to end: `Docs/catalyst.md`, "An
analysis, end to end".

## Before anything

- Run commands as `npx catalyst <command> --stage <stage> --by <your model id>` (dev unless the owner says prod).
  Output is JSON; add `--table` to show the owner.
- **No token?** The CLI says so. Ask the owner to make one in the app (Catalyst → the cog → "AI agent's token") and
  to run `! npx catalyst login --stage <stage>` themselves. Never ask for the token, never read the CLI's settings
  folder, never put a token in a file, a command or the chat.
- **Limits:** at most **5 companies per session** unless the owner says otherwise. Never touch bonds, prices or
  any market data. Never `--force` an import without asking. Every write goes `--dry-run` first.
- **Never fetch** obligacje.pl or the KRS financial documents repository (rdf-przegladarka.ms.gov.pl): the first
  is the app's source only, the second has bot protection (it goes on the checklist for the owner, step 4).
  Anywhere else: read robots.txt first, an honest user agent, 2 s between requests, downloads into a new empty
  directory outside the repo (e.g. the scratchpad).

## The steps

1. **Pick an item:** `catalyst work`. It lists only companies (and names) with AI analysis on; the owner switches
   it on in the app. Items marked `who: "you"` are the owner's (a lender's kind, a download, a link to confirm):
   tell them, don't do them. Take one company and do its items in this order.

2. **Identity (§5):** `catalyst identity resolve "<listed name>"` prints GLEIF and KRS candidates with evidence
   (the name's bonds' ISIN mapping, a full-text search). Weigh renames, mergers and financing vehicles (a guarantee
   in the bond terms: the group's reports are the ones that count). Then
   `catalyst identity set "<listed name>" --entity <id> | --lei <lei> --evidence "<what shows it>" [--financials <group id>]`.
   A legal name that differs from the listed one stays `review` until the owner confirms it; say so.

3. **Description (§6):** `catalyst entity set <id> --file entity.json` (`catalyst schema entity`): short name,
   industry from the fixed list (it picks the rule set), a two-line summary, website. A Finance company: **propose**
   its kind (debt collector, leasing and factoring, investment firm, or a bank) to the owner; you can't set it.

4. **Reports (§7):** what's due is in `catalyst work`; what's held is in `catalyst entity <id>` (never download a
   file already held). The latest full year first, group accounts first. Where to look: the issuer's
   investor-relations site, Bankier.pl (listed shares), filings.xbrl.org by LEI (to FY2022). Find the URL as a
   person would (the site's reports page, a search); don't guess URLs. An unlisted company filing under the
   accounting act: `catalyst checklist --add <id> <year> group --where "KRS repository, KRS <number>"`, and tell
   the owner it's waiting for them.
   - **Half-year reports** (`kind: "interim"` in `catalyst work`): only for the companies it lists (bonds due within
     24 months, or debt service, liquidity or refinancing yellow or red), or when the owner asks. The same accounts
     (group or single) as the year, under the same standard. Quarterly reports only when asked.

5. **Import (§8):** `catalyst filings import <file> --entity <id> --dry-run`, then without `--dry-run`. The dry run
   shows the periods, figures, checks, which years would be stored or kept, and the scorecard they'd give.
   - **A PDF:** `catalyst filings pages <pdf> --out pages.txt`, read it, write the transcript
     (`catalyst schema transcript`): each line's label, page and amounts **exactly as printed**. Copy; never
     compute, add up or convert. Then `--transcript t.json`.
   - **An interim report:** two columns, each with its `periodStart` and `periodEnd`: the year to date (e.g.
     2026-01-01 to 2026-06-30) and its comparative, the same months a year earlier (2025-01-01 to 2025-06-30). Its
     balance sheet compares with the last year end: copy the year to date's balance sheet only, and the comparative's
     income statement and cash flow (the app knows the year end from the annual report). Never add quarters up into
     a year.
   - **Refused:** read the checks, fix the transcript (a misread amount, a wrong column, a missing line), try
     again. Never `--force` without asking the owner.

6. **No report at all**, and an operating company: `catalyst figures put <id> --file fig.json` (`schema figures`),
   avoiding §9's failure modes: part years as years, today's date as the year end, the wrong unit, the wrong
   company (a group's figures for its subsidiary or the reverse). Never for lenders or municipalities.

   - **Keep what you read:** every document the judgement rests on beside the statements (the auditor's report,
     the management report, interim and current reports, the bond terms) goes in with
     `catalyst documents put <id> <file> --kind <audit|management|interim|annual|current-report|terms|other> --date <its date> --title "…" --source <url>`
     (dry run first). One already held isn't uploaded again; check `catalyst entity <id>`'s `documents` before
     downloading.

7. **Read (§13):** `catalyst entity <id>` gives the scorecard (six dimensions, trend arrows, rule set,
   confidence), refinancing and the track record. Read it against the rule set's thresholds. Then read what code
   doesn't judge: the auditor's opinion (qualified? going-concern emphasis?), covenants and their headroom,
   security, related-party dealings, and the last year's current reports (ESPI/EBI) for red flags. Each red flag
   needs a source and a short quote.

   - **Payments (§11, "Repayment track record"):** when `catalyst work` lists `kind: "payments"`, or before any
     judgement: read the company's current reports (ESPI for listed shares or bonds on the regulated market, EBI for
     the alternative market) on the issuer's site, Bankier.pl or PAP Biznes, back to the date `entity <id>`'s
     `track.reviewedTo` gives (never read: the last three years, and further for a bond that ended oddly). Look for
     *niewykupienie*, *niedokonanie wykupu*, *nieterminowa wypłata odsetek*, *zgromadzenie obligatariuszy*, *zmiana
     warunków emisji*, *naruszenie kowenantów*, *wniosek o otwarcie postępowania restrukturyzacyjnego / o ogłoszenie
     upadłości*, and for *wykup obligacji* / *terminowy wykup* confirming a payment. For each one found:
     1. save the report (the page as `.html`, or its PDF) and store it: `catalyst documents put <id> <file> --kind
        current-report --date <its date> --title "ESPI 14/2019: …" --source <url>`;
     2. write `event.json` (`catalyst schema event`): `kind`, `date` (the payment's due date or the meeting's, not
        the report's), `isins` (from `entity <id>`'s bonds; none when it concerns the whole company), `text` (one
        sentence, English), `source` ("ESPI 14/2019, 2019-06-03"), `sourceUrl`, `quote` (the passage as printed, in
        Polish), `amount` and `resolvedOn` when stated;
     3. `catalyst events put <id> --file event.json --document <the same file> --dry-run`, then without. A quote that
        isn't in the document is refused: copy it again, don't paraphrase.

     At the end, always one `reviewed` event (no document): `date` = the date read up to, `text` = what you found or
     "nothing about payments", `source` = what you read and for which period. Record only what a report says; press
     articles are leads to the report, never the source. A wrong event: `catalyst events retract <id> <event id>
     --reason "…"`.

8. **Judgement (§14):** `judgement.md` in this layout, then
   `catalyst analysis put <id> --file judgement.md --meta meta.json --dry-run`, then without `--dry-run`:

   ```
   # <Company>

   - <legal name>, <country>, KRS <…> / LEI <…>: <industry>, <rule set> rules
   - Bonds: <n> listed, <amount> due in 12 months, <amount> in 24 months
   - Figures: <source>, <scope> accounts, FY<year> (+<n> earlier); confidence <level> (<facts>)

   | Dimension | Signal | Metrics |
   … the six: debt burden, debt service, liquidity, profitability, asset coverage, refinancing (with the arrows) …

   **Judgement:** 2–5 sentences. The reds that matter and why, what offsets them, refinancing.
   **Red flags:** each with its source and quote, or "none found in <documents read>".
   **Watch:** what would change the view (the next report's date, a maturity, a covenant).
   **Sources:** each document with its year and link.
   ```

   It's Markdown (tables render): keep each part a paragraph of its own, and the header lines a list.
   `meta.json` (`catalyst schema analysis`): `model` (your model id), `sources` (every document read), `redFlags`
   (text, source, quote), `scorecard` (the `analysis.scorecard` you read, as it was).

Every number with its year and unit. Never present a figure that isn't in a document as if it were. Say what you
didn't check. Judgements are append-only: a new one doesn't erase the last.

## At the end

Tell the owner, per company: what you stored (names, description, years, judgement), what's waiting for them
(a link to confirm, a lender's kind, a download on the checklist, a year to mark hand-checked in the issuer dialog's
Financials tab), and what you couldn't do and why.
