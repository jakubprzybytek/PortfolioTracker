import { describe, expect, it } from "vitest";
import { planBatch } from "../src/catalyst/messages.ts";

describe("planBatch", () => {
  it("runs each backfill range in order and the metrics once, whatever how many asked", () => {
    const plan = planBatch([
      JSON.stringify({ kind: "metrics" }),
      JSON.stringify({ kind: "backfill", from: "2026-10-01", to: "2026-10-31" }),
      JSON.stringify({ kind: "metrics" }),
      JSON.stringify({ kind: "backfill", from: "2026-09-01", to: "2026-09-30" }),
    ]);
    expect(plan).toEqual({ backfills: [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-09-01", to: "2026-09-30" }], metrics: true, invalid: [] });
  });

  it("sets malformed requests apart", () => {
    const plan = planBatch(["not json", JSON.stringify({ kind: "backfill", from: "2026-10-01" }), JSON.stringify({ kind: "other" })]);
    expect(plan.backfills).toEqual([]);
    expect(plan.metrics).toBe(false);
    expect(plan.invalid).toHaveLength(3);
  });
});
