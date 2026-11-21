# Catalyst: testing the rules on past defaults

**Status: resumed on prod on 2026-11-21** (section "On prod", below). Started 2026-11-09 on dev to answer: *do the
scorecard's rules flag issuers that later failed to pay, and can those cases calibrate the thresholds?* (methodology
§18 item 8), on hold from 2026-11-10. The sections up to "Sources used" describe the dev run; prod was redone from the
issuers' own documents and now holds more than dev.

## The question and the method

1. **Pick issuers that defaulted or are in trouble now.** Six were chosen with the owner: Ghelamco Invest, Kemberton,
   GetBack (now Capitea), ZM Henryk Kania, Kancelaria Medius and Gant Development.
2. **Import the last annual report published before the default**, and the year before it, through the normal agent
   route (`catalyst filings import` with a PDF transcript, dry run first).
3. **Record what the issuer's own current reports say** about payments as payment events (`catalyst events put`,
   built for this in v0.241; see Docs/catalyst.md, "Payment events").
4. **Read the scorecard one and two years before the default.** Then compare how often the same reds appear among the
   43 issuers scored as survivors. With about ten defaults this gives a hit-rate table, not default probabilities.

**Rule for a fair test:** use figures as they were published *before* the default, not restated or preliminary figures
published after it.

## Where each issuer stands (dev)

| Issuer | Company id | Stored on dev | Not done |
|---|---|---|---|
| Ghelamco Invest | `0000185773` | Linked as a financing vehicle to its guarantor **Granbero Holdings Limited** (`LEI:259400N6KJN8H4A5L316`). Granbero's consolidated FY2025, FY2024 and H1 2026 (with comparative H1 2025) imported. Events: ESPI 6/2026 *paid* (PZ1–PZ3, 240m zł, 2026-02-03), ESPI 30/2026 *covenant breach* (H1 report late, 2026-09-30). Documents: ESPI 6, 30, 34/2026 | `reviewed` event; ESPI 34/2026 (shareholders' resolution to continue, loss above half the capital, art. 233 KSH) stored but not recorded as an event; FY2025 equity restated in H1 (617m → 608m EUR) |
| Kemberton | `0000690847` | Linked to the same guarantor (Granbero). Event: ESPI 29/2026 *waiver* (K1 majority holders: the 5m EUR from outside the group not paid by 2026-09-30 doesn't count as a breach, on conditions). Document: ESPI 29/2026 | `reviewed` event; ESPI 4/2026 (K1 listing date moved) downloaded, not stored |
| GetBack / Capitea | `0000413997` | FY2017 and FY2016 from the **preliminary unaudited** FY2017 consolidated statements (published 2018-05-30, after the April 2018 default; PAP media room) | **Lender kind not set:** it scores on general rules; the owner sets "debt collector". The FY2016 report *as published in 2017* (the fair test). Events (missed payments 2018) |
| ZM Henryk Kania | `0000053415` | Events: ESPI 7/2019 *bondholders' meeting* (series F, to move maturity), ESPI 18/2020 *insolvency* (bankruptcy, sale to Cedrob 100m zł). Documents: both reports (Bankier) | Financial years: FY2018 standalone (auditor **refused an opinion**: PKF Consult) and FY2017. Event: series F not redeemed 2019-06-24, series F and H interest unpaid (the report itself not found yet) |
| Kancelaria Medius | `0000397680` | Events: EBI 14/2020 *insolvency* (arrangement filed 2020-05-11: "would not be able to pay its bonds on time"), EBI 15/2020 *insolvency* (opened 2020-05-29). Documents: both, from kancelaria-medius.pl | **FY2018 consolidated report is on the owner's checklist** (KRS repository): the issuer's site and NewConnect list it without the file. EBI 24/2019 (series M and O maturities extended by 12 months) downloaded, not recorded: the page shows no date |
| Gant Development | none | Nothing stored: Gant defaulted in 2013, before the app's 2020 archive, so it isn't a company in the app | Read by hand only (below). Making it a company and importing 2012 and 2011 |

Other things changed on dev on the way:
- **Granbero Holdings Limited** was made a company through a name of that name (not a listed name), the only way the
  agent can create a company from an LEI. It has no industry: scored on its own it uses the general rules.
- The names "Ghelamco Invest Sp. z o.o." and "Kemberton Sp. z o.o." now point at Granbero for their financials; their
  status went from `confirmed` to `resolved` (the agent's link). The same happened on prod (finding 11).

## What the rules said before each default

| Issuer | Figures | Reds | Greens | Reading |
|---|---|---|---|---|
| Ghelamco Invest | FY2025 (published April 2026), developer rules | debt burden, debt service, liquidity, profitability, refinancing (cash cover 0.19×) | asset coverage (equity ratio 51%) | Flagged months before the KNF suspension (2026-10-02) and the covenant breach. With H1 2026: all red but asset coverage (yellow, 34.9%); cash covers 0.12× of bonds due in 12 months |
| Kemberton | Granbero's figures (as Ghelamco) | four | its own bond is due 2031, so refinancing is green | Group figures say what the issuer's own wouldn't |
| GetBack | FY2016, collector rules applied by hand (the app used general rules) | liquidity (cash / debt due in 12 months **0.17**), asset coverage (equity ratio **23.7%**) | debt service (pre-tax ICR 5.3×), profitability (ROE 52%) | Flagged a year ahead, but not on debt service, which §13 calls the most important. Net debt / equity 2.08 (yellow). Bonds raised 693m zł vs 144m redeemed in 2016, operating cash flow −276m zł against a 200m zł profit: the "GetBack pattern" of §13 |
| GetBack | FY2017 (preliminary, after the default) | everything but liquidity (yellow) | – | Too late to count: published after the default |
| Gant | 2012 column of the FY2013 consolidated report, developer rules, **by hand** | net debt / equity 2.28, net debt / (inventory + investment property) 0.64, current ratio 1.29, equity ratio 24.8%, EBIT margin −71% | – | Every metric red in the year it defaulted. The 2012 column may be restated in the 2013 report and its liability lines are hard to align in the PDF text: check against the FY2012 report itself |
| Kania | – | – | – | No figures yet. The press reports a 64m zł profit for 2018 with the auditor refusing an opinion: if the ratios look fine, the auditor rule is the signal, not the thresholds |
| Medius | – | – | – | No figures yet |

## Findings so far

1. **Fixed (v0.242):** a loss over negative revenue gave a positive, green margin (GetBack 2017: EBIT margin 388.9%).
   Negative revenue now gives no margin, and a loss counts as red.
2. **Debt burden for developers ignores assets held for sale.** Ghelamco's 294m EUR of property held for sale is left
   out of "inventory + investment property", which overstates that red. A candidate rule change.
3. **Events before the default** are visible in the reports: extended maturities (Medius, 12 months before its
   arrangement), a bondholders' meeting to move a maturity (Kania), a late half-year report as a covenant breach
   (Ghelamco). They argue for `terms-changed` and `covenant-breach` events weighing heavily in the judgement.
4. **A shareholders' resolution on continued existence** (art. 233 KSH: loss above half the capital, Ghelamco ESPI
   34/2026) has no event kind. Candidate: record it as `insolvency` or add a kind.
5. **Profit-based metrics can stay green** a year before a lender's default (GetBack). Liquidity and equity were the
   reds. That matches §13's warning on collectors' revaluation-based profits.

## Sources used

- Ghelamco Invest and Kemberton: the group's investor-relations pages on ghelamco.com (robots.txt allows all):
  `/pl/investor-relations/poland/raporty-biezace/2026/`, `/poland/raporty-okresowe/`, `/poland-kemberton/raporty-biezace/`.
  Granbero FY2025: `/site/assets/files/27892/consolidated_financial_statements_granbero_31_12_25_-_final.pdf`;
  H1 2026: `/site/assets/files/28071/granbero_hy_30062026.pdf`.
- GetBack: `pap-mediaroom.pl/sites/default/files/attachments/201805/DOC.20180530.30503394.Wstepne_niezaudytowane_SSF_Y2017_.pdf`.
  getbacksa.pl doesn't answer.
- ZM Henryk Kania: Bankier.pl ESPI pages (robots.txt allows `/wiadomosc/`).
- Kancelaria Medius: kancelaria-medius.pl (robots.txt allows; the report pages are listed in
  `/wp-sitemap-posts-raporty-1.xml`). Its year filter (`/raporty/2019`) is script-driven and answers 404.
- Gant: money.pl's copy of the FY2013 consolidated statements (`static1.money.pl/d/gielda/raporty/2013/8937_…pdf`).
  Bankier's copy of FY2012 answers 404.
- Not usable: stockwatch.pl (refuses automated clients), biznes.pap.pl (bot protection), obligacje.pl (never).

The downloads and transcripts were in the session's scratchpad and are gone. The imported originals and their lines
are stored on dev: `catalyst entity <id>` lists them.

## On prod (2026-11-21)

The owner moved the study to prod (no dev agent token on the machine). Everything below was written by the agent
through the CLI (`--stage prod`, dry run first, except one: the GetBack auditor's report went up through
`documents put` without a dry run), from documents stored with `catalyst documents put`.

| Issuer | Company id | Stored on prod | Not done |
|---|---|---|---|
| Granbero Holdings Limited | `LEI:259400N6KJN8H4A5L316` | Made a company through the name "Granbero Holdings Limited"; industry Developer. Consolidated FY2025 (+FY2024) and H1 2026 (+H1 2025), PDF transcripts, all checks passed | – |
| Ghelamco Invest | `0000185773` | Name linked to Granbero for its financials (evidence: FY2025 statements p.63, "The bonds are secured by a redemption surety granted by Granbero Holdings Ltd."): the owner's `confirmed` became the agent's `resolved`. Events: ESPI 6/2026 *paid* (PZ1–PZ3), ESPI 30/2026 two *covenant breaches* (H1 report late; Groen Lawendowa proceeds used against the terms, not disclosed promptly), *reviewed* to 2026-11-21. Documents: ESPI 6, 30, 31, 32, 34/2026 | Bond terms of the 7 listed issues (judgement gap); no judgement |
| Kemberton | `0000690847` | Name linked to Granbero, as Ghelamco. Events: ESPI 26/2026 *covenant breach* (5m EUR from outside the group not paid by 2026-09-30), 29/2026 *waiver* (on Ghelamco Group NV's 50m EUR support), 32/2026 *waiver* (consent to sell Vibe II, proceeds to redeem K1 first), 33/2026 *terms changed* (early-redemption notice cut to 1 day), *reviewed*. Documents: those four | Terms of K1; no judgement |
| Capitea (GetBack) | `0000413997` | Industry Finance (the kind is the owner's). **Consolidated FY2016 (+FY2015) as published 2017-03-30** (capitea.pl archive): the fair test. Auditor's report stored (scanned, not read: no page rendering on the machine). Events: ESPI 51/2018 *missed payment* (88.26m zł nominal and 3.32m zł interest unpaid at 2018-04-25), 60/2018 and 64/2018 *insolvency* (accelerated arrangement filed 2 May, opened 9 May 2018), 51/2019 *terms changed* (arrangement approved), *reviewed* | **Kind "debt collector" (owner)**: until then it is out of scope and unscored |
| ZM Henryk Kania | `0000053415` | Industry Manufacturing. FY2018 and FY2017 **collected figures** (the report's selected data only, from its Bankier page): they don't feed the scorecard. FY2018 single on the **owner's checklist** (Bankier's attachments answer 404). Events: ESPI 7/2019 *bondholders' meeting* (series F, to move the maturity), ESPI 24/2020 *insolvency* (bankruptcy 2020-06-18), *reviewed* | The June 2019 ESPI on series F not redeemed and F/H interest unpaid: only press copies found, so not recorded |
| Kancelaria Medius | `0000397680` | Industry Finance. Events: EBI 18/2020 *missed payment* (series L interest, 2020-04-06), EBI 20, 25, 26/2020 *missed payments* (M, P, O instalments), EBI 23/2020 *bondholders' meeting* (series N, event of default), ESPI 14 and 15/2020 *insolvency* (arrangement filed 11 May, opened 29 May 2020), *reviewed*. One event retracted (ESPI 7/2020 recorded as a missed payment; it is the decision to stop paying). FY2018 and FY2017 group on the **owner's checklist** | Kind (owner); EBI 24/2019 (M and O maturities +12 months: no date on the page); EBI 23/2020 and ESPI 15/2020 dated from their neighbours (the pages show no date) |
| Gant Development | – | Nothing: not a company in the app | As on dev |

### What the rules say (prod)

| Issuer | Figures | Debt burden | Debt service | Liquidity | Profitability | Asset coverage | Refinancing |
|---|---|---|---|---|---|---|---|
| Ghelamco Invest | Granbero FY2025 + H1 2026, developer | red (ND/(inv.+IP) 2.35×) | red (ICR −10.1×) | red (CR 0.90×) | red | yellow (equity ratio 34.9%) | red (cash covers 0.12× of 124m EUR due in 12 months) |
| Kemberton | the same | red | red | red | red | yellow | **green** (its own K1 is due 2031) |
| GetBack | FY2016, **general** rules (dry run; the kind isn't set) | red (D/E 2.35×, ND/EBITDA 3.47×) | green (ICR 5.26×) | **green** (current ratio 2.13×) | green (EBIT margin 55.5%) | yellow (equity ratio 23.7%) | green (no listed bond then) |
| Kania | FY2018 selected data (not scored) | – | – | – | EBIT margin 10.3%, net profit 64.4m zł | equity ratio 30.1% | – |
| Medius | none yet | | | | | | |

**The survivors on prod** (41 scored issuers other than these, 2026-11-21; rule sets: 13 developer, 10 general,
6 consumer, 5 collector, 4 leasing, 3 contractor), how often each colour appears:

| Dimension | red | yellow | green |
|---|---|---|---|
| Debt burden | 6 | 8 | 27 |
| Debt service | 8 | 12 | 21 |
| Liquidity | 8 | 13 | 18 (2 n/a) |
| Profitability | 11 | 10 | 20 |
| Asset coverage | 4 | 9 | 28 |
| Refinancing | 13 | 3 | 25 |

Reds per survivor: none 18, one 11, two 4, three 4, four 2, five 1 (BBI Development), six 1 (Vehis Finanse). Four or
more reds: 4 of 41 (10%): BBI Development, Cavatina Holding, Cognor, Vehis.

### Findings from the prod run

6. **A financing vehicle's refinancing counts only its own bonds.** Kemberton is red on everything Granbero is, but
   green on refinancing because K1 is due in 2031, while the same guarantor has 124m EUR of Ghelamco bonds due within
   12 months at 0.12× cash cover. A candidate rule: a vehicle's refinancing counts every listed bond its guarantor's
   group owes.
7. **The rule set decides GetBack.** On general rules FY2016 shows one red (debt burden); liquidity is green because
   debt portfolios are current assets. On collector rules, applied by hand on dev, liquidity is red (cash / debt due
   in 12 months 0.17). The owner setting the kind is what makes the test fair.
8. **Kania looks fine on what was published** (EBIT margin 10.3%, equity ratio 30.1%, positive operating cash flow
   48.2m zł in FY2018) two months before it missed series F: the auditor's refusal of an opinion is the signal, as
   expected. Collected figures don't reach the scorecard (only imported reports do).
9. **Five reds is rare among survivors** (2 of 41: BBI Development, Vehis), and Ghelamco has them on FY2025 + H1 2026
   (on dev, FY2025 alone, published in April 2026, already gave five reds). Refinancing red alone is common (13 of 41) and weak on its own.
10. **Recording events:** the app treats a second event of the same kind on the same date (and bonds) as a duplicate,
    so two missed payments on one day need distinct bonds (`isins`) or one event. The art. 233 KSH vote (Ghelamco ESPI
    34/2026) still has no kind: stored as a document and named in the `reviewed` text.
11. **Linking a financing vehicle resets the owner's confirmation.** The API works a name's status out again on every
    save from who saves it (`api.ts`, `PUT /catalyst/names/{name}`): the owner's save gives `confirmed`, the agent's
    `resolved` (names agree) or `review`. Adding `--financials` to Ghelamco Invest and Kemberton turned `confirmed` into
    `resolved`; the links are right and the scores don't depend on the label. **The app has no way to confirm a
    name** (Docs/catalyst.md says the owner confirms `review` names, but no screen calls the endpoint), and the agent
    can't (its token only gives `resolved` or `review`). Candidates: a Confirm button for names in the Issuers view;
    keep `confirmed` when the agent only adds a financing link to a confirmed name.

## To resume

1. **Owner (prod):** set Capitea's and Kancelaria Medius's kind to *debt collector*; download from the KRS repository
   (https://rdf-przegladarka.ms.gov.pl, search by KRS number) Kania's FY2018 single report (KRS 0000053415) and
   Medius's FY2018 and FY2017 group reports (KRS 0000397680), all on the checklist. The repository was down on
   2026-11-21. Put the files in one folder; the agent runs `catalyst filings sort` on it and imports them.
2. GetBack: read the scorecard on collector rules once the kind is set; import FY2017 only as a late, after-default
   comparison.
3. Kania: import FY2018 from the checklist (and FY2017); find the June 2019 ESPI on series F (Bankier lists can't be
   read; try GPW's or the company's archive) and record the missed payments.
4. Medius: import FY2018 and FY2017; date and record EBI 24/2019.
5. Ghelamco and Kemberton: read the bond terms and store the schedules before any judgement.
6. Gant: make it a company (LEI or KRS), import FY2012 and FY2011 from the reports as published.
7. **The table** once the reports are in: each defaulter's colours one and two years before, against the survivors
   above; then decide on thresholds and the candidate rule changes (findings 2, 4 and 6), and on the name
   confirmation (finding 11).
8. More defaulters for the sample, from the press lists (PBG, Vivid Games, Braster, Uboat-Line, Religa Development,
   GC Investment, Europejskie Centrum Odszkodowań, Fast Finance).
