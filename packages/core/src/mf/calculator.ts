// Reads the Ministry of Finance calculator workbook (kalkulatorodsetek.xlsm, gov.pl/web/finanse/kalkulatory2)
// as data only: the monthly CPI reference index and the terms of every treasury bond series.
// The workbook's own calculation lives in VBA macros, which are never run.

import * as XLSX from "xlsx";
import { excelSerialToIsoDate } from "../dates.ts";
import type { BondTerms, CouponPeriod } from "../bonds/terms.ts";
import { buildReferenceIndex, round5, type ReferenceIndexMonth } from "../bonds/izIndex.ts";

export interface MfCalculatorData {
  referenceIndex: ReferenceIndexMonth[];
  /** Fixed-rate (sheet "Stałe") and inflation-linked (sheet "Indeksowane") treasury series. */
  bonds: BondTerms[];
}

type Cell = string | number | null | undefined;

const SHEETS = { cpi: "Dane CPI", fixed: "Stałe", indexed: "Indeksowane" } as const;

function sheetRows(workbook: XLSX.WorkBook, name: string): Cell[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found; sheets: ${workbook.SheetNames.join(", ")}`);
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false });
}

function num(value: Cell, what: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${what}: expected a number, got "${value}"`);
  return value;
}

function parseCpi(rows: Cell[][]): ReferenceIndexMonth[] {
  // Header rows: ["Miesiąc","Wskaźnik referencyjny","-","Wskaźnik miesięczny"], ["n","WRk","1+WRk","Wn"]
  const header = rows[0] ?? [];
  if (String(header[0]) !== "Miesiąc" || String(header[1]) !== "Wskaźnik referencyjny") {
    throw new Error(`Unexpected "${SHEETS.cpi}" header: ${JSON.stringify(header)}`);
  }
  const monthly = rows
    .filter((r) => typeof r[0] === "number")
    .map((r) => ({ month: excelSerialToIsoDate(r[0] as number).slice(0, 7), wr: num(r[1], "WRk"), wSheet: num(r[3], "Wn") }));
  const built = buildReferenceIndex(monthly);
  // The sheet carries its own chained values; they must agree with ours or the method has changed.
  for (const [i, m] of built.entries()) {
    const expected = round5(monthly[i]!.wSheet);
    if (m.w !== expected) throw new Error(`Reference index mismatch for ${m.month}: computed ${m.w}, sheet ${expected}`);
  }
  return built;
}

/** Column layout of a coupon block in "Stałe" / "Indeksowane": 5 columns per coupon. */
const COUPON_BLOCK = ["start", "end", "recordDate", "paymentDate", "amount"] as const;

function parsePeriods(row: Cell[], firstCol: number): CouponPeriod[] {
  const periods: CouponPeriod[] = [];
  // Trailing empty cells are trimmed from the row, so the last block may be shorter than 5 cells.
  for (let i = firstCol; i < row.length; i += COUPON_BLOCK.length) {
    const start = row[i];
    if (typeof start !== "number") break; // "-" or empty: no more coupons
    const end = excelSerialToIsoDate(num(row[i + 1], "period end"));
    const paymentDate = row[i + 3];
    const period: CouponPeriod = {
      start: excelSerialToIsoDate(start),
      end,
      paymentDate: typeof paymentDate === "number" ? excelSerialToIsoDate(paymentDate) : end,
    };
    const amount = row[i + 4];
    if (typeof amount === "number") period.amount = amount;
    periods.push(period);
  }
  return periods;
}

function parseFixed(rows: Cell[][]): BondTerms[] {
  // Header: Seria, Kod ISIN, Wykup, Kupon, then 5 columns per coupon
  const header = rows[0] ?? [];
  if (String(header[3]) !== "Kupon") throw new Error(`Unexpected "${SHEETS.fixed}" header: ${JSON.stringify(header.slice(0, 5))}`);
  return rows
    .filter((r) => typeof r[0] === "string" && typeof r[1] === "string" && /^PL/.test(r[1]))
    .map((r) => ({
      isin: String(r[1]),
      code: String(r[0]).trim(),
      nominal: 1000,
      currency: "PLN",
      couponType: "FIXED" as const,
      couponRate: num(r[3], "coupon"),
      maturity: excelSerialToIsoDate(num(r[2], "maturity")),
      periods: parsePeriods(r, 4),
    }));
}

function parseIndexed(rows: Cell[][]): BondTerms[] {
  // Header: Seria, Kod ISIN, Wykup, Data emisji, Bazowy wskaźnik referencyjny, Kupon, then 5 columns per coupon
  const header = rows[0] ?? [];
  if (String(header[4]) !== "Bazowy wskaźnik referencyjny") {
    throw new Error(`Unexpected "${SHEETS.indexed}" header: ${JSON.stringify(header.slice(0, 7))}`);
  }
  return rows
    .filter((r) => typeof r[0] === "string" && typeof r[1] === "string" && /^PL/.test(r[1]))
    .map((r) => ({
      isin: String(r[1]),
      code: String(r[0]).trim(),
      nominal: 1000,
      currency: "PLN",
      couponType: "INDEXED" as const,
      couponRate: num(r[5], "coupon"),
      issueDate: excelSerialToIsoDate(num(r[3], "issue date")),
      maturity: excelSerialToIsoDate(num(r[2], "maturity")),
      baseRef: num(r[4], "base reference index"),
      periods: parsePeriods(r, 6),
    }));
}

export function parseMfCalculator(content: Uint8Array): MfCalculatorData {
  const workbook = XLSX.read(content, { type: "buffer" });
  return {
    referenceIndex: parseCpi(sheetRows(workbook, SHEETS.cpi)),
    bonds: [...parseFixed(sheetRows(workbook, SHEETS.fixed)), ...parseIndexed(sheetRows(workbook, SHEETS.indexed))],
  };
}
