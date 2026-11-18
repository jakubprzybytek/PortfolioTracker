// Target allocation and rebalancing (road map 8): a target share and a tolerance band per asset class (or per region:
// core/regions), the difference to the actual mix, and the amount per key to buy or sell to get back to the targets.

import { z } from "zod";
import { ASSET_CLASSES, type AssetClass } from "../valuation/history.ts";

/** Targets in % of the total (adding up to 100) and bands in percentage points (± around the target), per key. */
export interface KeyTargets<K extends string> {
  targets: Record<K, number>;
  bands: Record<K, number>;
}
/** Targets per asset class, in % of positions + cash. */
export type Targets = KeyTargets<AssetClass>;

/** The schema of targets per key, as sent by the app: every key's target (0–100, adding up to 100) and band (0–50). */
export function targetsInput<K extends string>(keys: readonly [K, ...K[]]) {
  const perKey = (field: z.ZodNumber) => z.record(z.enum(keys), field);
  return z
    .object({ targets: perKey(z.number().min(0).max(100)), bands: perKey(z.number().min(0).max(50)) })
    .refine((t) => Math.abs(keys.reduce((s, k) => s + t.targets[k], 0) - 100) < 0.005, { message: "The targets must add up to 100%", path: ["targets"] });
}
/** The targets as sent by the app (PUT /targets). */
export const TargetsInput = targetsInput(ASSET_CLASSES);

/** Where a key is: within its band around the target, above it or below it. */
export type TargetStatus = "WITHIN" | "OVER" | "UNDER";

export interface KeyRow<K extends string> {
  key: K;
  value: number;
  /** % of the total. */
  actual: number;
  target: number;
  /** actual − target, in percentage points. */
  diff: number;
  status: TargetStatus;
  /** PLN to buy (+) or sell (−) in this key; with new money, only buys. */
  trade: number;
  /** % of the new total after the trades. */
  after: number;
}

/** A row per asset class (`rebalance`). */
export type TargetRow = Omit<KeyRow<AssetClass>, "key"> & { assetClass: AssetClass };

/** "sell and buy": every class to its target. "new money": the deposit split across the classes below target, nothing sold. */
export type RebalanceMode = "SELL_AND_BUY" | "NEW_MONEY";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Target vs actual per asset class and the trades (`rebalanceBy` over the four classes). */
export function rebalance(byClass: Record<AssetClass, number>, t: Targets, mode: RebalanceMode, newMoney = 0): TargetRow[] {
  return rebalanceBy(ASSET_CLASSES, byClass, t, mode, newMoney).map(({ key, ...r }) => ({ assetClass: key, ...r }));
}

/**
 * Target vs actual per key (asset class, region) and the trades: with SELL_AND_BUY each key goes to its target share
 * of today's total (the sales pay for the buys); with NEW_MONEY `newMoney` goes to the keys furthest below their
 * target first, each filled up to the same fraction of its target share of the new total, so it lands where the gap
 * is biggest, and once every key is at its target the rest is split by the targets.
 */
export function rebalanceBy<K extends string>(keys: readonly K[], values: Record<K, number>, t: KeyTargets<K>, mode: RebalanceMode, newMoney = 0): KeyRow<K>[] {
  const total = keys.reduce((s, k) => s + values[k], 0);
  const add = mode === "NEW_MONEY" ? Math.max(0, newMoney) : 0;
  const after = total + add;
  const share = (k: K) => t.targets[k] / 100;
  const trades = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  if (mode === "SELL_AND_BUY") {
    for (const k of keys) trades[k] = share(k) * total - values[k];
  } else if (add > 0) {
    // Water-filling: find the level λ (a fraction of the target value at the new total) with Σ max(0, λ·target − value) = new money.
    const funded = keys.filter((k) => share(k) > 0);
    const need = (lambda: number) => funded.reduce((s, k) => s + Math.max(0, lambda * share(k) * after - values[k]), 0);
    let lo = 0;
    let hi = Math.max(1, ...funded.map((k) => (values[k] + add) / (share(k) * after)));
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (need(mid) < add) lo = mid;
      else hi = mid;
    }
    for (const k of funded) trades[k] = Math.max(0, hi * share(k) * after - values[k]);
    // Rounding: the trades add up to the deposit exactly (the remainder on the largest buy).
    const sum = funded.reduce((s, k) => s + round2(trades[k]), 0);
    const largest = funded.reduce((a, b) => (trades[b] > trades[a] ? b : a), funded[0]!);
    for (const k of funded) trades[k] = round2(trades[k]);
    if (funded.length) trades[largest] = round2(trades[largest] + add - sum);
  }
  return keys.map((k) => {
    const actual = total ? (values[k] / total) * 100 : 0;
    const diff = actual - t.targets[k];
    const band = t.bands[k];
    return {
      key: k,
      value: values[k],
      actual,
      target: t.targets[k],
      diff,
      status: diff > band + 1e-9 ? "OVER" : diff < -band - 1e-9 ? "UNDER" : "WITHIN",
      trade: round2(trades[k]),
      after: after ? ((values[k] + trades[k]) / after) * 100 : 0,
    };
  });
}
