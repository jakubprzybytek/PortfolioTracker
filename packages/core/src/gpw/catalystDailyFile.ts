// The Catalyst daily statistics file (gpwcatalyst.pl, pub/CATALYST/statystyki/statystyki_dzienne/catalyst_YYYYMMDD):
// every listed bond's session, one row per bond and market. Two layouts (Docs/catalyst.md, "Checked 2026-11-06"):
// .xls until 2026-10-02 and .xlsx from 2026-10-05, the latter with two more average-price columns, so columns are
// found by their English labels and a missing one fails loudly.

import * as XLSX from "xlsx";
import type { IsoDate } from "../dates.ts";

/** The file's sections, from the rows without an ISIN ("Obligacje korporacyjne/Corporate bonds"). */
export type CatalystSegment = "corporate" | "convertible" | "cooperative" | "municipal" | "treasury" | "mortgage-covered" | "public-covered" | "bank" | "other";

const SEGMENTS: [RegExp, CatalystSegment][] = [
  [/^corporate bonds$/i, "corporate"],
  [/^convertible bonds$/i, "convertible"],
  [/^co-operative bonds$/i, "cooperative"],
  [/^municipal/i, "municipal"],
  [/^treasury/i, "treasury"],
  [/^mortgage covered/i, "mortgage-covered"],
  [/^public covered/i, "public-covered"],
  [/^bank securities$/i, "bank"],
];

/** One bond on one market in one session. Prices clean, in % of nominal; amounts in the trading currency. */
export interface CatalystFileRow {
  segment: CatalystSegment;
  /** The section's label as printed (English part), e.g. "Corporate bonds". */
  segmentLabel: string;
  isin: string;
  code: string;
  /** "GPW RR", "GPW ASO", "BS RR", "BS ASO". */
  market: string;
  tradingSystem: string;
  /** The file's segment column (e.g. "SP"), empty for most bonds. */
  segmentCode: string;
  currency: string;
  maturity: IsoDate | null;
  /** Annual rate of the current interest period, as a fraction (6.44% → 0.0644); null for zero-coupon bonds. */
  rate: number | null;
  accruedInterest: number | null;
  nominal: number | null;
  close: number | null;
  reference: number | null;
  changePts: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  last: number | null;
  /** Session (order book) trades. */
  trades: number;
  volume: number;
  turnover: number;
  /** Block trades (off the order book). */
  blockVolume: number;
  blockTurnover: number;
}

export interface CatalystDailyFile {
  /** The session the file is for (sheet "statystyka"). */
  date: IsoDate;
  rows: CatalystFileRow[];
}

type Cell = string | number | null | undefined;

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** A cell as a number: null for empty, "---" or "-"; text like "1 234,5 " is read as a number. */
function num(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.replace(/\s/g, "").replace(",", ".");
  if (s === "" || /^-+$/.test(s)) return null;
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`Not a number: "${v}"`);
  return n;
}

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).trim());

/** "2027.02.18" (or a date cell) as an ISO date; null when empty. */
function date(v: Cell): IsoDate | null {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = text(v);
  if (s === "") return null;
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(s);
  if (!m) throw new Error(`Unrecognised date "${s}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

// The English labels of the columns, matched against the header rows joined per column.
const LABELS = {
  maturity: /^maturity\b/i,
  rate: /^interest on the current interest period/i,
  accruedInterest: /^accrued interest/i,
  nominal: /^nominal value/i,
  market: /^market$/i,
  tradingSystem: /^trading system/i,
  segmentCode: /^segment$/i,
  isin: /^isin code/i,
  code: /^security name/i,
  currency: /^trading currency/i,
  close: /^closing price/i,
  reference: /^reference price/i,
  changePts: /^change\b/i,
  open: /^opening price/i,
  low: /^low price/i,
  high: /^high price/i,
  last: /^last price/i,
  trades: /number of trades/i, // its first header row still has the Polish "transakcji"
} as const;

/** Parses a daily statistics file (.xls or .xlsx). */
export function parseCatalystDailyFile(content: Uint8Array): CatalystDailyFile {
  const wb = XLSX.read(content, { type: "buffer" });
  const sheet = wb.Sheets["instrumenty"];
  if (!sheet) throw new Error(`No sheet "instrumenty"; sheets are ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, blankrows: true });

  // The English header: from the row with "ISIN code" down to the first section row, joined per column.
  const first = rows.findIndex((r) => r.some((c) => /^isin code$/i.test(text(c))));
  if (first < 0) throw new Error('Header row with "ISIN code" not found');
  let end = first;
  while (end < rows.length && !isSectionRow(rows[end]!)) end++;
  const width = Math.max(...rows.slice(0, end).map((r) => r.length));
  const english = Array.from({ length: width }, (_, i) =>
    rows
      .slice(first, end)
      .map((r) => text(r[i]))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " "),
  );
  // The two trade groups: session trades, then block trades ("Off-Electronic order book trades", a row above).
  const groupRow = rows.slice(0, first).find((r) => r.some((c) => /off-electronic order book/i.test(text(c))));
  const blockStart = groupRow ? groupRow.findIndex((c) => /off-electronic order book/i.test(text(c))) : -1;
  if (blockStart < 0) throw new Error('Block trades group ("Off-Electronic order book trades") not found');

  const col = {} as Record<keyof typeof LABELS, number>;
  for (const [field, re] of Object.entries(LABELS) as [keyof typeof LABELS, RegExp][]) {
    const i = english.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`Column "${field}" not found; header is: ${JSON.stringify(english)}`);
    col[field] = i;
  }
  const after = (from: number, to: number, re: RegExp) => {
    for (let i = from; i < to; i++) if (re.test(english[i]!)) return i;
    throw new Error(`Column ${re} not found between ${from} and ${to}; header is: ${JSON.stringify(english)}`);
  };
  const volume = after(col.trades + 1, blockStart, /volume/i);
  const turnover = after(col.trades + 1, blockStart, /trading value/i);
  const blockVolume = after(blockStart, width, /volume/i);
  const blockTurnover = after(blockStart, width, /trading value/i);

  const out: CatalystFileRow[] = [];
  let segment: CatalystSegment = "other";
  let segmentLabel = "";
  for (const r of rows.slice(end)) {
    if (isSectionRow(r)) {
      segmentLabel = text(r[0]).split("/").slice(1).join("/").trim();
      segment = SEGMENTS.find(([re]) => re.test(segmentLabel))?.[1] ?? "other";
      continue;
    }
    const isin = text(r[col.isin]);
    if (!ISIN.test(isin)) continue;
    const thousands = (v: Cell) => round((num(v) ?? 0) * 1000, 2);
    const rate = num(r[col.rate]);
    out.push({
      segment,
      segmentLabel,
      isin,
      code: text(r[col.code]),
      market: text(r[col.market]),
      tradingSystem: text(r[col.tradingSystem]),
      segmentCode: text(r[col.segmentCode]),
      currency: text(r[col.currency]),
      maturity: date(r[col.maturity]),
      rate: rate === null ? null : round(rate / 100, 8),
      accruedInterest: num(r[col.accruedInterest]),
      nominal: num(r[col.nominal]),
      close: num(r[col.close]),
      reference: num(r[col.reference]),
      changePts: num(r[col.changePts]),
      open: num(r[col.open]),
      low: num(r[col.low]),
      high: num(r[col.high]),
      last: num(r[col.last]),
      trades: num(r[col.trades]) ?? 0,
      volume: num(r[volume]) ?? 0,
      turnover: thousands(r[turnover]),
      blockVolume: num(r[blockVolume]) ?? 0,
      blockTurnover: thousands(r[blockTurnover]),
    });
  }
  if (out.length === 0) throw new Error("No bond rows found");
  return { date: sessionDate(wb), rows: out };
}

/** A section row: only its first cell, a "Polish/English" label (the first, "Obligacje / Bonds", has no section). */
function isSectionRow(r: Cell[]): boolean {
  const first = text(r[0]);
  return first.includes("/") && !/^obligacje \/ bonds$/i.test(first) && r.slice(1).every((c) => text(c) === "");
}

/** The session date printed in the "statystyka" sheet ("2026.11.04"). */
function sessionDate(wb: XLSX.WorkBook): IsoDate {
  const sheet = wb.Sheets["statystyka"];
  if (!sheet) throw new Error('No sheet "statystyka"');
  for (const r of XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null }).slice(0, 10))
    for (const c of r) {
      const s = text(c);
      if (/^\d{4}\.\d{2}\.\d{2}$/.test(s)) return date(s)!;
    }
  throw new Error('No session date in sheet "statystyka"');
}
