import type { IsoDate } from "../dates.ts";
import { dirtyValue, valueBondAtSettlement } from "../bonds/accrued.ts";
import { settlementDate } from "../settlement.ts";
import type { ReferenceIndex } from "../bonds/izIndex.ts";
import { corporateAccrued, quantityHeld, type InterestPeriod } from "../bonds/couponPeriods.ts";
import type { AccountSnapshot, HoldingSnapshot, InstrumentItem, PriceItem, SnapshotItem, TransactionItem } from "../db/items.ts";
import { Ledger } from "./ledger.ts";
import { valueRetailLots } from "./retailLots.ts";
import { rateOn, type FxHistory } from "./fx.ts";
import { round2 } from "../bonds/izIndex.ts";

export interface ValuationContext {
  date: IsoDate;
  instruments: InstrumentItem[];
  transactions: TransactionItem[];
  /** Latest price on or before `date`, per ISIN. */
  prices: Map<string, PriceItem>;
  referenceIndex: ReferenceIndex;
  /** Corporate bonds' interest periods (and floating treasury rates), per ISIN. */
  couponPeriods: Map<string, InterestPeriod[]>;
  /** A price older than this many days is flagged stale (not for manual prices). */
  staleAfterDays?: number;
  /** Account metadata: each account's own currency. */
  accounts?: { account: string; baseCurrency?: string }[];
  /** Latest NBP mid rate on or before `date` per currency (PLN per unit); derived from `fxHistory` when absent. */
  fx?: Map<string, { mid: number; date: IsoDate }>;
  /** All NBP mid rates per currency, oldest first: transactions in another currency count at the rate of the day before. */
  fxHistory?: FxHistory;
  /**
   * The transactions walked forward (a Ledger over `transactions` and `fxHistory`), for valuing many days in date
   * order: each call advances it to `date`. Without one, every call replays all transactions up to `date`.
   */
  ledger?: Ledger;
}

const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Pure valuation of all open positions on one date. */
export function valuePortfolio(ctx: ValuationContext): Omit<SnapshotItem, "PK" | "SK"> {
  const { date, staleAfterDays = 10 } = ctx;
  const byIsin = new Map(ctx.instruments.map((i) => [i.isin, i]));
  const ledger = (ctx.ledger ?? new Ledger(ctx.transactions, ctx.fxHistory)).advanceTo(date);
  const positions = ledger.positions();
  const fxOn = (currency: string) => ctx.fx?.get(currency) ?? rateOn(ctx.fxHistory, currency, date);
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
      ...(p.costNative ? { costNative: p.costNative } : {}),
      ...(inst?.assetClass ? { assetClass: inst.assetClass } : {}),
    };
    if (!inst) flags.push("unknown_instrument");
    if (Number.isNaN(p.cost)) flags.push("no_fx");

    // Retail treasury bonds: no market price; value = Σ lots × nominal with interest (published rates).
    if (inst?.type === "BOND_RETAIL") {
      if (!inst.retail) flags.push("missing_terms");
      const lots = ledger.retailLots(p.account, p.isin);
      const r = inst.retail ? valueRetailLots(inst.retail, lots, date) : undefined;
      const value = r ? r.value : null;
      const gain = value === null ? null : round2(value - p.cost);
      holdings.push({
        ...base,
        cleanPrice: null,
        priceDate: null,
        nominal: r?.nominal ?? null,
        accruedInterest: r?.accruedInterest ?? null,
        valuePerUnit: r?.quantity ? round2(r.value / r.quantity) : null,
        value,
        gain,
        gainPct: gain === null || p.cost === 0 ? null : round2((gain / p.cost) * 100),
        flags: [...flags, ...(r?.flags ?? [])],
        ...(r?.rate ? { rate: r.rate } : {}),
      });
      continue;
    }

    // Foreign currency held in an account (IBKR): one unit is worth one unit of its currency; no price needed.
    const isCurrency = inst?.type === "CURRENCY";
    const price = isCurrency ? undefined : ctx.prices.get(p.isin);
    if (!price) {
      if (!isCurrency) flags.push("no_price");
    } else if (price.venue !== "MANUAL" && daysBetween(price.lastTradeDate ?? price.date, date) > staleAfterDays) flags.push("stale_price");

    let nominal: number | null = null;
    let accruedInterest: number | null = null;
    let valuePerUnit: number | null = null;
    let corporate: ReturnType<typeof corporateAccrued> | undefined;
    let positionValue: number | undefined;

    if (inst?.terms) {
      // Listed treasury bonds: nominal and accrued interest to the settlement day (T+2), as the exchange quotes them.
      const settle = settlementDate(date);
      const periodRate = ctx.couponPeriods.get(p.isin)?.find((c) => c.start <= settle && settle < c.end)?.rate;
      const v = valueBondAtSettlement(inst.terms, date, {
        referenceIndex: ctx.referenceIndex,
        ...(periodRate !== undefined ? { periodRate } : {}),
      });
      if (v.problem) flags.push(v.problem);
      nominal = v.nominal;
      accruedInterest = v.accruedInterest;
      if (price) valuePerUnit = dirtyValue(price.close, v);
    } else if (inst?.nominal) {
      // Corporate bonds: clean price (% of nominal) × nominal, plus accrued interest from the coupon periods; without
      // a rate for the period (or without periods), the clean price alone.
      nominal = inst.nominal;
      // (IBKR bonds come here too: zero-coupon, so the clean price is the whole value.)
      if (inst.type === "BOND_CORPORATE") {
        // To the settlement day (T+2), as Catalyst quotes it.
        corporate = corporateAccrued(ctx.couponPeriods.get(p.isin) ?? [], inst.nominal, date, p.quantity, (day) => quantityHeld(ledger.transactionsOf(p.account, p.isin), p.account, p.isin, day), settlementDate(date));
        if (corporate.total !== null) accruedInterest = round2(corporate.total / p.quantity);
        else flags.push("no_coupon_rate");
      }
      if (price) {
        const clean = Number(((price.close / 100) * inst.nominal).toFixed(6));
        valuePerUnit = round2(clean + (accruedInterest ?? 0));
        // The position's accrued interest is exact (bonds bought after a record day earn nothing that period).
        if (corporate && base.currency === "PLN") positionValue = round2(clean * p.quantity + (corporate.total ?? 0));
      }
    } else if (isCurrency) {
      valuePerUnit = 1;
    } else if (price) {
      valuePerUnit = price.close;
    }

    // Priced in another currency (ETFs): the value per unit in PLN at the NBP mid rate; cost is already in PLN.
    let fx: { rate: number; date: IsoDate } | undefined;
    if (base.currency !== "PLN") {
      const rate = fxOn(base.currency);
      if (!rate) {
        flags.push("no_fx");
        valuePerUnit = null;
      } else {
        fx = { rate: rate.mid, date: rate.date };
        if (valuePerUnit !== null) valuePerUnit = Number((valuePerUnit * rate.mid).toFixed(6));
      }
    }

    const value = valuePerUnit === null ? null : (positionValue ?? round2(valuePerUnit * p.quantity));
    const gain = value === null ? null : round2(value - p.cost);
    holdings.push({
      ...base,
      cleanPrice: price?.close ?? null,
      priceDate: price?.date ?? null,
      ...(price?.quoteTime ? { priceTime: price.quoteTime } : {}),
      nominal,
      accruedInterest,
      valuePerUnit,
      value,
      gain,
      gainPct: gain === null || p.cost === 0 ? null : round2((gain / p.cost) * 100),
      flags,
      ...(fx ? { fx } : {}),
      ...(corporate?.rate ? { rate: corporate.rate } : {}),
      ...(corporate && corporate.total === null ? { noCouponRate: { from: corporate.missingFrom ?? null } } : {}),
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
    const t = byType[h.type] ?? { value: 0, cost: 0 };
    byType[h.type] = t;
    t.value += h.value ?? 0;
    t.cost += h.cost;
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(totals[k]);
  for (const t of Object.values(byType)) {
    t.value = round2(t.value);
    t.cost = round2(t.cost);
  }
  const meta = new Map((ctx.accounts ?? []).map((a) => [a.account, a]));
  const accounts: Record<string, AccountSnapshot> = {};
  let cashTotal = 0;
  for (const [account, byCurrency] of [...ledger.cashByAccount()].sort(([a], [b]) => a.localeCompare(b))) {
    const baseCurrency = meta.get(account)?.baseCurrency;
    // Each currency at the day's NBP rate; the account's cash is their sum in PLN.
    let cash = 0;
    const currencies: NonNullable<AccountSnapshot["currencies"]> = {};
    for (const [currency, amount] of [...byCurrency].sort(([a], [b]) => (a === "PLN" ? -1 : b === "PLN" ? 1 : a.localeCompare(b)))) {
      const rate = fxOn(currency);
      const value = rate ? round2(amount * rate.mid) : null;
      cash += value ?? 0;
      currencies[currency] = { amount, value, ...(currency !== "PLN" && rate ? { rate: rate.mid } : {}) };
    }
    const foreign = [...byCurrency.keys()].some((c) => c !== "PLN");
    accounts[account] = {
      cash: round2(cash),
      ...(foreign ? { currencies } : {}),
      ...(baseCurrency && baseCurrency !== "PLN" ? { baseCurrency } : {}),
    };
    cashTotal += cash;
  }
  return { date, holdings, totals: { ...totals, cash: round2(cashTotal) }, accounts, byType, computedAt: new Date().toISOString() };
}
