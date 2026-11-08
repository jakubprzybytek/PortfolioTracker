// Financial years read from reports (Docs/catalyst.md, "Reading reports"): a parsed filing (filings/, read on the
// user's machine) becomes one row per year it shows, its own and the comparative one. The most recent report wins: a
// year in two reports keeps the newer report's figures (companies restate), the replaced row is kept apart. The app
// checks what it's sent again before storing (the parsers aren't in its functions): the balance sheet adds up, its
// lines add up to their totals. Types only from filings/: no parser code here.

import type { FilingExtraction, FilingField, FilingScope, ParsedFiling, SourcedFigure } from "./filings/filingParser.ts";
import { itemTotals, lineChecks, type ItemTotals, type StatementLine } from "./filings/statementLines.ts";

export type ReviewStatus = "parsed" | "hand-checked" | "flagged";

/** One fiscal year of a company, from a report (CatalystViewer's IssuerFinancials row, §15). */
export interface FinancialYear {
  entityId: string;
  /** "<period end>#<scope>" */
  period: string;
  companyName: string;
  scope: FilingScope;
  periodStart: string;
  periodEnd: string;
  months: number;
  currency: string;
  standard: ParsedFiling["standard"];
  presentedUnit: ParsedFiling["presentedUnit"];
  lineSigns: ParsedFiling["lineSigns"];
  figures: Partial<Record<FilingField, SourcedFigure>>;
  lines: StatementLine[];
  items: ItemTotals;
  review: { status: ReviewStatus; note?: string; at?: string; by?: string };
  /** The report's own year (`current`) or its comparative (`previous`). */
  column: "current" | "previous";
  /** The fiscal year end of the report the row came from. */
  reportPeriodEnd: string;
  filing: {
    key: string;
    sha256: string;
    format: ParsedFiling["format"];
    schema: string;
    preparedOn?: string;
    checks: string[];
    notes?: string[];
    extraction?: FilingExtraction;
  };
  /** Who imported it: you, the agent (its model), "CatalystViewer" for migrated rows. */
  enteredBy: string;
  importedAt: string;
}

/** Where the original goes in the files bucket. */
export const filingKey = (entityId: string, periodEnd: string, scope: FilingScope, sha256: string, extension: string) =>
  `catalyst/filings/${entityId.replace(":", "-")}/${periodEnd}-${scope}-${sha256.slice(0, 12)}.${extension}`;

/** The rows a filing gives, one per year it shows. */
export function filingRows(entityId: string, filing: ParsedFiling, meta: { key: string; sha256: string; enteredBy: string; importedAt: string }): FinancialYear[] {
  const reportPeriodEnd = filing.periods[0]?.periodEnd ?? "";
  return filing.periods.map((p) => ({
    entityId,
    period: `${p.periodEnd}#${filing.scope}`,
    companyName: filing.companyName,
    scope: filing.scope,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    months: p.months,
    currency: filing.currency,
    standard: filing.standard,
    presentedUnit: filing.presentedUnit,
    lineSigns: filing.lineSigns,
    figures: p.figures,
    lines: p.lines,
    items: itemTotals(p.lines, filing.lineSigns),
    review: { status: "parsed" },
    column: p.column,
    reportPeriodEnd,
    filing: {
      key: meta.key,
      sha256: meta.sha256,
      format: filing.format,
      schema: filing.schema,
      ...(filing.preparedOn ? { preparedOn: filing.preparedOn } : {}),
      checks: filing.checks,
      ...(filing.notes ? { notes: filing.notes } : {}),
      ...(filing.extraction ? { extraction: filing.extraction } : {}),
    },
    enteredBy: meta.enteredBy,
    importedAt: meta.importedAt,
  }));
}

export interface YearsPlan {
  /** Rows to store (new years, or a report at least as recent as the stored one's). */
  put: FinancialYear[];
  /** Stored rows these replace: kept apart, never lost. */
  replaced: FinancialYear[];
  /** Years left as they are: the stored row comes from a more recent report. */
  kept: { period: string; storedFrom: string }[];
}

/** The most recent report wins (§7): a row replaces the stored one only when its report is as recent or newer. */
export function planYears(rows: FinancialYear[], stored: Map<string, FinancialYear>): YearsPlan {
  const plan: YearsPlan = { put: [], replaced: [], kept: [] };
  for (const row of rows) {
    const before = stored.get(row.period);
    if (before && before.reportPeriodEnd > row.reportPeriodEnd) {
      plan.kept.push({ period: row.period, storedFrom: before.reportPeriodEnd });
      continue;
    }
    plan.put.push(row);
    if (before && before.filing.sha256 !== row.filing.sha256) plan.replaced.push(before);
  }
  return plan;
}

/**
 * The app's own checks of a row it's sent: the balance sheet's lines add up to its totals, and total assets equal
 * total equity and liabilities. A rounding allowance of two of the presented unit.
 */
export function rowChecks(row: Pick<FinancialYear, "period" | "lines" | "presentedUnit">): string[] {
  const tolerance = 2 * row.presentedUnit;
  const checks = lineChecks(row.lines, row.period, tolerance);
  const total = (item: string) => row.lines.find((l) => l.statement === "balance" && l.item === item)?.value;
  const assets = total("totalAssets");
  const equityAndLiabilities = total("totalEquityAndLiabilities");
  if (assets !== undefined && equityAndLiabilities !== undefined && Math.abs(assets - equityAndLiabilities) > tolerance)
    checks.push(`${row.period}: total assets ${assets.toLocaleString("en-US")} ≠ total equity and liabilities ${equityAndLiabilities.toLocaleString("en-US")}`);
  return checks;
}

/** Differences between hand-read figures (thousands, as printed) and a year's figures: "revenue 1,234 ≠ 1,240". */
export function knownDifferences(thousands: Record<string, number>, figures: Partial<Record<FilingField, SourcedFigure>> | undefined): string[] {
  if (!figures) return ["no figures"];
  return Object.entries(thousands).flatMap(([field, want]) => {
    const got = figures[field as FilingField]?.value;
    const gotThousands = got === undefined ? undefined : Math.round(got / 1000);
    return gotThousands === want ? [] : [`${field} ${gotThousands?.toLocaleString("en-US") ?? "missing"} ≠ ${want.toLocaleString("en-US")}`];
  });
}

/** Problems with a year's statement lines: a statement missing, or the total assets line not the figure. */
export function lineProblems(lines: StatementLine[] | undefined, figures: Partial<Record<FilingField, SourcedFigure>> | undefined): string[] {
  if (!lines?.length) return ["no statement lines"];
  const problems = (["balance", "income", "cashFlow"] as const).filter((s) => !lines.some((l) => l.statement === s)).map((s) => `no ${s} lines`);
  const assets = lines.find((l) => l.statement === "balance" && l.item === "totalAssets");
  if (!assets) problems.push("no total assets line");
  else if (figures?.totalAssets && Math.round(assets.value) !== Math.round(figures.totalAssets.value))
    problems.push(`total assets line ${assets.value.toLocaleString("en-US")} ≠ figure ${figures.totalAssets.value.toLocaleString("en-US")}`);
  return problems;
}
