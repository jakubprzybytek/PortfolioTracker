import { readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, "fixtures");

export const fixture = (name: string): Buffer => readFileSync(path.join(dir, name));

export const FIXTURES = {
  dsHistory: "ds0432_to_2026-10-10_obligacje.xls",
  izHistory: "iz0836_to_2026-10-10_obligacje.xls",
  day20261009: "_2026-10-09_obligacje.xls",
  mfCalculator: "kalkulatorodsetek.xlsm",
} as const;
