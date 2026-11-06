// The Catalyst daily file (Docs/catalyst.md, "Jobs"): every session of the last week not loaded yet, oldest first
// (loadDay.ts); the latest one also ends the bonds that left the market. Then the metrics are queued. Evenings after
// the session, and a morning recheck (which skips today: its file comes after the close).

import { recentSessions } from "@portfolio/core/catalyst/index";
import { today } from "@portfolio/core";
import { runJob } from "../../lib/context.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { loadDay } from "../loadDay.ts";

/** Sessions looked back over (a missed day is repaired within a week). */
const LOOK_BACK = 5;

export async function handler(event: { morning?: boolean } = {}) {
  return runJob("catalyst-daily", async () => {
    const day = today();
    const sessions = recentSessions(day, LOOK_BACK + 1).filter((d) => !(event.morning && d === day));
    const loaded = new Set((await catalystRepo.listDays(sessions.at(-1)!, sessions[0]!)).map((d) => d.date));
    const missing = sessions.filter((d) => !loaded.has(d)).reverse();
    if (missing.length === 0) return { itemsWritten: 0, idle: true, note: "up to date" };

    const stored = new Map((await catalystRepo.listBonds()).map((b) => [b.isin, b]));
    let newest = (await catalystRepo.latestDay())?.date ?? "";
    let written = 0;
    const notes: string[] = [];
    for (const date of missing) {
      const latest = date >= newest;
      const got = await loadDay(date, stored, latest);
      if (!got) {
        notes.push(`${date}: no file yet`);
        continue;
      }
      // Not loaded: the next run looks again (a file renamed before its content was updated).
      if ("holds" in got) {
        notes.push(`${date}: the file holds ${got.holds}`);
        continue;
      }
      written += got.written;
      if (latest) newest = date;
      notes.push(`${date}: ${got.rows} rows, ${got.plan.added.length} new bonds${got.plan.ended.length ? `, ${got.plan.ended.length} ended` : ""}`);
    }
    if (written > 0) await queueCatalyst({ kind: "metrics" });
    return { itemsWritten: written, note: notes.join("; ") };
  });
}
