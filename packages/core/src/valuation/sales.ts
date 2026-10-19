// The list of sales (road map 9): every sale, redemption and write-off with the buys FIFO matched it against, and per
// year the PIT-38 summary (proceeds, costs, profit in PLN at NBP D-1).

import { daysBetween, type IsoDate } from "../dates.ts";
import type { InstrumentItem } from "../db/items.ts";
import { isTaxFreeAccount } from "../bonds/couponPeriods.ts";
import type { Position, Realisation } from "./positions.ts";

/** The part of a sale taken from one buy: its share of the proceeds (by units) against its cost. */
export interface SalePair {
  buyDate: IsoDate;
  quantity: number;
  cost: number;
  proceeds: number;
  gain: number;
  /** Days from the buy to the sale. */
  days: number;
}

export interface Sale {
  /** The transaction. */
  id: string;
  type: Realisation["type"];
  account: string;
  isin: string;
  code: string;
  name: string;
  instrumentType: InstrumentItem["type"];
  date: IsoDate;
  quantity: number;
  /** Net of the fee, PLN (another currency at NBP D-1); a write-off brings 0. */
  proceeds: number;
  /** FIFO cost of the units, the buys' fees included, PLN. */
  cost: number;
  gain: number;
  /** The gain against the cost. */
  gainPct: number | null;
  /** In the PIT-38 summary; if not, why (`notPit`). */
  pit: boolean;
  notPit?: string;
  pairs: SalePair[];
}

/** One tax year of PIT-38: the sales and redemptions in it, outside IKE/IKZE. */
export interface PitYear {
  year: number;
  count: number;
  proceeds: number;
  cost: number;
  gain: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Why a disposal stays out of PIT-38, or undefined when it's in. */
function notPit(account: string, type: Realisation["type"], instrumentType: InstrumentItem["type"]): string | undefined {
  if (isTaxFreeAccount(account)) return "IKE/IKZE";
  if (type === "WRITE_OFF") return "write-off";
  // The interest of a retail treasury bond is taxed at source when it's redeemed (or redeemed early).
  if (instrumentType === "BOND_RETAIL") return "retail bond, taxed at source";
  return undefined;
}

/**
 * Every disposal (sale, redemption, write-off) of the positions, newest first, with its FIFO pairs: each pair's share
 * of the proceeds goes by its units, the last pair taking the rounding remainder. Foreign cash (CURRENCY) is cash, not
 * a position, so its exchanges are left out.
 */
export function salesOf(positions: Iterable<Position>, instruments: InstrumentItem[]): Sale[] {
  const byIsin = new Map(instruments.map((i) => [i.isin, i]));
  const out: Sale[] = [];
  for (const p of positions) {
    const inst = byIsin.get(p.isin);
    if (inst?.type === "CURRENCY") continue;
    const instrumentType = inst?.type ?? "BOND_LISTED";
    for (const r of p.realised) {
      let rest = r.proceeds;
      const pairs = r.pairs.map((x, i): SalePair => {
        const proceeds = i === r.pairs.length - 1 ? round2(rest) : round2((r.proceeds * x.quantity) / r.quantity);
        rest -= proceeds;
        return { buyDate: x.buyDate, quantity: x.quantity, cost: x.cost, proceeds, gain: round2(proceeds - x.cost), days: daysBetween(x.buyDate, r.date) };
      });
      const gain = round2(r.proceeds - r.cost);
      const why = notPit(p.account, r.type, instrumentType);
      out.push({
        id: r.id,
        type: r.type,
        account: p.account,
        isin: p.isin,
        code: inst?.code ?? p.isin,
        name: inst?.name ?? p.isin,
        instrumentType,
        date: r.date,
        quantity: r.quantity,
        proceeds: r.proceeds,
        cost: r.cost,
        gain,
        gainPct: r.cost ? round2((gain / r.cost) * 100) : null,
        pit: !why,
        ...(why ? { notPit: why } : {}),
        pairs,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.account.localeCompare(b.account) || a.code.localeCompare(b.code));
}

/** Per year (newest first), the sales in PIT-38: their count, proceeds, costs and profit. */
export function pitYears(sales: Sale[]): PitYear[] {
  const by = new Map<number, PitYear>();
  for (const s of sales) {
    if (!s.pit) continue;
    const year = Number(s.date.slice(0, 4));
    const y = by.get(year) ?? { year, count: 0, proceeds: 0, cost: 0, gain: 0 };
    y.count++;
    y.proceeds += s.proceeds;
    y.cost += s.cost;
    by.set(year, y);
  }
  return [...by.values()]
    .map((y) => ({ ...y, proceeds: round2(y.proceeds), cost: round2(y.cost), gain: round2(y.proceeds - y.cost) }))
    .sort((a, b) => b.year - a.year);
}
