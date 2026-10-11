import type { IsoDate } from "../dates.ts";
import { dirtyValue, valueBond } from "../bonds/accrued.ts";
import type { ReferenceIndex } from "../bonds/izIndex.ts";
import type { AccountSnapshot, CouponRateItem, HoldingSnapshot, InstrumentItem, PriceItem, SnapshotItem, TransactionItem } from "../db/items.ts";
import { positionsAt } from "./positions.ts";
import { retailLotsAt, valueRetailLots } from "./retailLots.ts";
import { cashByAccount } from "./cash.ts";
import { round2 } from "../bonds/izIndex.ts";

export interface ValuationContext {
  date: IsoDate;
  instruments: InstrumentItem[];
  transactions: TransactionItem[];
  /** Latest price on or before `date`, per ISIN. */
  prices: Map<string, PriceItem>;
  referenceIndex: ReferenceIndex;
  couponRates: Map<string, CouponRateItem[]>;
  /** A price older than this many days is flagged stale (not for manual prices). */
  staleAfterDays?: number;
  /** Account metadata: which accounts aren't fully tracked yet. */
  accounts?: { account: string; incomplete?: string[] }[];
}

const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Pure valuation of all open positions on one date. */
export function valuePortfolio(ctx: ValuationContext): Omit<SnapshotItem, "PK" | "SK"> {
  const { date, staleAfterDays = 10 } = ctx;
  const byIsin = new Map(ctx.instruments.map((i) => [i.isin, i]));
  const positions = positionsAt(ctx.transactions, date);
  const holdings: HoldingSnapshot[] = [];

  for (const p of positions.values()) {
    if (p.quantity <= 0) continue;
    const inst = byIsin.get(p.isin);
    const flags: string[] = [];
    const base = {
      account: p.account,
      isin: p.isin,
      code: inst?.code ?? p.isin,
      name: inst?.name ?? p.isin,
      type: inst?.type ?? ("BOND_LISTED" as const),
      currency: inst?.currency ?? "PLN",
      quantity: p.quantity,
      cost: p.cost,
      couponsReceived: round2(p.couponsReceived),
    };
    if (!inst) flags.push("unknown_instrument");

    // Retail treasury bonds: no market price; value = Σ lots × nominal with interest (published rates).
    if (inst?.type === "BOND_RETAIL") {
      if (!inst.retail) flags.push("missing_terms");
      const lots = retailLotsAt(ctx.transactions.filter((t) => t.account === p.account && t.isin === p.isin), date);
      const r = inst.retail ? valueRetailLots(inst.retail, lots, date) : undefined;
      const value = r ? r.value : null;
      const gain = value === null ? null : round2(value - p.cost);
      holdings.push({
        ...base,
        cleanPrice: null,
        priceDate: null,
        nominal: r?.nominal ?? null,
        accruedInterest: r?.accruedInterest ?? null,
        valuePerUnit: r && r.quantity ? round2(r.value / r.quantity) : null,
        value,
        gain,
        gainPct: gain === null || p.cost === 0 ? null : round2((gain / p.cost) * 100),
        flags: [...flags, ...(r?.flags ?? [])],
        ...(r?.rate ? { rate: r.rate } : {}),
      });
      continue;
    }

    const price = ctx.prices.get(p.isin);
    if (!price) flags.push("no_price");
    else if (price.venue !== "MANUAL" && daysBetween(price.lastTradeDate ?? price.date, date) > staleAfterDays) flags.push("stale_price");

    let nominal: number | null = null;
    let accruedInterest: number | null = null;
    let valuePerUnit: number | null = null;

    if (inst?.terms) {
      const periodRate = ctx.couponRates.get(p.isin)?.find((c) => c.periodStart <= date && date < c.periodEnd)?.rate;
      const v = valueBond(inst.terms, date, {
        referenceIndex: ctx.referenceIndex,
        ...(periodRate !== undefined ? { periodRate } : {}),
      });
      if (v.problem) flags.push(v.problem);
      nominal = v.nominal;
      accruedInterest = v.accruedInterest;
      if (price) valuePerUnit = dirtyValue(price.close, v);
    } else if (price) {
      valuePerUnit = price.close;
    }

    const value = valuePerUnit === null ? null : round2(valuePerUnit * p.quantity);
    const gain = value === null ? null : round2(value - p.cost);
    holdings.push({
      ...base,
      cleanPrice: price?.close ?? null,
      priceDate: price?.date ?? null,
      nominal,
      accruedInterest,
      valuePerUnit,
      value,
      gain,
      gainPct: gain === null || p.cost === 0 ? null : round2((gain / p.cost) * 100),
      flags,
    });
  }

  holdings.sort((a, b) => a.account.localeCompare(b.account) || a.code.localeCompare(b.code));
  const totals = { value: 0, cost: 0, gain: 0, couponsReceived: 0 };
  const byType: Record<string, { value: number; cost: number }> = {};
  for (const h of holdings) {
    totals.value += h.value ?? 0;
    totals.cost += h.cost;
    totals.gain += h.gain ?? 0;
    totals.couponsReceived += h.couponsReceived;
    const t = (byType[h.type] ??= { value: 0, cost: 0 });
    t.value += h.value ?? 0;
    t.cost += h.cost;
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(totals[k]);
  for (const t of Object.values(byType)) {
    t.value = round2(t.value);
    t.cost = round2(t.cost);
  }
  const incomplete = new Map((ctx.accounts ?? []).map((a) => [a.account, a.incomplete ?? []]));
  const accounts: Record<string, AccountSnapshot> = {};
  let cashTotal = 0;
  for (const [account, cash] of [...cashByAccount(ctx.transactions, date)].sort(([a], [b]) => a.localeCompare(b))) {
    const missing = incomplete.get(account) ?? [];
    accounts[account] = { cash, ...(missing.length ? { incomplete: missing } : {}) };
    // An incomplete account's cash misses the untracked purchases (it would be far too high): not in the total.
    if (missing.length === 0) cashTotal += cash;
  }
  return { date, holdings, totals: { ...totals, cash: round2(cashTotal) }, accounts, byType, computedAt: new Date().toISOString() };
}
