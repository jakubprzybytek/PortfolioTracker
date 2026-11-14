# Catalyst: premium history and the market index (plan)

Status: built and run on dev (2026-11-14): terms of 562 of 574 ended corporate bonds (12 pages without an ISIN); 1 721 curves; 752 bonds with a history; the index on every session, resting on 137–191 bonds (2020: 168 on average). Checks: the history's point equals the screen's premium for all 87 bonds traded on 2026-11-13; Developer above Finance in every year, Developer widening to 5.05 pp at the end of 2022; Ghelamco's traded bonds at 11–16 pp through 2025 against Developer's ~4.2, then 34–39 pp from September 2026 while Developer stayed at ~4 (the issuer, not the market). Near maturity a premium jumps (a discount spread over a few months): the views should say so. On prod 2026-11-14 (v0.266): the same results. Step 2, the views, built 2026-11-14: Premium (and Yield for fixed coupons) next to Price in the bond's panel (catalyst.md, "Row panel"). Step 1 of "Premium history and the Yield / Premium views"; the views themselves (step 2) and a WIBOR/WIRON source (step 3) follow.

**Goal:** for every bond, its premium over the State on each session it traded since 2020, and for each session a market index (the median premium of Catalyst's corporate bonds, overall, per industry, per coupon type), so a bond's move can be told apart from its issuer's, its sector's and the market's.

## What the data says (dev, 2026-11-14)

| | |
|---|---|
| Sessions loaded | 1 721 (2020-01-02 – 2026-11-13) |
| Bonds | 1 772 (932 listed, 840 ended) |
| Corporate PLN, listed | 262: **260 floating**, 2 fixed; all linked to a company with an industry (Developer 134, Finance 93, Energy 10, others ≤ 7) |
| Corporate PLN, ended | 574: **572 without terms** (the terms job reads listed bonds only) |
| Sessions per bond | ~380 on average, ~18 % with trades (sample of 20 listed corporate bonds: 7 671 sessions, 1 380 traded) |

Two consequences:

1. **The premium of a corporate bond is in practice the floating one**: its margin adjusted for its price, less the WZ curve's at the same years (`priceAdjustedMargin`, as the screen). It needs the bond's margin (its terms) and the WZ series' prices that day. No WIBOR history is needed: both sides float on it.
2. **Ended bonds need their terms first.** Without them the 2020–2023 index would hold only today's survivors, leaving out the bonds that defaulted or were repaid early: the years the index matters most. obligacje.pl may or may not keep pages of ended bonds; step A finds out on dev.

## Definitions

- **Session premium** (a bond, a session): only on a session **with trades** on the bond's main market (its GPW row, as the screen), from that session's close; PLN only; not within 90 days of maturity; not indexed (IZ). Floating: `priceAdjustedMargin(margin, close, years) − WZ curve(years)`; fixed: yield before tax and commission − fixed curve(years); `years` from that session's settlement date. The same function as the screen's premium (moved out of `screenRow`), so today's value equals the screen's.
- **Curve of a session**: the fixed and WZ curves from that session's treasury rows (`fixedCurve`, `wzCurve`), as the metrics build today's.
- **Index of a session**: for each corporate PLN bond, its latest session premium within the last **10 sessions** (a thinly traded bond still counts for two weeks after a trade); then per group the **median, quartiles and count**. Groups: all; fixed / floating; per industry with at least 5 bonds that session (else left out, not shown as a jumpy median of 2). Industry: the linked company's industry now.

## Storage (table `catalyst`, all rebuildable)

| Item | PK / SK | Contents | Count |
|---|---|---|---|
| Premium history | `BOND#<isin>` / `PREMIUMS` | `basis` (`wz` / `fixed-curve`), `points` (`{ date: premium }`, traded sessions only), `computedAt` | one per bond: ~1 800 items, ~70 points each on average (≤ ~2 KB; a daily trader ~25 KB) |
| Treasury curve | `CURVE#PLGOV` / `<date>` (exists) | as now; filled in for every session since 2020 | ~1 720 items |
| Market index | `PREMIUM_INDEX` / `<date>` | `{ all, fixed, floating, industry: { <name>: … } }`, each `{ median, q1, q3, n }` | ~1 720 items |

One item per bond rather than a field on each session: ~1 800 writes instead of ~400 000, and the chart reads one item. The index is one item per session, so a span is one query.

**Cost**: reads ~700 000 session items once (~$0.20), writes ~5 000 items (cents); obligacje.pl: ~570 pages at the job's 2 s apart. **Daily**: ~930 updates to the bonds' `PREMIUMS` items (one map entry each) and one index item: under a cent a day.

## Steps

**A. Terms of ended bonds** (the terms job). `termsWork` also takes ended corporate PLN bonds, after the listed ones (listed first, as now: their terms matter for today's screen). ~570 pages: four runs of 150. First on dev, to see how many pages obligacje.pl still has; what it hasn't stays out of the index, and the index shows its count per session (`n`) so a thin year reads as thin. On prod this is the job doing what it does, for more bonds: no data of yours changes.

**B. Core** (unit tests): `sessionPremium()` out of `screenRow` (the screen calls it; its tests unchanged); `premiumIndex()` (latest premium within 10 sessions, groups, median and quartiles, the 5-bond minimum); the curves of any session from its treasury rows (exists).

**C. Backfill job** `catalyst-premiums` (worker queue, request `{ kind: "premiums" }`, script `scripts/catalyst-premiums.ts --stage <stage>`):
1. The curves of every session: the treasury bonds' sessions (~150 series), a `CURVE#PLGOV` item per session (today's stays as the metrics wrote it).
2. Bond by bond (corporate first, then the rest), from its sessions, terms and interest periods: its `PREMIUMS` item. When the function's time runs short, the rest goes back on the queue (as the session backfill).
3. The index of every session from all `PREMIUMS` items (one pass in memory).

Idempotent: a run rewrites what it computes, so a rule change is a rerun.

**D. Daily** (`catalyst-metrics`): with today's screen rows (whose premium is the same function), the day's premium added to each traded bond's `PREMIUMS` item (one map entry), and the day's index item.

**E. Checks** before the views:
- For every listed bond, the history's latest point equals the screen's premium on that session (to the 6th decimal).
- The index against events everyone remembers: Developer and Finance medians through 2022 (rates up), and the issuers known to have widened (Ghelamco in 2026 should stand far above Developer's median).
- Coverage per year (`n` of the index), reported in the job's note.

**F. Docs**: `catalyst.md` (storage, jobs), this plan's status.

## On prod

Steps B–D are code; nothing is written on prod until the job runs. **I ask before**: the push that starts the daily writes (D), and the backfill run on prod (C). Dev first, with the checks (E), then prod.

## Not in this step

- The Yield / Premium views and the summary line (step 2), the market chart in the Catalyst view (step 3 of the earlier list).
- A WIBOR / WIRON history: not needed for the premium; needed for floaters' yields over time (later).
- Bid/ask midpoints for sessions without trades (quotes exist only from 2023-12): traded sessions only for now.
- Municipal and cooperative bonds in the index (they rarely trade): their `PREMIUMS` items are computed, the index covers corporate.
