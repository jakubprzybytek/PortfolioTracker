// Reads the Ministry of Finance file "Dane dotyczące obligacji detalicznych" (gov.pl/web/finanse/obligacje-detaliczne1):
// every retail treasury bond series with its ISIN, the rate it actually paid in each year (or month, for ROR/DOR),
// its margin, rollover price and the interest per bond the Ministry published. One tab per bond kind.

import * as XLSX from "xlsx";
import { excelSerialToIsoDate, type IsoDate } from "../dates.ts";

export const RETAIL_KINDS = ["EDO", "COI", "ROD", "ROS", "TOS", "ROR", "DOR"] as const;
export type RetailKind = (typeof RETAIL_KINDS)[number];

/** Terms of one retail series, as stored on its instrument (`InstrumentItem.retail`). */
export interface RetailTerms {
  series: string; // EDO0332
  isin: string;
  kind: RetailKind;
  /** Term from the purchase date, in months (EDO 120, COI 48, TOS 36, ROR 12 …). */
  termMonths: number;
  /** Length of an interest period: 12 months, or 1 for ROR/DOR. */
  periodMonths: number;
  /** EDO, ROD, ROS, TOS add each period's interest to the base; COI, ROR, DOR pay it out. */
  capitalises: boolean;
  /** Annual rate of each period, as published; null = not published yet. TOS: the same fixed rate every year. */
  rates: (number | null)[];
  /** Margin over CPI (or over the NBP reference rate for ROR/DOR); undefined for fixed-rate TOS. */
  margin?: number;
  /** Price per bond when bought by rolling over maturing bonds (e.g. 99.9); undefined if not offered. */
  rolloverPrice?: number;
  /** Interest per bond the Ministry published: per period (COI, ROR, DOR) or for the whole term (EDO, ROD, ROS, TOS). */
  publishedInterest: (number | null)[];
  saleStart: IsoDate;
  saleEnd: IsoDate;
}

type Cell = string | number | null | undefined;

const CAPITALISES: Record<RetailKind, boolean> = { EDO: true, ROD: true, ROS: true, TOS: true, COI: false, ROR: false, DOR: false };

const numOrNull = (c: Cell): number | null => (typeof c === "number" && !Number.isNaN(c) ? c : null);
/** Rates are stored with binary noise (0.0515 → 0.051500000000000004); they have at most 4 decimals as fractions. */
const rateOrNull = (c: Cell): number | null => {
  const n = numOrNull(c);
  return n === null ? null : Number(n.toFixed(6));
};

/** "10 lat/a od dnia zakupu", "1 rok od dnia zakupu", "13 miesięcy …" → months. */
export function parseTerm(text: string): number {
  const m = /^\s*(\d+)\s*(rok|lat|mies)/i.exec(text);
  if (!m) throw new Error(`Unknown term "${text}"`);
  return m[2]!.toLowerCase() === "mies" ? Number(m[1]) : Number(m[1]) * 12;
}

function parseTab(rows: Cell[][], kind: RetailKind): RetailTerms[] {
  const header = rows[0]?.map((c) => String(c ?? "").trim()) ?? [];
  const col = (label: string) => header.indexOf(label);
  const [iSeries, iIsin, iTerm, iStart, iEnd, iRollover, iRate, iInterest, iMargin] = [
    col("Seria"), col("Kod ISIN"), col("Data wykupu"), col("Początek sprzedaży"), col("Koniec sprzedaży"),
    col("Cena zamiany"), col("Oprocentowanie"), col("Odsetki (zł)"), col("Marża"),
  ];
  if ([iSeries, iIsin, iTerm, iStart, iEnd, iRate, iInterest].some((i) => i < 0)) throw new Error(`${kind}: unexpected header ${JSON.stringify(header)}`);
  const rateCount = iInterest - iRate;
  const interestCount = (iMargin >= 0 ? iMargin : iInterest + 1) - iInterest;
  // Tabs with one rate per period have a second header row ("w 1. roku" …); TOS has a single header row.
  const firstData = String(rows[1]?.[iRate] ?? "").trim().startsWith("w ") ? 2 : 1;

  const out: RetailTerms[] = [];
  for (const r of rows.slice(firstData)) {
    const series = String(r[iSeries] ?? "").trim();
    if (!/^[A-Z]{3}\d{4}$/.test(series)) continue;
    const termMonths = parseTerm(String(r[iTerm] ?? ""));
    const periodMonths = kind === "ROR" || kind === "DOR" ? 1 : 12;
    const periods = Math.ceil(termMonths / periodMonths);
    let rates = Array.from({ length: rateCount }, (_, k) => rateOrNull(r[iRate + k]));
    if (kind === "TOS") rates = Array.from({ length: periods }, () => rates[0] ?? null); // fixed for the whole term
    rates = rates.slice(0, periods);
    const margin = iMargin >= 0 ? rateOrNull(r[iMargin]) : null;
    const rollover = numOrNull(r[iRollover]);
    out.push({
      series,
      isin: String(r[iIsin] ?? "").trim(),
      kind,
      termMonths,
      periodMonths,
      capitalises: CAPITALISES[kind],
      rates,
      ...(margin !== null ? { margin } : {}),
      ...(rollover !== null ? { rolloverPrice: rollover } : {}),
      publishedInterest: Array.from({ length: interestCount }, (_, k) => {
        const n = numOrNull(r[iInterest + k]);
        return n === null ? null : Number(n.toFixed(4)); // same binary noise as the rates (53.93000000000001)
      }),
      saleStart: excelSerialToIsoDate(Number(r[iStart])),
      saleEnd: excelSerialToIsoDate(Number(r[iEnd])),
    });
  }
  return out;
}

/** All series of the kinds the app values, keyed by series code. */
export function parseRetailRates(content: Uint8Array): Map<string, RetailTerms> {
  const workbook = XLSX.read(content, { type: "array" });
  const all = new Map<string, RetailTerms>();
  for (const kind of RETAIL_KINDS) {
    const sheet = workbook.Sheets[kind];
    if (!sheet) throw new Error(`Tab "${kind}" not found; tabs: ${workbook.SheetNames.join(", ")}`);
    for (const t of parseTab(XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false, defval: null }), kind)) all.set(t.series, t);
  }
  return all;
}
