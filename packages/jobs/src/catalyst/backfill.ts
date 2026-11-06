// The Catalyst backfill (Docs/catalyst-phase1-plan.md, M3): a range of the daily-file archive, newest session first
// (so a bond seen first in an older file has ended: core/catalyst/daily.ts). Days already loaded are skipped, so a
// range can be run again. When the function's time runs short, the rest of the range goes back on the queue.

import { sessionsBetween } from "@portfolio/core/catalyst/index";
import type { IsoDate } from "@portfolio/core";
import { catalystRepo, queueCatalyst } from "./context.ts";
import { loadDay } from "./loadDay.ts";

/** Time kept back for one more day (a file, its writes) before giving the rest of the range back to the queue. */
const RESERVE_MS = 90_000;

export async function backfillRange(from: IsoDate, to: IsoDate, remainingMs: () => number): Promise<{ itemsWritten: number; note: string }> {
  const sessions = sessionsBetween(from, to);
  const loaded = new Set((await catalystRepo.listDays(from, to)).map((d) => d.date));
  const todo = sessions.filter((d) => !loaded.has(d));
  const stored = new Map((await catalystRepo.listBonds()).map((b) => [b.isin, b]));
  let newest = (await catalystRepo.latestDay())?.date ?? "";
  let written = 0;
  let days = 0;
  const noFile: IsoDate[] = [];
  const mislabelled: string[] = [];
  for (const date of todo) {
    if (remainingMs() < RESERVE_MS) {
      await queueCatalyst({ kind: "backfill", from, to: date });
      return { itemsWritten: written, note: `${from} – ${to}: ${days} sessions loaded, the rest from ${date} back queued again (time)${noFile.length ? `; no file: ${noFile.join(", ")}` : ""}` };
    }
    const latest = date >= newest;
    const got = await loadDay(date, stored, latest);
    if (!got) {
      noFile.push(date);
      continue;
    }
    if ("holds" in got) {
      mislabelled.push(`${date} (holds ${got.holds})`);
      continue;
    }
    if (latest) newest = date;
    written += got.written;
    days++;
  }
  return {
    itemsWritten: written,
    note: `${from} – ${to}: ${days} sessions loaded, ${loaded.size} already${noFile.length ? `; no file: ${noFile.join(", ")}` : ""}${mislabelled.length ? `; another session's file: ${mislabelled.join(", ")}` : ""}`,
  };
}
