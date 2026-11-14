// Round ticks for a chart's value axis, safe on any data: the charts' tick loops ran from the lowest value to the
// highest by a step, and on an infinite value (a benchmark divided by a first value of 0) or two values a hair apart
// (a step too small to move a large number) they never ended, freezing the page (Performance E2E on int, 2026-11-14).

/** Ticks at most: a step that would give more is widened. */
export const MAX_TICKS = 50;

/**
 * Ticks from `lo` down to `hi` up by the first of `steps` that gives at most `fit` intervals (else the last step, then
 * widened by tens until within MAX_TICKS). Non-finite bounds: no ticks.
 */
export function stepTicks(lo: number, hi: number, steps: number[], fit: number): { step: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return { step: 1, ticks: [] };
  let step = steps.find((s) => (hi - lo) / s <= fit) ?? steps.at(-1)!;
  while ((hi - lo) / step > MAX_TICKS) step *= 10;
  const from = Math.floor(lo / step) * step;
  const to = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i <= MAX_TICKS; i++) {
    const v = from + i * step;
    if (v > to + step * 1e-6) break;
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return { step, ticks };
}

/** The finite values only (a chart's bounds come from these). */
export const finite = (values: (number | null | undefined)[]): number[] => values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
