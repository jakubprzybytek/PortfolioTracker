// CatalystViewer's stored year (`DbIssuerFinancialsRecord`) as the ported scorecard code reads it: in PT, a
// financial year row (../financials.ts) has the same fields.

import type { FinancialYear } from "../financials.ts";

/** CatalystViewer's rows also carried the issuer's name and identifiers; the ported tests still build them so. */
export type DbIssuerFinancialsRecord = FinancialYear & { issuerName?: string; krs?: string; lei?: string };
