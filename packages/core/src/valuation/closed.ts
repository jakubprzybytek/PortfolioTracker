import type { IsoDate } from "../dates.ts";
import type { InstrumentItem, TransactionItem } from "../db/items.ts";
import type { Position } from "./positions.ts";

/** A position sold, redeemed or written off in full: what it brought in against what it cost (FIFO). */
export interface ClosedPosition {
  account: string;
  isin: string;
  code: string;
  name: string;
  type: InstrumentItem["type"];
  currency: string;
  /** The first transaction and the last disposal (the day it closed). */
  firstDate: IsoDate;
  closedDate: IsoDate;
  /** Units disposed of over its life (sold out and bought back again: counted each time). */
  quantity: number;
  /** Cash received for them, net of fees (PLN; a write-off brings 0). */
  proceeds: number;
  /** Their cost, fees included (PLN; the same money in and out again counts each time). */
  cost: number;
  /** At its largest: the most units held at once and the most cost held at once (PLN), fees included. */
  peakQuantity: number;
  peakCost: number;
  /** Realised: proceeds − cost (coupons are their own column, as for open positions). */
  gain: number;
  /** The gain against the most it held at once (peakCost). */
  gainPct: number | null;
  couponsReceived: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The positions held no more (quantity 0, at least one disposal), by account then code. Foreign cash (CURRENCY) is
 * cash, not a position, so it's left out.
 */
export function closedPositions(positions: Iterable<Position>, instruments: InstrumentItem[]): ClosedPosition[] {
  const byIsin = new Map(instruments.map((i) => [i.isin, i]));
  const out: ClosedPosition[] = [];
  for (const p of positions) {
    if (p.quantity > 0 || p.realised.length === 0) continue;
    const inst = byIsin.get(p.isin);
    if (inst?.type === "CURRENCY") continue;
    const proceeds = round2(p.realised.reduce((s, r) => s + r.proceeds, 0));
    const cost = round2(p.realised.reduce((s, r) => s + r.cost, 0));
    const gain = round2(proceeds - cost);
    out.push({
      account: p.account,
      isin: p.isin,
      code: inst?.code ?? p.isin,
      name: inst?.name ?? p.isin,
      type: inst?.type ?? "BOND_LISTED",
      currency: inst?.currency ?? "PLN",
      firstDate: p.firstDate,
      closedDate: p.realised.map((r) => r.date).sort().at(-1)!,
      quantity: Math.round(p.realised.reduce((n, r) => n + r.quantity, 0) * 1e6) / 1e6,
      proceeds,
      cost,
      peakQuantity: p.peakQuantity,
      peakCost: p.peakCost,
      gain,
      gainPct: p.peakCost ? round2((gain / p.peakCost) * 100) : null,
      couponsReceived: round2(p.couponsReceived),
    });
  }
  return out.sort((a, b) => a.account.localeCompare(b.account) || a.code.localeCompare(b.code));
}

/** Instruments traded but not held now (none of `held`), each with its first and last transaction dates. */
export function formerInstruments(transactions: TransactionItem[], held: Set<string>): Map<string, { firstDate: IsoDate; lastDate: IsoDate }> {
  const out = new Map<string, { firstDate: IsoDate; lastDate: IsoDate }>();
  for (const t of transactions) {
    if (!t.isin || held.has(t.isin)) continue;
    const d = out.get(t.isin);
    out.set(t.isin, d ? { firstDate: t.date < d.firstDate ? t.date : d.firstDate, lastDate: t.date > d.lastDate ? t.date : d.lastDate } : { firstDate: t.date, lastDate: t.date });
  }
  return out;
}
