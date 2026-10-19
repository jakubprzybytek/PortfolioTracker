// Positions, cash and retail-bond lots walked forward through the transactions once. A revaluation of years of days
// used to replay every transaction up to each day again (days × transactions); a Ledger sorts them once and applies
// only each day's own as the date advances.

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";
import { cashEffects } from "./cash.ts";
import { toPlnD1, type FxHistory } from "./fx.ts";
import { positionKey, type Position, type RealisationPair } from "./positions.ts";
import type { RetailLot } from "./retailLots.ts";

const EPS = 1e-9;
const isDisposal = (t: TransactionItem) => t.type === "SELL" || t.type === "REDEMPTION" || t.type === "WRITE_OFF";
// Within a day: buys first, sales last (a same-day sale of what was just bought, e.g. currency at IBKR, must not be
// clipped to the holding before the buy).
const rank = (t: TransactionItem) => (t.type === "BUY" ? 0 : isDisposal(t) ? 2 : 1);

export class Ledger {
  private readonly sorted: TransactionItem[];
  private next = 0;
  private date: IsoDate | undefined;
  private readonly open = new Map<string, Position>();
  private readonly cash = new Map<string, Map<string, number>>();
  private readonly retail = new Map<string, RetailLot[]>();
  private readonly byPosition = new Map<string, TransactionItem[]>();
  private readonly fx: FxHistory | undefined;

  /** `fx`: NBP rates for amounts in another currency than PLN (at the rate of the day before). */
  constructor(transactions: TransactionItem[], fx?: FxHistory) {
    this.fx = fx;
    this.sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b) || a.id.localeCompare(b.id)));
    for (const t of transactions) {
      if (!t.isin) continue;
      const key = positionKey(t.account, t.isin);
      const list = this.byPosition.get(key);
      if (list) list.push(t);
      else this.byPosition.set(key, [t]);
    }
  }

  /** Applies every transaction up to and including `date`. Dates only go forward. */
  advanceTo(date: IsoDate): this {
    if (this.date !== undefined && date < this.date) throw new Error(`Ledger is at ${this.date}, can't go back to ${date}`);
    this.date = date;
    while (this.next < this.sorted.length && this.sorted[this.next]!.date <= date) this.apply(this.sorted[this.next++]!);
    return this;
  }

  private apply(t: TransactionItem): void {
    const acct = this.cash.get(t.account) ?? new Map<string, number>();
    for (const [c, v] of cashEffects(t)) acct.set(c, (acct.get(c) ?? 0) + v);
    this.cash.set(t.account, acct);
    if (!t.isin) return;

    const isin = t.isin;
    const key = positionKey(t.account, isin);
    const p = this.open.get(key) ?? { account: t.account, isin, quantity: 0, cost: 0, couponsReceived: 0, firstDate: t.date, peakQuantity: 0, peakCost: 0, lots: [], realised: [] };
    const qty = t.quantity ?? 0;
    const currency = t.currency || "PLN";
    const pln = (v: number) => (currency === "PLN" ? v : toPlnD1(v, currency, t.date, this.fx));
    switch (t.type) {
      case "BUY": {
        const paid = -t.amount + (t.fee ?? 0); // amount is negative cash out
        if (qty > 0) p.lots.push({ date: t.date, quantity: qty, cost: pln(paid), costNative: paid, currency });
        break;
      }
      case "SELL":
      case "REDEMPTION":
      case "WRITE_OFF": {
        // A write-off is a disposal for nothing: its remaining cost becomes a realised loss.
        let left = Math.min(qty, p.lots.reduce((n, l) => n + l.quantity, 0));
        const sold = left;
        let cost = 0;
        const pairs: RealisationPair[] = [];
        while (left > EPS && p.lots.length > 0) {
          const lot = p.lots[0]!;
          const take = Math.min(left, lot.quantity);
          const part = lot.cost * (take / lot.quantity);
          cost += part;
          pairs.push({ buyDate: lot.date, quantity: take, cost: part });
          lot.cost -= part;
          lot.costNative -= lot.costNative * (take / lot.quantity);
          lot.quantity -= take;
          left -= take;
          if (lot.quantity <= EPS) p.lots.shift();
        }
        if (sold > 0) {
          // Each pair's cost to the grosz; the last takes the rounding remainder, so they add up to the sale's cost.
          const total = round2(cost);
          let rest = total;
          pairs.forEach((x, i) => {
            x.cost = i === pairs.length - 1 ? round2(rest) : round2(x.cost);
            x.quantity = Math.round(x.quantity * 1e6) / 1e6;
            rest -= x.cost;
          });
          p.realised.push({ id: t.id, type: t.type, date: t.date, quantity: sold, proceeds: round2(pln(t.amount)), cost: total, pairs });
        }
        break;
      }
      case "SPLIT":
        // Every lot gets `ratio` times the units; its cost stays.
        for (const lot of p.lots) lot.quantity = Math.round(lot.quantity * (t.ratio ?? 1) * 1e6) / 1e6;
        break;
      case "COUPON":
      case "INTEREST":
      case "DIVIDEND":
        p.couponsReceived += pln(t.amount);
        break;
      default:
        break;
    }
    p.quantity = Math.round(p.lots.reduce((n, l) => n + l.quantity, 0) * 1e6) / 1e6;
    p.peakQuantity = Math.max(p.peakQuantity, p.quantity);
    p.peakCost = Math.max(p.peakCost, round2(p.lots.reduce((s, l) => s + l.cost, 0)));
    this.open.set(key, p);

    // Retail bonds' lots by purchase date (their interest runs from each lot's own value date); kept for every position.
    const lots = this.retail.get(key) ?? [];
    if (t.type === "BUY" && qty > 0) lots.push({ valueDate: t.valueDate ?? t.date, quantity: qty });
    if (isDisposal(t) && qty > 0) {
      let left = qty;
      while (left > 0 && lots.length > 0) {
        const take = Math.min(left, lots[0]!.quantity);
        lots[0]!.quantity -= take;
        left -= take;
        if (lots[0]!.quantity === 0) lots.shift();
      }
    }
    this.retail.set(key, lots);
  }

  /** Positions per account and ISIN (see positionsAt), as copies: advancing further doesn't change them. */
  positions(): Map<string, Position> {
    const out = new Map<string, Position>();
    for (const [key, p] of this.open) {
      // Fully sold and nothing else to tell: gone. With sales on record it stays (closed, quantity 0) for realised gains.
      if (p.quantity <= 0 && p.couponsReceived === 0 && p.realised.length === 0) continue;
      const copy: Position = { ...p, cost: round2(p.lots.reduce((s, l) => s + l.cost, 0)), lots: p.lots.map((l) => ({ ...l })), realised: [...p.realised] };
      const currencies = new Set(p.lots.map((l) => l.currency));
      const [only] = currencies;
      if (currencies.size === 1 && only !== "PLN") copy.costNative = { amount: round2(p.lots.reduce((s, l) => s + l.costNative, 0)), currency: only! };
      out.set(key, copy);
    }
    return out;
  }

  /** Cash of every account with transactions so far, per currency (see cashByAccount). */
  cashByAccount(): Map<string, Map<string, number>> {
    return new Map([...this.cash].map(([account, byCurrency]) => [account, new Map([...byCurrency].map(([c, v]) => [c, round2(v)]))]));
  }

  /** Open lots of one retail position (see retailLotsAt). */
  retailLots(account: string, isin: string): RetailLot[] {
    return (this.retail.get(positionKey(account, isin)) ?? []).map((l) => ({ ...l }));
  }

  /** Every transaction of one position, whatever its date, in the order given. */
  transactionsOf(account: string, isin: string): TransactionItem[] {
    return this.byPosition.get(positionKey(account, isin)) ?? [];
  }
}
