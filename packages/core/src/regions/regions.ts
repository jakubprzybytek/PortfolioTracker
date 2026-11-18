// Regional exposure of the shares (road map 8, regions): each equity fund's split across world regions, typed by hand
// from the issuer's factsheet (a single-region fund is 100% one region; a global one like FTSE All-World is split),
// summed over the holdings, with targets per region and the same rebalancing as the asset mix (core/targets).
// Pure functions, no AWS imports: the web app imports this file directly (`@portfolio/core/regions/regions`).

import { z } from "zod";
import type { IsoDate } from "../dates.ts";
import type { HoldingSnapshot } from "../db/items.ts";
import { type KeyTargets, targetsInput } from "../targets/targets.ts";
import { assetClassOf } from "../valuation/history.ts";

/** The regions, in display order: the ones the funds held cover; OTHER is the rest of a global fund (Canada, Australia, Hong Kong…). */
export const REGIONS = ["US", "EUROPE", "JAPAN", "EM", "OTHER"] as const;
export type Region = (typeof REGIONS)[number];

/** A fund's split across the regions, in % adding up to 100; regions it has none of are left out. */
export type RegionWeights = Partial<Record<Region, number>>;

/** A fund's regions as sent by the app (PUT /instruments/{isin}/regions): 0–100 each, adding up to 100. */
export const RegionWeightsInput = z
  .partialRecord(z.enum(REGIONS), z.number().min(0).max(100))
  .refine((w) => Math.abs(REGIONS.reduce((s, k) => s + (w[k] ?? 0), 0) - 100) < 0.005, { message: "The regions must add up to 100%" });

/** Weights without the zero regions. */
export const compactWeights = (w: RegionWeights): RegionWeights => Object.fromEntries(REGIONS.filter((k) => (w[k] ?? 0) > 0).map((k) => [k, w[k]])) as RegionWeights;

/** Target share and band per region, in % of the shares that have regions. */
export type RegionTargets = KeyTargets<Region>;
export const RegionTargetsInput = targetsInput(REGIONS);

/** A fund's regions as kept on the instrument: the weights and the day they were typed (to see when they're due again). */
export interface FundRegions {
  regions: RegionWeights;
  regionsAsOf: IsoDate;
}

/** One equity fund in the exposure: its value over all accounts and its regions (none: not set yet). */
export interface FundExposure {
  isin: string;
  code: string;
  name: string;
  value: number;
  regions?: RegionWeights;
  regionsAsOf?: IsoDate;
}

export interface RegionExposure {
  /** Value per region, from the funds with regions. */
  byRegion: Record<Region, number>;
  /** Sum of byRegion: the shares with regions. */
  total: number;
  /** The equity funds, largest first. */
  funds: FundExposure[];
  /** Value of the funds without regions (left out of byRegion). */
  unassigned: number;
}

/**
 * The shares' regional exposure from a snapshot's holdings: the holdings in the shares class (bond ETFs and everything
 * else left out; a class set by hand counts), one fund per ISIN over all accounts, each split by its regions.
 */
export function regionExposure(holdings: readonly HoldingSnapshot[], regionsOf: (isin: string) => FundRegions | undefined): RegionExposure {
  const funds = new Map<string, FundExposure>();
  for (const h of holdings) {
    if (!h.value || assetClassOf(h) !== "SHARES") continue;
    const f = funds.get(h.isin);
    if (f) f.value += h.value;
    else {
      const r = regionsOf(h.isin);
      funds.set(h.isin, { isin: h.isin, code: h.code, name: h.name, value: h.value, ...(r ? { regions: r.regions, regionsAsOf: r.regionsAsOf } : {}) });
    }
  }
  const byRegion = Object.fromEntries(REGIONS.map((k) => [k, 0])) as Record<Region, number>;
  let unassigned = 0;
  for (const f of funds.values()) {
    if (!f.regions) {
      unassigned += f.value;
      continue;
    }
    for (const k of REGIONS) byRegion[k] += (f.value * (f.regions[k] ?? 0)) / 100;
  }
  return {
    byRegion,
    total: REGIONS.reduce((s, k) => s + byRegion[k], 0),
    funds: [...funds.values()].sort((a, b) => b.value - a.value),
    unassigned,
  };
}
