import * as XLSX from "xlsx";
import { excelSerialToIsoDate, type IsoDate } from "../dates.ts";

/** One session of a GPW-listed bond. Prices are clean prices in % of nominal. */
export interface GpwDailyPrice {
  date: IsoDate; // session date
  instrument: string; // GPW code, e.g. DS0432
  isin: string;
  currency: string;
  open: number | null; // null when there was no trade that day
  high: number | null;
  low: number | null;
  close: number; // last price, or the reference price carried over when nothing traded
  changePct: number;
  volume: number; // number of bonds
  trades: number;
  turnoverThousands: number; // in thousands of `currency`
  gpwNominal: number; // GPW's "Cena nominalna" column: rounded, settlement-dated; don't value IZ bonds with it
  traded: boolean;
}

// Column headers of the archive XLS, mapped to our field names.
const COLUMNS = {
  date: "Data",
  instrument: "Nazwa",
  isin: "ISIN",
  currency: "Waluta",
  open: "Kurs otwarcia",
  high: "Kurs max",
  low: "Kurs min",
  close: "Kurs zamknięcia",
  changePct: "Zmiana",
  volume: "Wolumen",
  trades: "Liczba Transakcji",
  turnover: "Obrót",
  nominal: "Cena nominalna",
} as const;

type Cell = string | number | null | undefined;

function toIsoDate(value: Cell): IsoDate {
  if (typeof value === "number") return excelSerialToIsoDate(value);
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`Unrecognised date "${s}"`);
}

function toNumber(value: Cell): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) throw new Error(`Not a number: "${value}"`);
  return n;
}

/** Parses a GPW archive XLS (either one bond's history or one day's all-bonds file). */
export function parseGpwHistoryXls(content: Uint8Array): GpwDailyPrice[] {
  const workbook = XLSX.read(content, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = workbook.Sheets[sheetName]!;
  const [header, ...rows] = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false });

  // Locate columns by header name, so a reordered file still parses and a changed one fails loudly.
  const index = {} as Record<keyof typeof COLUMNS, number>;
  for (const [field, title] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const i = header?.findIndex((h) => String(h).trim().toLowerCase() === title.toLowerCase()) ?? -1;
    if (i < 0) throw new Error(`Column "${title}" not found; header is: ${JSON.stringify(header)}`);
    index[field] = i;
  }

  return rows
    .filter((row) => row.length > 0 && row[index.date] != null)
    .map((row) => {
      const volume = toNumber(row[index.volume]);
      const traded = volume > 0;
      const price = (field: "open" | "high" | "low") => (traded ? toNumber(row[index[field]]) : null);
      return {
        date: toIsoDate(row[index.date]),
        instrument: String(row[index.instrument]).trim(),
        isin: String(row[index.isin]).trim(),
        currency: String(row[index.currency]).trim(),
        open: price("open"),
        high: price("high"),
        low: price("low"),
        close: toNumber(row[index.close]),
        changePct: toNumber(row[index.changePct]),
        volume,
        trades: toNumber(row[index.trades]),
        turnoverThousands: toNumber(row[index.turnover]),
        gpwNominal: toNumber(row[index.nominal]),
        traded,
      };
    });
}
