// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/confidence.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N4): functionality kept, imports adapted.

// How much a scorecard's colours rest on: where its figures come from, how current they are and how many
// metrics could be computed. Design: docs/superpowers/specs/2026-11-03-data-confidence-design.md
import type { DimensionResult, FundamentalScorecard } from "./scorecard.ts";

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ConfidenceSource =
    | { kind: 'filing'; format: 'krs-xml' | 'esef' | 'ifrs-text' | 'ai-pdf'; scope: 'single' | 'group'; periodEnd: string; years: number }
    | { kind: 'ai'; performedAt: string; periodEnd: string; years: number };

export type DataConfidence = {
    level: ConfidenceLevel;
    source: ConfidenceSource['kind'];
    periodEnd: string;
    yearsBehind: number;                          // fiscal years whose report should be out by now
    metrics: { computed: number; scored: number };  // in the snapshot dimensions
    missing: string[];                            // scored snapshot metrics that are n/a
    years: number;
    thinDimensions: string[];                     // coloured by one metric where they have two or more
    facts: string[];                              // what the tooltip shows
};

// Trend depends on the number of years, Refinancing on bonds: neither is about the report's figures.
const NOT_SNAPSHOT = ['Financial Trend', 'Refinancing'];
// Annual reports are approved within 6 months of the year end, then filed.
const REPORT_DUE_MONTHS = 9;
const TREND_YEARS = 3;

const FORMAT_LABEL: Record<Extract<ConfidenceSource, { kind: 'filing' }>['format'], string> = {
    'krs-xml': 'KRS filing', 'esef': 'ESEF report', 'ifrs-text': 'IFRS report', 'ai-pdf': 'PDF report, read by AI and checked',
};

function addMonths(day: string, months: number): string {
    const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
    const dayOfMonth = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // Keep month ends as month ends (30 Sept + 12 months = 30 Sept)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dayOfMonth, last));
    return d.toISOString().slice(0, 10);
}

// The number of later fiscal years whose report is due by today.
export function yearsBehind(periodEnd: string, today: string): number {
    let n = 0;
    while (addMonths(periodEnd, 12 * (n + 1) + REPORT_DUE_MONTHS) <= today) n++;
    return n;
}

const scoredMetrics = (d: DimensionResult) => d.metrics.filter(m => m.scored !== false);

export function dataConfidence(scorecard: FundamentalScorecard, source: ConfidenceSource, today: string): DataConfidence {
    const all = scorecard.dimensions.filter(d => d.name !== 'Refinancing');
    const snapshot = all.filter(d => !NOT_SNAPSHOT.includes(d.name));
    const scored = snapshot.flatMap(scoredMetrics);
    const computed = scored.filter(m => m.signal !== 'na').length;
    const missing = scored.filter(m => m.signal === 'na').map(m => m.name);
    const emptyDimensions = snapshot.filter(d => d.signal === 'na').length;
    const thinDimensions = all
        .filter(d => d.signal !== 'na' && scoredMetrics(d).length >= 2 && scoredMetrics(d).filter(m => m.signal !== 'na').length === 1)
        .map(d => d.name);
    const behind = yearsBehind(source.periodEnd, today);
    const share = scored.length ? computed / scored.length : 0;

    const level: ConfidenceLevel =
        share < 0.5 || emptyDimensions >= 2 || behind >= 2 ? 'low'
        : source.kind === 'filing' && share >= 0.8 && behind === 0 ? 'high'
        : 'medium';

    const year = source.periodEnd.slice(5, 10) === '12-31' ? `FY${source.periodEnd.slice(0, 4)}` : `year to ${source.periodEnd.slice(0, 10)}`;
    const facts = [
        source.kind === 'filing'
            ? `${FORMAT_LABEL[source.format]}, ${source.scope === 'group' ? 'group' : 'single-company'} accounts, ${year}`
            : `AI-collected figures (${source.performedAt.slice(0, 10)}), not checked against a report, ${year}`,
        ...(behind ? [`${behind === 1 ? 'a year' : `${behind} years`} behind: a later report should be out`] : []),
        `${computed} of ${scored.length} metrics computed${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
        ...(source.years < TREND_YEARS ? [`${source.years} year${source.years === 1 ? '' : 's'} of figures: no trend (needs ${TREND_YEARS})`] : []),
        ...thinDimensions.map(d => `${d}: from one metric`),
    ];

    return { level, source: source.kind, periodEnd: source.periodEnd, yearsBehind: behind, metrics: { computed, scored: scored.length }, missing, years: source.years, thinDimensions, facts };
}
