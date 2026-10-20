// Money in and out per account and month (the sheet's "Wpłaty/wypłaty <year>" tab): deposits, withdrawals and their
// balance, in PLN at the NBP rate of the day before (as net deposits). Shown in the app's Cash flows view and served
// as CSV to a spreadsheet (GET /feeds/cash-flows.csv, IMPORTDATA), in the layout of the tab's summary (B1:O11).

import type { TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";
import { toPlnD1, type FxHistory } from "../valuation/fx.ts";

/** Twelve months, January first. */
export type Months = number[];

export interface CashFlowRow {
  /** Paid in, per month (≥ 0). */
  deposits: Months;
  /** Taken out, per month (≥ 0). */
  withdrawals: Months;
  /** deposits − withdrawals. */
  net: Months;
  totals: { deposits: number; withdrawals: number; net: number };
}

export interface AccountCashFlows extends CashFlowRow {
  account: string;
}

export interface CashFlowReport {
  year: number;
  /** Accounts with deposits or withdrawals up to the year's end and still in use in it, by name. */
  accounts: AccountCashFlows[];
  /** Every account together ("Bilans wpływów"). */
  total: CashFlowRow;
  /** Years with any deposit or withdrawal, newest first (the year picker). */
  years: number[];
  /** Transactions in another currency without an NBP rate: their months are incomplete. */
  missingRates?: string[];
}

const zeros = (): Months => Array.from({ length: 12 }, () => 0);
const sum = (m: Months) => round2(m.reduce((s, v) => s + v, 0));

function rowOf(deposits: Months, withdrawals: Months): CashFlowRow {
  const d = deposits.map(round2);
  const w = withdrawals.map(round2);
  const net = d.map((v, i) => round2(v - w[i]!));
  return { deposits: d, withdrawals: w, net, totals: { deposits: sum(d), withdrawals: sum(w), net: sum(net) } };
}

export function cashFlows(transactions: TransactionItem[], year: number, fx?: FxHistory): CashFlowReport {
  const flows = transactions.filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL");
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const lastDate = new Map<string, string>();
  for (const t of transactions) if ((lastDate.get(t.account) ?? "") < t.date) lastDate.set(t.account, t.date);
  const names = [...new Set(flows.filter((t) => t.date <= end).map((t) => t.account))]
    .filter((a) => (lastDate.get(a) ?? "") >= start)
    .sort((a, b) => a.localeCompare(b, "pl"));

  const missing: string[] = [];
  const accounts = names.map((account): AccountCashFlows => {
    const deposits = zeros();
    const withdrawals = zeros();
    for (const t of flows) {
      if (t.account !== account || t.date < start || t.date > end) continue;
      const pln = toPlnD1(t.amount, t.currency || "PLN", t.date, fx);
      if (Number.isNaN(pln)) {
        missing.push(`${t.date} ${t.account} ${t.amount} ${t.currency}`);
        continue;
      }
      const m = Number(t.date.slice(5, 7)) - 1;
      // Withdrawals are stored negative; a deposit with a negative amount (a correction) counts against deposits.
      if (t.type === "DEPOSIT") deposits[m]! += pln;
      else withdrawals[m]! -= pln;
    }
    return { account, ...rowOf(deposits, withdrawals) };
  });

  const total = rowOf(
    zeros().map((_, i) => accounts.reduce((s, a) => s + a.deposits[i]!, 0)),
    zeros().map((_, i) => accounts.reduce((s, a) => s + a.withdrawals[i]!, 0)),
  );
  const years = [...new Set(flows.map((t) => Number(t.date.slice(0, 4))))].sort((a, b) => b - a);
  return { year, accounts, total, years, ...(missing.length ? { missingRates: missing } : {}) };
}

const MONTHS_PL = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];

const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvNumber = (v: number) => String(round2(v));

/**
 * The report as CSV, laid out as the sheet's summary (B1:O11) so formulas reading it keep working: a header with the
 * months, "Bilans wpływów" (every account's net per month, empty for a month with none, then the year), then each
 * account's net per month and its year.
 */
export function cashFlowsCsv(r: CashFlowReport): string {
  const rows: string[][] = [
    ["Podsumowanie", ...MONTHS_PL, ""],
    ["Bilans wpływów", ...r.total.net.map((v) => (v !== 0 ? csvNumber(v) : "")), csvNumber(r.total.totals.net)],
    ...r.accounts.map((a) => [a.account, ...a.net.map(csvNumber), csvNumber(a.totals.net)]),
  ];
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
