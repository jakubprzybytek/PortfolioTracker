import { describe, expect, it } from "vitest";
import { MAX_TICKS, finite, stepTicks } from "../src/ticks.ts";
import { amountAxis } from "../src/useNarrow.ts";

describe("stepTicks", () => {
  it("round ticks over the range, the first step that fits", () => {
    expect(stepTicks(-3, 12, [1, 2, 5, 10], 5)).toEqual({ step: 5, ticks: [-5, 0, 5, 10, 15] });
    expect(stepTicks(95, 140, [0.5, 1, 2, 5, 10, 20, 25, 50, 100], 5).ticks).toEqual([90, 100, 110, 120, 130, 140]);
  });

  it("an infinite bound (a division by 0 upstream): no ticks, at once, instead of a loop that never ends", () => {
    expect(stepTicks(90, Number.POSITIVE_INFINITY, [1, 2, 5], 5).ticks).toEqual([]);
    expect(stepTicks(Number.NaN, 10, [1, 2, 5], 5).ticks).toEqual([]);
  });

  it(`never more than ${MAX_TICKS + 1} ticks: a step too small for the range is widened`, () => {
    expect(stepTicks(0, 1e9, [1, 2, 5], 5).ticks.length).toBeLessThanOrEqual(MAX_TICKS + 1);
  });

  it("finite() keeps the numbers a chart can place", () => {
    expect(finite([1, null, Number.POSITIVE_INFINITY, undefined, Number.NaN, 2])).toEqual([1, 2]);
  });
});

describe("amountAxis on values a hair apart", () => {
  it("returns at once, a handful of ticks around the value (the step can't fall below a millionth of it)", () => {
    const started = Date.now();
    const a = amountAxis([72_000, 72_000.000001]);
    expect(Date.now() - started).toBeLessThan(100);
    expect(a.ticks.length).toBeGreaterThanOrEqual(2);
    expect(a.ticks.length).toBeLessThanOrEqual(MAX_TICKS + 1);
    expect(a.domain[0]).toBeLessThanOrEqual(72_000);
    expect(a.domain[1]).toBeGreaterThanOrEqual(72_000.000001);
  });
});
