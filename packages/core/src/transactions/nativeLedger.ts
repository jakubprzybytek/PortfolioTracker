// An account kept in several currencies (IBKR), from the reference sheet's PLN-only records.
//
// The sheet books everything in PLN: foreign cash is a position bought and sold with PLN ("Waluty_EUR"), and a
// trade paid in EUR becomes two rows of equal PLN value (the trade, and a sale of the EUR that paid for it, often
// "Transakcja dodana automatycznie"). Here each day's rows are paired back into what really happened:
//   trade or fee + sale of currency for the same PLN   → the trade or fee in that currency
//   sale of a security + purchase of currency          → the sale in that currency
//   sale of one currency + purchase of another         → EXCHANGE between them
//   purchase of currency with PLN (or sale for PLN)    → EXCHANGE with PLN
// Anything left keeps its PLN booking. Cash per currency ends up as the sheet's currency positions held.

import type { TransactionInput } from "./schema.ts";

/** Same PLN value: the sheet rounds each row to the grosz. */
const TOLERANCE = 0.021;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
/** Currency amounts: the sheet keeps fractions of a cent (0.0106022 EUR); summed, they give the balance. */
const units6 = (v: number) => round(v, 6);

/** PLN cash effect of a sheet-derived row (buy: amount and fee out; sell: the amount, net of the fee, in). */
const plnFlow = (t: TransactionInput) => (t.type === "BUY" ? t.amount - (t.fee ?? 0) : t.amount);

/**
 * Rewrites one account's transactions in their own currencies. `currencyOf` maps the sheet's currency positions
 * (ISIN → currency) and the account's other instruments (ISIN → currency they're priced in).
 */
export function nativeLedger(txs: TransactionInput[], currencyIsins: Map<string, string>): TransactionInput[] {
  const out: TransactionInput[] = [];
  const byDate = new Map<string, TransactionInput[]>();
  for (const t of txs) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);

  for (const day of [...byDate.keys()].sort()) {
    const rows = byDate.get(day)!;
    const isCcy = (t: TransactionInput) => !!t.isin && currencyIsins.has(t.isin);
    const ccy = rows.filter(isCcy);
    const used = new Set<TransactionInput>();
    const take = (pred: (c: TransactionInput) => boolean) => {
      const c = ccy.find((x) => !used.has(x) && pred(x));
      if (c) used.add(c);
      return c;
    };

    // 1. Trades, redemptions and fees paid or received in a currency.
    for (const t of rows.filter((x) => !isCcy(x))) {
      const flow = plnFlow(t);
      const paidFrom = (t.type === "BUY" || t.type === "FEE" || t.type === "TAX") && flow < 0 ? take((c) => c.type === "SELL" && Math.abs(plnFlow(c) + flow) < TOLERANCE) : undefined;
      const paidTo = (t.type === "SELL" || t.type === "REDEMPTION" || t.type === "COUPON" || t.type === "DIVIDEND" || t.type === "INTEREST") && flow > 0 ? take((c) => c.type === "BUY" && Math.abs(plnFlow(c) + flow) < TOLERANCE) : undefined;
      const c = paidFrom ?? paidTo;
      if (!c) {
        out.push(t);
        continue;
      }
      const currency = currencyIsins.get(c.isin!)!;
      const units = c.quantity!; // the currency that paid (or was received)
      const { fxRate: _fx, ...rest } = t;
      if (t.type === "BUY") {
        // The currency sold covers the trade and its fee; the fee in that currency at the trade's rate.
        const fee = t.fee && t.fxRate ? round(t.fee / t.fxRate) : 0;
        out.push({ ...rest, amount: -units6(units - fee), ...(fee ? { fee } : { fee: undefined }), currency });
      } else if (t.type === "FEE" || t.type === "TAX") out.push({ ...rest, amount: -units6(units), currency });
      else out.push({ ...rest, amount: units6(units), fee: undefined, currency });
    }

    // 2. Currency for currency (both legs on the same day, equal PLN).
    for (const buy of ccy.filter((c) => c.type === "BUY")) {
      if (used.has(buy)) continue;
      const to = currencyIsins.get(buy.isin!)!;
      const sell = take((c) => c.type === "SELL" && currencyIsins.get(c.isin!) !== to && Math.abs(plnFlow(c) + plnFlow(buy)) < TOLERANCE);
      if (!sell) continue;
      used.add(buy);
      out.push({ date: day, account: buy.account, type: "EXCHANGE", amount: -units6(sell.quantity!), currency: currencyIsins.get(sell.isin!)!, toAmount: units6(buy.quantity!), toCurrency: to, ...(buy.note ? { note: buy.note } : {}) });
    }

    // 3. The rest with PLN: bought with PLN sent in, or sold for PLN.
    for (const c of ccy) {
      if (used.has(c)) continue;
      const currency = currencyIsins.get(c.isin!)!;
      if (c.type === "BUY")
        out.push({ date: day, account: c.account, type: "EXCHANGE", amount: c.amount, ...(c.fee ? { fee: round(c.fee) } : {}), currency: "PLN", toAmount: units6(c.quantity!), toCurrency: currency, ...(c.note ? { note: c.note } : {}) });
      else out.push({ date: day, account: c.account, type: "EXCHANGE", amount: -units6(c.quantity!), currency, toAmount: round(c.amount), toCurrency: "PLN", ...(c.note ? { note: c.note } : {}) });
    }
  }
  // Drop undefined fields left by the rewrites.
  return out.map((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as TransactionInput);
}
