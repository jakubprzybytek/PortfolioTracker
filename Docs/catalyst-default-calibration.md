# Catalyst: testing the rules on past defaults (on hold)

**Status: on hold since 2026-11-10.** Started 2026-11-09 to answer: *do the scorecard's rules flag issuers that later
failed to pay, and can those cases calibrate the thresholds?* (methodology §18 item 8). Everything below is on the
**dev** stage only. Prod holds none of it.

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
  status went from `confirmed` to `resolved` (the agent's link). The owner may confirm them again.

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

## To resume

1. **Owner:** set Capitea's kind to *debt collector* on dev; download Medius's FY2018 consolidated report from the
   KRS repository (it's on the checklist).
2. GetBack: the FY2016 report as published in 2017, then the scorecard on collector rules.
3. Kania: FY2018 (and FY2017) annual report; the June 2019 ESPI on series F and H; record the missed payments.
4. Medius: FY2018 from the checklist, FY2017; record EBI 24/2019 once its date is found (NewConnect's archive).
5. Gant: make it a company (LEI or KRS), import FY2012 and FY2011 from the reports as published.
6. A `reviewed` event for each issuer.
7. **The table:** for each defaulter, each dimension's colour one and two years before; for the 43 scored survivors,
   how often the same colours appear. Then decide whether any threshold moves, and the two candidate rule changes
   (findings 2 and 4).
8. More defaulters for the sample, from the press lists (PBG, Vivid Games, Braster, Uboat-Line, Religa Development,
   GC Investment, Europejskie Centrum Odszkodowań, Fast Finance).
