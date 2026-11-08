// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/scope.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N4): functionality kept, imports adapted.

// The AI analysis and the general rule sets are built for operating companies, so Finance and Municipal
// issuers get no AI analysis. Non-bank lenders listed in FINANCE_RULE_SETS (scorecard.ts) are still scored
// from their reports, by the finance rules (2026-11-05-finance-rules-design.md); banks, insurers, state
// bodies and municipalities get no scorecard.
export const OUT_OF_SCOPE_INDUSTRIES: readonly string[] = ['Finance', 'Municipal'];

// Unclassified issuers (no industry yet) stay in scope.
export function isInFundamentalScope(industry: string | undefined): boolean {
    return industry === undefined || !OUT_OF_SCOPE_INDUSTRIES.includes(industry);
}

/** The fixed list of industries (CatalystViewer's IssuerClassification, §6): one per company. */
export const INDUSTRIES = ["Developer", "Finance", "Health Services", "Energy", "Retail", "Manufacturing", "Municipal", "Telecommunications", "Transportation & Logistics", "Media", "Construction", "Other"] as const;
export type Industry = (typeof INDUSTRIES)[number];
