// The Catalyst daily file (Docs/catalyst.md, "Jobs"): every session of the last week not loaded yet, oldest first.
// Each file is archived, then its sessions and the bonds it changes are written, and the day marked loaded; the
// latest one also ends the bonds that left the market. Then the metrics are queued. Evenings after the session, and
// a morning recheck (which skips today: its file comes after the close).

import { catalystKeys, DAILY_FILE_SOURCE, planDailyFile, recentSessions, type CatalystBondItem } from "@portfolio/core/catalyst/index";
import { parseCatalystDailyFile, today } from "@portfolio/core";
import { archiveRaw, runJob } from "../../lib/context.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { fetchDailyFile } from "../gpwCatalyst.ts";

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
      const got = await fetchDailyFile(date);
      if (!got) {
        notes.push(`${date}: no file yet`);
        continue;
      }
      const fetchedAt = new Date().toISOString();
      await archiveRaw(DAILY_FILE_SOURCE, date, got.fileName, got.content);
      const file = parseCatalystDailyFile(got.content);
      if (file.date !== date) throw new Error(`${got.fileName} is the file of ${file.date}`);
      const latest = date >= newest;
      const plan = planDailyFile(file, stored, fetchedAt, latest);
      written += (await catalystRepo.putSessions(plan.sessions)) + (await catalystRepo.putBonds(plan.bonds));
      const updatedAt = new Date().toISOString();
      for (const b of plan.bonds) stored.set(b.isin, { ...catalystKeys.bond(b.isin), GSI1PK: "BOND", GSI1SK: b.code, ...b, updatedAt } satisfies CatalystBondItem);
      await catalystRepo.putDay({ date, rows: file.rows.length, bonds: new Set(file.rows.map((r) => r.isin)).size, file: got.fileName, fetchedAt });
      if (latest) newest = date;
      notes.push(`${date}: ${file.rows.length} rows, ${plan.added.length} new bonds${plan.ended.length ? `, ${plan.ended.length} ended` : ""}`);
    }
    if (written > 0) await queueCatalyst({ kind: "metrics" });
    return { itemsWritten: written, note: notes.join("; ") };
  });
}
