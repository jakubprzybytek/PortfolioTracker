// Converts rows of the reference spreadsheet's "Transakcje" tab (Docs/reference/ReferenceFeatures.md) into the
// transaction import format. Only rows the app can value are converted: cash movements and instruments the app
// knows (by code); everything else is reported as skipped, with the reason.

import * as XLSX from "xlsx";
import { transactionId, type TransactionInput } from "./schema.ts";

/** One row of "Transakcje" (columns A–N). */
export interface SheetRow {
  /** Spreadsheet row number, for the skip report. */
  row: number;
  account: string;
  /** YYYY-MM-DD */
  date: string;
  ticker: string;
  currency: string;
  assetClass: string;
  /** "Wpłata środków", "Zakup", … */
  type: string;
  quantity: number;
  /** Bonds: PLN per bond (not % of nominal). */
  price: number;
  /** Commission, PLN. */
  fee: number;
  /** Nominal per bond for bonds (1 otherwise). */
  nominal: number;
  /** "Total PLN": buy = qty × price + fee; sell = qty × price − fee; others = the amount. Always positive. */
  totalPln: number;
  comment: string;
}

export interface SkippedRow {
  row: number;
  date: string;
  account: string;
  ticker: string;
  type: string;
  reason: string;
}

export interface SheetConversion {
  transactions: TransactionInput[];
  skipped: SkippedRow[];
}

const CASH_CLASS = "Gotówka";
const CASH_TYPES: Record<string, { type: TransactionInput["type"]; sign: 1 | -1 }> = {
  "Wpłata środków": { type: "DEPOSIT", sign: 1 },
  "Wypłata środków": { type: "WITHDRAWAL", sign: -1 },
  "Dywidenda / Odsetki": { type: "INTEREST", sign: 1 },
  Koszty: { type: "FEE", sign: -1 },
};

/** Why rows of an unknown instrument are skipped, per sheet asset class. */
const SKIP_REASON_BY_CLASS: Record<string, string> = {
  "Obligacje skarbowe polskie": "retail bond: no ISIN; calculator not wired in yet",
  "Obligacje korporacyjne polskie": "Catalyst bond: not set up (ISIN, terms, prices)",
  "Akcje zagraniczne": "ETF/share: phase 2 (prices, dividends, splits, FX)",
  "Obligacje korporacyjne zagraniczne": "ETF/share: phase 2 (prices, dividends, splits, FX)",
  "Obligacje skarbowe zagraniczne": "foreign bond: phase 3 (IBKR)",
  Waluty: "currency position: not modelled (foreign cash comes from cash balances later)",
  Inne: "manually valued asset: not set up",
};

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * @param instruments the app's instruments: code → ISIN and nominal (e.g. from data/instruments.json + bond terms)
 */
export function convertSheetRows(rows: SheetRow[], instruments: Map<string, { isin: string; nominal?: number }>): SheetConversion {
  const transactions: TransactionInput[] = [];
  const skipped: SkippedRow[] = [];
  const skip = (r: SheetRow, reason: string) => skipped.push({ row: r.row, date: r.date, account: r.account, ticker: r.ticker, type: r.type, reason });

  for (const r of rows) {
    const note = r.comment.trim() || undefined;

    if (r.assetClass === CASH_CLASS) {
      const m = CASH_TYPES[r.type];
      if (!m) skip(r, `cash: unsupported type "${r.type}"`);
      else if (r.currency !== "PLN") skip(r, `cash in ${r.currency}: not supported`);
      else transactions.push({ date: r.date, account: r.account, type: m.type, amount: round(m.sign * r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      continue;
    }

    const inst = instruments.get(r.ticker);
    if (!inst) {
      skip(r, SKIP_REASON_BY_CLASS[r.assetClass] ?? `unknown instrument (class "${r.assetClass}")`);
      continue;
    }
    if (r.currency !== "PLN") {
      skip(r, `${r.ticker} in ${r.currency}: not supported`);
      continue;
    }
    const nominal = r.nominal > 1 ? r.nominal : (inst.nominal ?? 100);
    const pricePct = round((r.price / nominal) * 100, 4);

    switch (r.type) {
      case "Zakup":
        // Sheet total includes the fee; the app adds `fee` to cost itself.
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin: inst.isin, quantity: r.quantity, price: pricePct, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        break;
      case "Sprzedaż":
        // Sheet total is already net of the fee: the cash received.
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin: inst.isin, quantity: r.quantity, price: pricePct, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        break;
      case "Dywidenda / Odsetki":
        transactions.push({ date: r.date, account: r.account, type: "COUPON", isin: inst.isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
        break;
      default:
        skip(r, `${r.ticker}: unsupported type "${r.type}"`);
    }
  }

  // Stable ids from the row contents (the sheet re-sorts its rows daily, so row numbers aren't stable).
  // Identical rows (e.g. two equal deposits on one day) get a counter suffix instead of collapsing into one.
  const seen = new Map<string, number>();
  for (const t of transactions) {
    const base = transactionId({ ...t, currency: t.currency ?? "PLN" });
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    t.id = n === 1 ? base : `${base}-${n}`;
  }
  return { transactions, skipped };
}

const SHEET_NAME = "Transakcje";
type Cell = string | number | boolean | Date | null | undefined;
const num = (v: Cell): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
const isoDate = (v: Cell): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`Not a date: "${s}"`);
  return s.slice(0, 10);
};

/** Reads the "Transakcje" tab of an XLSX export of the sheet (File → Download → .xlsx). */
export function readSheetTransactions(content: Uint8Array): SheetRow[] {
  const workbook = XLSX.read(content, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`No "${SHEET_NAME}" tab in the workbook`);
  const [, ...rows] = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: true, defval: null });
  const out: SheetRow[] = [];
  rows.forEach((c, i) => {
    if (!c[0] || !c[1]) return; // empty or unfinished row
    out.push({
      row: i + 2,
      account: String(c[0]).trim(),
      date: isoDate(c[1]),
      ticker: String(c[2] ?? "").trim(),
      currency: String(c[3] ?? "PLN").trim().toUpperCase(),
      assetClass: String(c[5] ?? "").trim(),
      type: String(c[6] ?? "").trim(),
      quantity: num(c[7]),
      price: num(c[8]),
      fee: num(c[9]),
      nominal: num(c[11]) || 1,
      totalPln: num(c[12]),
      comment: String(c[13] ?? ""),
    });
  });
  return out;
}
