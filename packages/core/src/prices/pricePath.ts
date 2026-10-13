// Calculated daily prices for bonds without a market source (foreign government bonds at IBKR): between two known
// prices (your trades, redemption at maturity) the price moves at a constant yield, i.e. geometrically in time.
// Exact for zero-coupon bonds held to maturity; a close approximation otherwise (short bonds, small rate moves).

import { addDays, isWeekend, type IsoDate } from "../dates.ts";

export interface PricePoint {
  date: IsoDate;
  price: number;
}

const days = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** One price per weekday from the first point to the last (both included), oldest first. */
export function interpolatePricePath(points: PricePoint[]): PricePoint[] {
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date)).filter((p, i, all) => i === 0 || p.date !== all[i - 1]!.date);
  if (pts.length === 0) return [];
  const out: PricePoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1];
    if (!b) {
      out.push({ date: a.date, price: a.price });
      break;
    }
    const span = days(a.date, b.date);
    for (let d = a.date; d < b.date; d = addDays(d, 1)) {
      if (d !== a.date && isWeekend(d)) continue;
      const price = a.price * (b.price / a.price) ** (days(a.date, d) / span);
      out.push({ date: d, price: Number(price.toFixed(4)) });
    }
  }
  return out;
}
