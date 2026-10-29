// Converts rows of the reference spreadsheet's "Transakcje" tab (Docs/reference/ReferenceFeatures.md) into the
// transaction import format. Only rows the app can value are converted: cash movements and instruments the app
// knows (by code); everything else is reported as skipped, with the reason.

import * as XLSX from "xlsx";
import { listingFromTicker } from "../instruments/listing.ts";
import type { InstrumentInput } from "../instruments/schema.ts";
import type { RetailTerms } from "../mf/retailRates.ts";
import { privateAssetId, type ManualPriceInput } from "../prices/manual.ts";
import { nativeLedger } from "./nativeLedger.ts";
import { transactionId, type TransactionInput } from "./schema.ts";

/** One row of "Transakcje" (columns A–N). */
export interface SheetRow {
  /** Spreadsheet row number, for the skip report. */
  row: number;
  account: string;
  /** YYYY-MM-DD */
  date: string;
  ticker: string;
  /** "Nazwa" (instrument name). */
  name: string;
  currency: string;
  assetClass: string;
  /** "Wpłata środków", "Zakup", … */
  type: string;
  quantity: number;
  /** Bonds: PLN per bond (not % of nominal). */
  price: number;
  /** Commission, PLN. */
  fee: number;
  /** "Kurs PLN transakcji": PLN per unit of `currency` used for the trade (1 for PLN). */
  fxRate: number;
  /** Split rows: units after per unit before ("100:1" in the quantity column → 100). */
  splitRatio?: number;
  /** Nominal per bond for bonds (1 otherwise). */
  nominal: number;
  /** "Total PLN": buy = qty × price + fee; sell = qty × price − fee; others = the amount. Always positive. */
  totalPln: number;
  comment: string;
}

export interface SkippedRow {
  row: number;
  date: string;
  account: string;
  ticker: string;
  type: string;
  reason: string;
  /** What kind of asset isn't tracked (for the account's "incomplete" note), e.g. "ETFs". */
  what: string;
}

export interface SheetConversion {
  transactions: TransactionInput[];
  skipped: SkippedRow[];
  /** Retail bond series the transactions use: instruments to import (terms resolved from the Ministry file). */
  retailInstruments: InstrumentInput[];
  /**
   * Catalyst corporate bonds the transactions use (listed in the Catalyst file). Still held: priced from BiznesRadar.
   * Already redeemed or sold (no longer quoted anywhere): priced from your own trades (`manualPrices`).
   */
  corporateInstruments: InstrumentInput[];
  /**
   * IBKR: foreign government bonds (nominal 1000 in their currency, prices calculated from your trades and redemption
   * at maturity) and the foreign cash held there as currency positions ("Waluty_EUR" → EUR).
   */
  ibkrInstruments: InstrumentInput[];
  /** ETFs the transactions use (listed in the ETF file): instruments with their Yahoo symbol and recorded splits. */
  etfInstruments: InstrumentInput[];
  /** Manually valued assets (sheet class "Inne"): instruments with a private id, and their purchase prices. */
  manualInstruments: InstrumentInput[];
  manualPrices: ManualPriceInput[];
  /** Every account, with the kinds of assets not imported (empty = complete) and its own currency if not PLN. */
  accounts: { account: string; incomplete: string[]; baseCurrency?: string }[];
}

/** Short label of what isn't tracked, per sheet asset class (for the account's "incomplete" note). */
const WHAT_BY_CLASS: Record<string, string> = {
  "Obligacje skarbowe polskie": "retail bonds",
  "Obligacje korporacyjne polskie": "Catalyst bonds",
  "Akcje zagraniczne": "ETFs",
  "Obligacje korporacyjne zagraniczne": "ETFs",
  "Obligacje skarbowe zagraniczne": "foreign bonds",
  Waluty: "foreign currency",
  Inne: "other assets",
};

/** Polish names of the retail series kinds (EDO → emerytalne 10-letnie). */
export const RETAIL_LABELS: Record<string, string> = {
  EDO: "emerytalne 10-letnie",
  COI: "indeksowane 4-letnie",
  ROD: "rodzinne 12-letnie",
  ROS: "rodzinne 6-letnie",
  TOS: "stałoprocentowe 3-letnie",
  ROR: "roczne",
  DOR: "dwuletnie",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const addMonthsIso = (date: string, months: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(Math.min(d, last))}`;
};

/**
 * The sheet's retail tickers → series and interest start date. "EDO-110332" = EDO bought on 11.03 maturing in
 * 2032 → series EDO0332, interest from 2022-03-11 (maturity minus the term). Series-style tickers ("ROR0623")
 * start on the transaction date.
 */
export function retailLot(ticker: string, txDate: string, series: Map<string, RetailTerms>): { terms: RetailTerms; valueDate: string } | undefined {
  const dated = /^([A-Z]{3})-(\d{2})(\d{2})(\d{2})$/.exec(ticker);
  if (dated) {
    const [, kind, dd, mm, yy] = dated;
    const terms = series.get(`${kind}${mm}${yy}`);
    if (!terms) return undefined;
    return { terms, valueDate: addMonthsIso(`20${yy}-${mm}-${dd}`, -terms.termMonths) };
  }
  const terms = series.get(ticker);
  return terms ? { terms, valueDate: txDate } : undefined;
}

const CASH_CLASS = "Gotówka";
const CASH_TYPES: Record<string, { type: TransactionInput["type"]; sign: 1 | -1 }> = {
  "Wpłata środków": { type: "DEPOSIT", sign: 1 },
  "Wypłata środków": { type: "WITHDRAWAL", sign: -1 },
  "Dywidenda / Odsetki": { type: "INTEREST", sign: 1 },
  Koszty: { type: "FEE", sign: -1 },
};

/** Why rows of an unknown instrument are skipped, per sheet asset class. */
const SKIP_REASON_BY_CLASS: Record<string, string> = {
  "Obligacje skarbowe polskie": "retail bond: series not in the Ministry file (pass --mf-retail)",
  "Obligacje korporacyjne polskie": "Catalyst bond: not in the Catalyst file (data/private/catalyst.json)",
  "Akcje zagraniczne": "ETF: not in the ETF file (data/private/etfs.json)",
  "Obligacje korporacyjne zagraniczne": "ETF: not in the ETF file (data/private/etfs.json)",
  "Obligacje skarbowe zagraniczne": "foreign bond: the ticker isn't an ISIN",
  Waluty: "currency position: ticker isn't Waluty_<CCY>",
  Inne: "manually valued asset: not set up",
};

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * @param instruments the app's instruments: code → ISIN and nominal (e.g. from data/instruments.json + bond terms)
 * @param etfs the sheet's ETF tickers ("AMS:VWRL") → ISIN (the sheet has no ISINs; e.g. data/private/etfs.json)
 * @param corporates the sheet's Catalyst tickers ("CPS0130") → ISIN, nominal and name (e.g. data/private/catalyst.json)
 */
export function convertSheetRows(
  rows: SheetRow[],
  instruments: Map<string, { isin: string; nominal?: number }>,
  retailSeries: Map<string, RetailTerms> = new Map(),
  etfs: Map<string, { isin: string }> = new Map(),
  corporates: Map<string, { isin: string; nominal: number; name: string }> = new Map(),
  /** Accounts kept in several currencies (IBKR → its base currency, EUR): rewritten with `nativeLedger`. */
  nativeAccounts: Map<string, string> = new Map(),
): SheetConversion {
  const transactions: TransactionInput[] = [];
  const skipped: SkippedRow[] = [];
  const retailUsed = new Map<string, RetailTerms>();
  const skip = (r: SheetRow, reason: string) =>
    skipped.push({ row: r.row, date: r.date, account: r.account, ticker: r.ticker, type: r.type, reason, what: WHAT_BY_CLASS[r.assetClass] ?? r.assetClass });
  const manualUsed = new Map<string, InstrumentInput>();
  const manualPrices: ManualPriceInput[] = [];
  const etfUsed = new Map<string, InstrumentInput>();
  const foreignBonds = new Map<string, { input: InstrumentInput; quantity: number; maturity?: string; points: { date: string; price: number }[] }>();
  const currencies = new Map<string, InstrumentInput>();
  const corporateUsed = new Map<string, { input: InstrumentInput; quantity: number; tradePrices: ManualPriceInput[] }>();

  for (const r of rows) {
    const note = r.comment.trim() || undefined;

    if (r.assetClass === CASH_CLASS) {
      const m = CASH_TYPES[r.type];
      if (!m) skip(r, `cash: unsupported type "${r.type}"`);
      else if (r.currency !== "PLN") skip(r, `cash in ${r.currency}: not supported`);
      else transactions.push({ date: r.date, account: r.account, type: m.type, amount: round(m.sign * r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      continue;
    }

    // Retail treasury bonds: valued from the Ministry's published rates, per lot (valueDate).
    const lot = r.assetClass === "Obligacje skarbowe polskie" && !instruments.has(r.ticker) ? retailLot(r.ticker, r.date, retailSeries) : undefined;
    if (lot) {
      retailUsed.set(lot.terms.series, lot.terms);
      const isin = lot.terms.isin;
      if (r.type === "Zakup")
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: r.price, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, valueDate: lot.valueDate, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Sprzedaż")
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: r.price, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Dywidenda / Odsetki")
        transactions.push({ date: r.date, account: r.account, type: "COUPON", isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    // Manually valued assets (class "Inne", e.g. a property fund share): private id, price entered by hand.
    if (r.assetClass === "Inne" && r.currency === "PLN") {
      const isin = privateAssetId(r.ticker);
      if (!manualUsed.has(isin))
        manualUsed.set(isin, { isin, code: r.ticker.toUpperCase(), name: r.name || r.ticker, type: "FUND_MANUAL", currency: "PLN", venue: "MANUAL", sourceIds: {}, active: true });
      if (r.type === "Zakup") {
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: r.price, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        manualPrices.push({ isin, date: r.date, price: r.price, currency: "PLN", note: "purchase price" });
      } else if (r.type === "Sprzedaż")
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: r.price, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Dywidenda / Odsetki") transactions.push({ date: r.date, account: r.account, type: "INTEREST", isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    // Foreign cash at IBKR: the sheet buys and sells it with PLN like a position ("Waluty_EUR"); so do we.
    if (r.assetClass === "Waluty" && /^Waluty_[A-Z]{3}$/.test(r.ticker)) {
      const ccy = r.ticker.slice(-3);
      const isin = privateAssetId(r.ticker);
      if (!currencies.has(isin)) currencies.set(isin, { isin, code: ccy, name: `${ccy} cash`, type: "CURRENCY", currency: ccy, venue: "FX", sourceIds: {}, active: true });
      if (r.type === "Zakup") transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: 1, fxRate: r.fxRate, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Sprzedaż") transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: 1, fxRate: r.fxRate, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    // Foreign government bonds at IBKR: the ticker is the ISIN; price per bond of 1000 in the bond's currency.
    if (r.assetClass === "Obligacje skarbowe zagraniczne" && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r.ticker)) {
      const isin = r.ticker;
      const fb = foreignBonds.get(isin) ?? {
        input: { isin, code: isin, name: r.name, type: "BOND_IBKR", currency: r.currency, venue: "CALC", sourceIds: {}, active: true, nominal: 1000 },
        quantity: 0,
        points: [],
      };
      foreignBonds.set(isin, fb);
      const maturity = maturityFromName(r.name);
      if (maturity) {
        fb.maturity = maturity;
        if (fb.input.name === isin) fb.input.name = r.name; // some rows carry only the ISIN
      }
      const pricePct = round(r.price / 10, 4); // per 1000 nominal → %
      const fx = r.fxRate > 0 && r.fxRate !== 1 ? { fxRate: r.fxRate } : {};
      if (r.type === "Zakup") {
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: pricePct, ...fx, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        fb.quantity += r.quantity;
        fb.points.push({ date: r.date, price: pricePct });
      } else if (r.type === "Sprzedaż") {
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: pricePct, ...fx, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        fb.quantity -= r.quantity;
        fb.points.push({ date: r.date, price: pricePct });
      } else if (r.type === "Dywidenda / Odsetki") transactions.push({ date: r.date, account: r.account, type: "COUPON", isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    // Catalyst corporate bonds: prices in % of nominal; no accrued interest (floating coupons, rates not tracked).
    const corporate = r.assetClass === "Obligacje korporacyjne polskie" ? corporates.get(r.ticker) : undefined;
    if (corporate) {
      const { isin, nominal } = corporate;
      const used = corporateUsed.get(isin) ?? {
        input: { isin, code: r.ticker, name: corporate.name, type: "BOND_CORPORATE", currency: "PLN", venue: "CATALYST", sourceIds: { biznesradar: r.ticker }, active: true, nominal },
        quantity: 0,
        tradePrices: [],
      };
      corporateUsed.set(isin, used);
      const pricePct = round((r.price / nominal) * 100, 4);
      if (r.type === "Zakup") {
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: pricePct, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        used.quantity += r.quantity;
        used.tradePrices.push({ isin, date: r.date, price: pricePct, currency: "PLN", note: "trade price" });
      } else if (r.type === "Sprzedaż") {
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: pricePct, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        used.quantity -= r.quantity;
        used.tradePrices.push({ isin, date: r.date, price: pricePct, currency: "PLN", note: "trade price" });
      } else if (r.type === "Dywidenda / Odsetki") transactions.push({ date: r.date, account: r.account, type: "COUPON", isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    // ETFs: priced in their currency (Yahoo), traded through a PLN account at the broker's rate (`fxRate`).
    const etf = etfs.get(r.ticker);
    const listing = etf && listingFromTicker(r.ticker);
    if (etf && listing) {
      const isin = etf.isin;
      const seen = etfUsed.get(isin);
      const inst: InstrumentInput = seen ?? { isin, code: listing.code, name: r.name, type: "ETF", currency: "PLN", venue: listing.venue, sourceIds: { yahoo: listing.yahoo }, active: true };
      if (inst.name === r.ticker || inst.name === listing.code) inst.name = r.name; // some rows carry only the ticker
      const trade = r.type === "Zakup" || r.type === "Sprzedaż";
      if (trade) inst.currency = r.currency;
      etfUsed.set(isin, inst);
      const fx = r.currency !== "PLN" && r.fxRate > 0 ? { fxRate: r.fxRate } : {};
      if (r.type === "Zakup")
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin, quantity: r.quantity, price: r.price, ...fx, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Sprzedaż")
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin, quantity: r.quantity, price: r.price, ...fx, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Dywidenda / Odsetki") transactions.push({ date: r.date, account: r.account, type: "DIVIDEND", isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
      else if (r.type === "Split" && r.splitRatio) {
        transactions.push({ date: r.date, account: r.account, type: "SPLIT", isin, ratio: r.splitRatio, amount: 0, currency: "PLN" });
        inst.splits = [...(inst.splits ?? []), { date: r.date, ratio: r.splitRatio }];
      } else skip(r, `${r.ticker}: unsupported type "${r.type}"`);
      continue;
    }

    const inst = instruments.get(r.ticker);
    if (!inst) {
      skip(r, SKIP_REASON_BY_CLASS[r.assetClass] ?? `unknown instrument (class "${r.assetClass}")`);
      continue;
    }
    if (r.currency !== "PLN") {
      skip(r, `${r.ticker} in ${r.currency}: not supported`);
      continue;
    }
    const nominal = r.nominal > 1 ? r.nominal : (inst.nominal ?? 100);
    const pricePct = round((r.price / nominal) * 100, 4);

    switch (r.type) {
      case "Zakup":
        // Sheet total includes the fee; the app adds `fee` to cost itself.
        transactions.push({ date: r.date, account: r.account, type: "BUY", isin: inst.isin, quantity: r.quantity, price: pricePct, amount: -round(r.totalPln - r.fee, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        break;
      case "Sprzedaż":
        // Sheet total is already net of the fee: the cash received.
        transactions.push({ date: r.date, account: r.account, type: "SELL", isin: inst.isin, quantity: r.quantity, price: pricePct, amount: round(r.totalPln, 2), fee: r.fee, currency: "PLN", ...(note ? { note } : {}) });
        break;
      case "Dywidenda / Odsetki":
        transactions.push({ date: r.date, account: r.account, type: "COUPON", isin: inst.isin, amount: round(r.totalPln, 2), currency: "PLN", ...(note ? { note } : {}) });
        break;
      default:
        skip(r, `${r.ticker}: unsupported type "${r.type}"`);
    }
  }

  // Multi-currency accounts: each trade in the currency it was paid in, conversions as EXCHANGE (no currency positions).
  const currencyIsins = new Map([...currencies.values()].map((c) => [c.isin, c.currency]));
  for (const account of nativeAccounts.keys()) {
    const mine = transactions.filter((t) => t.account === account);
    const rewritten = nativeLedger(mine, currencyIsins);
    transactions.splice(0, transactions.length, ...transactions.filter((t) => t.account !== account), ...rewritten);
  }
  const stillHeldAsPositions = new Set(transactions.map((t) => t.isin));

  // Stable ids from the row contents (the sheet re-sorts its rows daily, so row numbers aren't stable).
  // Identical rows (e.g. two equal deposits on one day) get a counter suffix instead of collapsing into one.
  const seen = new Map<string, number>();
  for (const t of transactions) {
    const base = transactionId({ ...t, currency: t.currency ?? "PLN" });
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    t.id = n === 1 ? base : `${base}-${n}`;
  }
  const retailInstruments: InstrumentInput[] = [...retailUsed.values()]
    .sort((a, b) => a.series.localeCompare(b.series))
    .map((t) => ({
      isin: t.isin,
      code: t.series,
      name: `Obligacje skarbowe ${t.series} (${RETAIL_LABELS[t.kind] ?? t.kind})`,
      type: "BOND_RETAIL",
      currency: "PLN",
      venue: "CALC",
      sourceIds: {},
      active: true,
      terms: "mf-retail",
    }));
  const incomplete = new Map<string, Set<string>>();
  for (const s of skipped) incomplete.set(s.account, (incomplete.get(s.account) ?? new Set()).add(s.what));
  const accounts = [...new Set(rows.map((r) => r.account))].sort().map((account) => {
    const baseCurrency = nativeAccounts.get(account);
    return { account, incomplete: [...(incomplete.get(account) ?? [])].sort(), ...(baseCurrency ? { baseCurrency } : {}) };
  });
  const etfInstruments = [...etfUsed.values()].sort((a, b) => a.code.localeCompare(b.code));
  // Bonds no longer held are mostly redeemed and gone from every quote page: their prices come from the trades.
  const corporateInstruments: InstrumentInput[] = [];
  for (const c of [...corporateUsed.values()].sort((a, b) => a.input.code.localeCompare(b.input.code))) {
    if (c.quantity > 0) corporateInstruments.push(c.input);
    else {
      corporateInstruments.push({ ...c.input, venue: "MANUAL", sourceIds: {}, active: false });
      manualPrices.push(...c.tradePrices);
    }
  }
  // Still held: the path runs on to redemption at 100 % on the maturity date.
  const ibkrInstruments: InstrumentInput[] = [
    ...[...foreignBonds.values()].map((fb): InstrumentInput => {
      const points = [...fb.points];
      if (fb.quantity > 0 && fb.maturity) points.push({ date: fb.maturity, price: 100 });
      return { ...fb.input, active: fb.quantity > 0, pricePath: points.sort((a, b) => a.date.localeCompare(b.date)) };
    }),
    ...[...currencies.values()].filter((c) => stillHeldAsPositions.has(c.isin)),
  ];
  return { transactions, skipped, retailInstruments, corporateInstruments, ibkrInstruments, etfInstruments, manualInstruments: [...manualUsed.values()], manualPrices, accounts };
}

/** Current prices of manually valued assets from the sheet's "Portfolio" tab (column K), dated `date`. */
export function readSheetManualPrices(content: Uint8Array, date: string): ManualPriceInput[] {
  const workbook = XLSX.read(content, { type: "array" });
  const sheet = workbook.Sheets["Portfolio"];
  if (!sheet) return [];
  const [, ...rows] = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false, defval: null });
  return rows
    .filter((c) => String(c[3] ?? "").trim() === "Inne" && c[1] && typeof c[10] === "number" && c[10] > 0)
    .map((c) => ({ isin: privateAssetId(String(c[1])), date, price: c[10] as number, currency: String(c[4] ?? "PLN"), note: "from the sheet" }));
}

const SHEET_NAME = "Transakcje";
type Cell = string | number | boolean | Date | null | undefined;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** IBKR's bond names end with the maturity: "DE Govt 0.0 Nov15'27" → 2027-11-15. */
export function maturityFromName(name: string): string | undefined {
  const m = /([A-Z][a-z]{2})(\d{2})'(\d{2})\s*$/.exec(name);
  const month = m ? MONTHS.indexOf(m[1]!) : -1;
  return m && month >= 0 ? `20${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]}` : undefined;
}

/** "100:1" → 100 (units after per unit before); undefined for anything else. */
const splitRatio = (v: Cell): number | undefined => {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)\s*$/.exec(String(v ?? ""));
  return m ? Number(m[1]!.replace(",", ".")) / Number(m[2]!.replace(",", ".")) : undefined;
};
const num = (v: Cell): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
const isoDate = (v: Cell): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`Not a date: "${s}"`);
  return s.slice(0, 10);
};

/** Reads the "Transakcje" tab of an XLSX export of the sheet (File → Download → .xlsx). */
export function readSheetTransactions(content: Uint8Array): SheetRow[] {
  const workbook = XLSX.read(content, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`No "${SHEET_NAME}" tab in the workbook`);
  const [, ...rows] = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: true, defval: null });
  const out: SheetRow[] = [];
  rows.forEach((c, i) => {
    if (!c[0] || !c[1]) return; // empty or unfinished row
    out.push({
      row: i + 2,
      account: String(c[0]).trim(),
      date: isoDate(c[1]),
      ticker: String(c[2] ?? "").trim(),
      name: String(c[4] ?? "").trim(),
      currency: String(c[3] ?? "PLN").trim().toUpperCase(),
      assetClass: String(c[5] ?? "").trim(),
      type: String(c[6] ?? "").trim(),
      quantity: num(c[7]),
      price: num(c[8]),
      fee: num(c[9]),
      fxRate: num(c[10]) || 1,
      ...(splitRatio(c[7]) ? { splitRatio: splitRatio(c[7])! } : {}),
      nominal: num(c[11]) || 1,
      totalPln: num(c[12]),
      comment: String(c[13] ?? ""),
    });
  });
  return out;
}
