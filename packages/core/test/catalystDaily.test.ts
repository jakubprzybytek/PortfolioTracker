import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planDailyFile, recentSessions } from "../src/catalyst/daily.ts";
import { catalystKeys, type CatalystBondItem } from "../src/catalyst/items.ts";
import { parseCatalystDailyFile } from "../src/gpw/catalystDailyFile.ts";

const file = parseCatalystDailyFile(readFileSync(new URL("fixtures/catalyst/catalyst_20261104.xlsx", import.meta.url)));
const AT = "2026-11-04T18:30:00.000Z";

const bond = (b: Partial<CatalystBondItem> & { isin: string; code: string }): CatalystBondItem => ({
  ...catalystKeys.bond(b.isin),
  GSI1PK: "BOND",
  GSI1SK: b.code,
  segment: "corporate",
  currency: "PLN",
  markets: ["GPW ASO"],
  maturity: null,
  nominal: 1000,
  status: "listed",
  firstSeen: "2026-01-02",
  lastSeen: "2026-11-03",
  updatedAt: AT,
  ...b,
});

describe("planDailyFile", () => {
  it("into an empty table: a session per bond and market, every bond new, listed, first and last seen that day", () => {
    const plan = planDailyFile(file, new Map(), AT, true);
    expect(plan.sessions).toHaveLength(file.rows.length);
    const isins = new Set(file.rows.map((r) => r.isin));
    expect(plan.bonds).toHaveLength(isins.size);
    expect(plan.added).toHaveLength(isins.size);
    expect(plan.ended).toEqual([]);
    expect(plan.sessions.find((s) => s.isin === "PLARCHE00062")).toMatchObject({ date: "2026-11-04", market: "GPW ASO", close: 100.9, trades: 2, turnover: 18300, rate: 0.0824, source: "gpwcatalyst-daily", fetchedAt: AT });
    // A treasury bond on GPW and BondSpot: one bond, both markets, its GPW row's fields.
    const ds = plan.bonds.find((b) => b.code === "DS0432")!;
    expect(ds).toMatchObject({ segment: "treasury", markets: ["BS RR", "GPW RR"], maturity: "2032-04-25", nominal: 1000, status: "listed", firstSeen: "2026-11-04", lastSeen: "2026-11-04" });
    expect(plan.sessions.filter((s) => s.isin === ds.isin).map((s) => s.market).sort()).toEqual(["BS RR", "GPW RR"]);
  });

  it("updates what the newer file changes (the nominal after an instalment), leaves unchanged bonds alone", () => {
    const ach = file.rows.find((r) => r.code === "ACH0427")!;
    const abe = file.rows.find((r) => r.code === "ABE0227")!;
    const stored = new Map([
      [ach.isin, bond({ isin: ach.isin, code: "ACH0427", nominal: 1000, maturity: "2027-04-02", markets: ["GPW ASO"], lastSeen: "2026-11-03" })],
      [abe.isin, bond({ isin: abe.isin, code: "ABE0227", nominal: 9000, maturity: "2027-02-18", markets: ["GPW ASO"], lastSeen: "2026-11-03" })],
    ]);
    const plan = planDailyFile(file, stored, AT, true);
    expect(plan.added).not.toContain(ach.isin);
    expect(plan.bonds.find((b) => b.isin === abe.isin)).toMatchObject({ nominal: 10000, lastSeen: "2026-11-04", firstSeen: "2026-01-02" });
    expect(plan.bonds.find((b) => b.isin === ach.isin)).toMatchObject({ lastSeen: "2026-11-04" });

    // The same file again: nothing changes.
    const again = new Map(plan.bonds.map((b) => [b.isin, bond(b)]));
    const second = planDailyFile(file, again, AT, true);
    expect(second.bonds.filter((b) => again.has(b.isin))).toEqual([]);
  });

  it("the latest session ends the listed bonds missing from it; an older file doesn't", () => {
    const gone = bond({ isin: "PLGONE000017", code: "GON1126", lastSeen: "2026-11-03" });
    const stored = new Map([[gone.isin, gone]]);
    expect(planDailyFile(file, stored, AT, true).ended).toEqual(["PLGONE000017"]);
    expect(planDailyFile(file, stored, AT, true).bonds.find((b) => b.isin === gone.isin)?.status).toBe("ended");
    expect(planDailyFile(file, stored, AT, false).ended).toEqual([]);
  });

  it("a backfilled file: bonds seen for the first time have ended there (the backfill goes back from the newest day)", () => {
    const plan = planDailyFile(file, new Map(), AT, false);
    expect(new Set(plan.bonds.map((b) => b.status))).toEqual(new Set(["ended"]));
    expect(plan.bonds[0]).toMatchObject({ firstSeen: "2026-11-04", lastSeen: "2026-11-04" });
  });

  it("a backfilled day newer than a stored ended bond's last session keeps it ended (only the newest session lists)", () => {
    const ach = file.rows.find((r) => r.code === "ACH0427")!;
    const stored = new Map([[ach.isin, bond({ isin: ach.isin, code: "ACH0427", status: "ended", firstSeen: "2026-10-01", lastSeen: "2026-10-30" })]]);
    expect(planDailyFile(file, stored, AT, false).bonds.find((b) => b.isin === ach.isin)).toMatchObject({ status: "ended", lastSeen: "2026-11-04" });
    expect(planDailyFile(file, stored, AT, true).bonds.find((b) => b.isin === ach.isin)).toMatchObject({ status: "listed", lastSeen: "2026-11-04" });
  });

  it("an older file only widens the first session, never overwrites newer fields", () => {
    const ach = file.rows.find((r) => r.code === "ACH0427")!;
    const stored = new Map([[ach.isin, bond({ isin: ach.isin, code: "ACH0427", nominal: 500, firstSeen: "2026-11-05", lastSeen: "2026-11-06" })]]);
    expect(planDailyFile(file, stored, AT, false).bonds.find((b) => b.isin === ach.isin)).toMatchObject({ nominal: 500, firstSeen: "2026-11-04", lastSeen: "2026-11-06", status: "listed" });
  });
});

describe("recentSessions", () => {
  it("the trading sessions back from today, newest first, skipping weekends and Polish holidays", () => {
    expect(recentSessions("2026-11-12", 4)).toEqual(["2026-11-12", "2026-11-10", "2026-11-09", "2026-11-06"]); // 11 November: holiday
    expect(recentSessions("2026-11-08", 2)).toEqual(["2026-11-06", "2026-11-05"]); // Sunday
  });
});
