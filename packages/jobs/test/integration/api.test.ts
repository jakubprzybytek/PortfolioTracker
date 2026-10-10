import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { HoldingSnapshot, SnapshotItem } from "@portfolio/core";
import { API, get, repoRoot, uploadImport, waitFor } from "./setup.ts";

const IZ = "PL0000117024";
const DS = "PL0000113783";

interface InstrumentOut {
  isin: string;
  code: string;
  terms?: { couponType: string };
  backfill?: { status: string; rows?: number; from?: string; to?: string };
}

describe(`API ${API}`, () => {
  beforeAll(async () => {
    // Seed, in dependency order; every import is idempotent, so re-running on a seeded stage is safe.
    // 1. MF calculator (reference index + bond terms) — instruments with terms "mf" need it first.
    const mfKey = await uploadImport("mf-calculator", "kalkulatorodsetek.xlsm", readFileSync(path.join(repoRoot, "packages/core/test/fixtures/kalkulatorodsetek.xlsm")));
    await waitFor(async () => {
      const r = await get<{ jobs: Record<string, { status: string; note?: string; finishedAt?: string } | null> }>("/status");
      const run = r.body.jobs["import"];
      return run?.status === "ok" && run.note?.includes(mfKey) ? true : undefined;
    }, 180_000);
    // 2. Instruments: starts the GPW history backfill; wait for it so the valuation sees prices and names.
    await uploadImport("instruments", "instruments.json", readFileSync(path.join(repoRoot, "data/instruments.json")));
    await waitFor(async () => {
      const inst = await get<InstrumentOut[]>("/instruments");
      const ok = inst.status === 200 && [IZ, DS].every((i) => inst.body.find((x) => x.isin === i)?.backfill?.status === "done");
      return ok ? true : undefined;
    }, 240_000);
    // 3. Transactions: triggers the valuation. Wait for a snapshot that knows both instruments.
    await uploadImport("transactions", "sample.json", readFileSync(path.join(repoRoot, "data/transactions.sample.json")));
    await waitFor(async () => {
      const r = await get<SnapshotItem>("/holdings");
      if (r.status !== 200) return undefined;
      const codes = new Set(r.body.holdings.map((h) => h.code));
      const clean = r.body.holdings.every((h) => !h.flags.includes("unknown_instrument") && !h.flags.includes("no_price"));
      return codes.has("DS0432") && codes.has("IZ0836") && clean ? true : undefined;
    }, 180_000);
  });

  it("GET /status lists the last run of every job", async () => {
    const { status, body } = await get<{ now: string; jobs: Record<string, unknown> }>("/status");
    expect(status).toBe(200);
    expect(Object.keys(body.jobs).sort()).toEqual(["backfill", "eod-gpw", "eod-gpw-recheck", "import", "monthly", "valuation"]);
    expect(body.jobs["import"]).toMatchObject({ status: "ok" });
  });

  it("GET /instruments returns the tracked bonds with terms and a finished backfill", async () => {
    const { status, body } = await get<InstrumentOut[]>("/instruments");
    expect(status).toBe(200);
    const iz = body.find((i) => i.isin === IZ)!;
    const ds = body.find((i) => i.isin === DS)!;
    expect(iz).toMatchObject({ code: "IZ0836", terms: { couponType: "INDEXED" }, backfill: { status: "done", from: "2024-06-24" } });
    expect(ds).toMatchObject({ code: "DS0432", terms: { couponType: "FIXED" }, backfill: { status: "done", from: "2021-06-16" } });
    expect(ds.backfill!.rows!).toBeGreaterThanOrEqual(1334);
    expect(body.some((i) => i.isin === "MF-TERMS")).toBe(false);
  });

  it("GET /instruments/{isin}/prices returns daily clean prices in range, sorted", async () => {
    const { status, body } = await get<{ date: string; close: number; traded: boolean; lastTradeDate?: string }[]>(
      `/instruments/${IZ}/prices?from=2026-10-05&to=2026-10-09`,
    );
    expect(status).toBe(200);
    expect(body.map((p) => p.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(body.at(-1)).toMatchObject({ close: 87.92, traded: true, lastTradeDate: "2026-10-09" });
  });

  it("GET /holdings values the sample portfolio with accrued interest and IZ indexation", async () => {
    const snap = await waitFor(async () => {
      const r = await get<SnapshotItem>("/holdings");
      return r.status === 200 && r.body.holdings.length >= 2 ? r.body : undefined;
    });
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const by = Object.fromEntries(snap.holdings.map((h) => [h.code, h])) as Record<string, HoldingSnapshot>;
    expect(by["DS0432"]).toMatchObject({ quantity: 20, nominal: 1000, cost: 15931.8, couponsReceived: 700 });
    expect(by["IZ0836"]).toMatchObject({ quantity: 10, cost: 9561.54, couponsReceived: 214.2 });
    expect(by["IZ0836"]!.nominal!).toBeGreaterThan(1100);
    for (const h of [by["DS0432"]!, by["IZ0836"]!]) {
      expect(h.cleanPrice).not.toBeNull();
      expect(h.accruedInterest).not.toBeNull();
      expect(h.value).toBeCloseTo(h.valuePerUnit! * h.quantity, 1);
      expect(h.flags).not.toContain("no_price");
      expect(h.flags).not.toContain("unknown_instrument");
    }
    expect(snap.totals.value).toBeCloseTo(by["DS0432"]!.value! + by["IZ0836"]!.value!, 1);
  });

  it("GET /portfolio/history returns one snapshot per day since the first transaction", async () => {
    const { status, body } = await get<{ date: string; totals: { value: number } }[]>("/portfolio/history?from=2025-02-01&to=2025-02-10");
    expect(status).toBe(200);
    expect(body.map((s) => s.date)).toEqual(["2025-02-03", "2025-02-04", "2025-02-05", "2025-02-06", "2025-02-07", "2025-02-08", "2025-02-09", "2025-02-10"]);
    expect(body[0]!.totals.value).toBe(0); // deposit only
    expect(body[2]!.totals.value).toBeGreaterThan(15000); // after the DS0432 buy
  });

  it("GET /instruments/{isin}/transactions filters by ISIN", async () => {
    const { status, body } = await get<{ isin: string; type: string }[]>(`/instruments/${DS}/transactions`);
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(3);
    expect(body.every((t) => t.isin === DS)).toBe(true);
  });

  it("rejects bad input", async () => {
    expect((await get("/instruments/not-an-isin/prices")).status).toBe(400);
    expect((await get("/nope")).status).toBe(404);
  });
});
