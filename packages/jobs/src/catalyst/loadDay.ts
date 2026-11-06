// Loading one session's daily file into the Catalyst table, shared by the daily job and the backfill: fetch, archive,
// parse, plan (core/catalyst/daily.ts), write the sessions and bonds, mark the day loaded. `stored` (the bonds by
// ISIN) is kept up to date for the next day.

import { catalystKeys, DAILY_FILE_SOURCE, planDailyFile, type CatalystBondItem, type DailyPlan } from "@portfolio/core/catalyst/index";
import { parseCatalystDailyFile, type IsoDate } from "@portfolio/core";
import { archiveRaw } from "../lib/context.ts";
import { catalystRepo } from "./context.ts";
import { fetchDailyFile } from "./gpwCatalyst.ts";

export interface DayLoaded {
  date: IsoDate;
  rows: number;
  written: number;
  plan: DailyPlan;
}

/** A file that holds another session than its name says (2025-06-25's repeats 2025-06-24's): nothing written. */
export interface DayMislabelled {
  date: IsoDate;
  holds: IsoDate;
}

/** Undefined when the session has no file (not published yet, or no session that day). */
export async function loadDay(date: IsoDate, stored: Map<string, CatalystBondItem>, latest: boolean): Promise<DayLoaded | DayMislabelled | undefined> {
  const got = await fetchDailyFile(date);
  if (!got) return undefined;
  const fetchedAt = new Date().toISOString();
  await archiveRaw(DAILY_FILE_SOURCE, date, got.fileName, got.content);
  const file = parseCatalystDailyFile(got.content);
  if (file.date !== date) return { date, holds: file.date };
  const plan = planDailyFile(file, stored, fetchedAt, latest);
  const written = (await catalystRepo.putSessions(plan.sessions)) + (await catalystRepo.putBonds(plan.bonds));
  const updatedAt = new Date().toISOString();
  for (const b of plan.bonds) stored.set(b.isin, { ...catalystKeys.bond(b.isin), GSI1PK: "BOND", GSI1SK: b.code, ...b, updatedAt } satisfies CatalystBondItem);
  await catalystRepo.putDay({ date, rows: file.rows.length, bonds: new Set(file.rows.map((r) => r.isin)).size, file: got.fileName, fetchedAt });
  return { date, rows: file.rows.length, written, plan };
}
