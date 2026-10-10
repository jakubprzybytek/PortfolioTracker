// Usage:
//   npm run fetch -- [INSTRUMENT ...] [--out DIR]                     full history per instrument
//   npm run fetch -- --day YYYY-MM-DD [INSTRUMENT ...] [--all] [--out DIR]   one session, one request
// Downloads prices of GPW-listed treasury bonds, keeps the raw XLS and writes normalised JSON + CSV.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { downloadDayXls, downloadHistoryXls, InstrumentType, type DownloadedFile } from "./gpwArchive.ts";
import { parseHistoryXls, type DailyBondPrice } from "./parseHistory.ts";

const DEFAULT_INSTRUMENTS = ["IZ0836", "DS0432"];
const DELAY_BETWEEN_REQUESTS_MS = 5000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    day: { type: "string" },
    all: { type: "boolean", default: false },
    out: { type: "string", default: "data" },
  },
});

if (values.day && !/^\d{4}-\d{2}-\d{2}$/.test(values.day)) {
  console.error(`--day must be YYYY-MM-DD, got "${values.day}"`);
  process.exit(1);
}

const instruments = positionals.length > 0 ? positionals.map((p) => p.toUpperCase()) : DEFAULT_INSTRUMENTS;
const outDir = path.resolve(values.out);
const runDate = new Date().toISOString().slice(0, 10);

function toCsv(rows: DailyBondPrice[]): string {
  const columns = Object.keys(rows[0]) as (keyof DailyBondPrice)[];
  const lines = rows.map((r) => columns.map((c) => r[c] ?? "").join(","));
  return [columns.join(","), ...lines].join("\n") + "\n";
}

// Keep the original file: if the parser turns out to be wrong, we can reprocess it.
async function archiveRaw(file: DownloadedFile): Promise<void> {
  const rawDir = path.join(outDir, "raw", runDate);
  await mkdir(rawDir, { recursive: true });
  await writeFile(path.join(rawDir, file.fileName), file.content);
}

async function writeRows(baseName: string, rows: DailyBondPrice[]): Promise<void> {
  const file = path.join(outDir, baseName);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.json`, JSON.stringify(rows, null, 2));
  await writeFile(`${file}.csv`, toCsv(rows));
}

async function fetchDay(day: string): Promise<void> {
  console.log(`${day}: downloading all treasury bonds…`);
  const file = await downloadDayXls(day, InstrumentType.treasuryBonds);
  const allRows = file ? parseHistoryXls(file.content) : [];
  if (!file || allRows.length === 0) {
    console.log(`${day}: no session (weekend, holiday or future date)`);
    return;
  }
  await archiveRaw(file);
  const rows = values.all ? allRows : allRows.filter((r) => instruments.includes(r.instrument));
  const missing = values.all ? [] : instruments.filter((i) => !rows.some((r) => r.instrument === i));
  if (rows.length > 0) await writeRows(path.join("day", day), rows);

  console.log(`${day}: ${allRows.length} bonds in the file, ${rows.length} kept`);
  console.table(
    rows.map((r) => ({
      bond: r.instrument,
      isin: r.isin,
      open: r.open ?? "-",
      high: r.high ?? "-",
      low: r.low ?? "-",
      close: r.close,
      "chg %": r.changePct,
      volume: r.volume,
      trades: r.trades,
      "turnover k": r.turnoverThousands,
    })),
  );
  if (missing.length > 0) throw new Error(`Not in the file: ${missing.join(", ")}`);
}

async function fetchHistories(): Promise<number> {
  let failed = 0;
  for (const [i, instrument] of instruments.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
    try {
      console.log(`${instrument}: downloading…`);
      const file = await downloadHistoryXls(instrument, InstrumentType.treasuryBonds);
      await archiveRaw(file);

      const rows = parseHistoryXls(file.content);
      if (rows.length === 0) throw new Error("The archive returned no rows");
      await writeRows(instrument, rows);

      const first = rows[0];
      const last = rows.at(-1)!;
      const tradedDays = rows.filter((r) => r.traded).length;
      console.log(
        `${instrument} (${last.isin}): ${rows.length} sessions ${first.date} → ${last.date}, ` +
          `${tradedDays} with trades; last close ${last.close}% of nominal`,
      );
    } catch (err) {
      failed++;
      console.error(`${instrument}: ${(err as Error).message}`, (err as Error).cause ?? "");
    }
  }
  return failed;
}

try {
  if (values.day) {
    await fetchDay(values.day);
  } else {
    process.exitCode = (await fetchHistories()) > 0 ? 1 : 0;
  }
} catch (err) {
  console.error((err as Error).message, (err as Error).cause ?? "");
  process.exitCode = 1;
}
console.log(`Output: ${outDir}`);
