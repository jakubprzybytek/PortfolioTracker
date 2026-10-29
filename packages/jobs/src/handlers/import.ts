// Handles files uploaded to imports/<kind>/… in the bucket:
//   imports/mf-calculator/*.xlsm   Ministry of Finance calculator → reference index + treasury bond terms
//   imports/mf-retail/*.xls        Ministry retail-bond file → series terms and published rates (also fetched monthly)
//   imports/instruments/*.json     instruments to track (terms "mf"/"mf-retail" resolved from the imported files)
//   imports/prices/*.json          manual prices [{ isin, date, price, currency? }] (assets without a price source)
//   imports/accounts/*.json        account metadata [{ account, baseCurrency? }]
//   imports/coupons/*.json         coupon periods of corporate bonds [{ isin, start, end, recordDate, paymentDate, rate … }]
//   imports/transactions/*.json    your transactions
//   imports/notes/*.json           notes [{ id, title, body, createdAt, updatedAt }] (the backup's notes.json)

import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import {
  canonicalJson,
  defaultAssetClass,
  parseAccountsFile,
  parseCouponPeriods,
  parseInstrumentFile,
  parseManualPrices,
  parseMfCalculator,
  parseNotesFile,
  parseRetailRates,
  parseTransactionFile,
  type BondTerms,
  type InstrumentItem,
  type IsoDate,
  type RetailTerms,
} from "@portfolio/core";
import { invokeAsync, queueValuation, repo, runJob } from "../lib/context.ts";
import type { BackfillEvent } from "./backfill.ts";
import type { ValuationEvent } from "./valuation.ts";

const s3 = new S3Client({});

async function readObject(bucket: string, key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

/** Bond terms of all treasury series, keyed by code, as stored by the MF calculator import. */
export async function mfTermsByCode(): Promise<Map<string, BondTerms>> {
  const item = await repo.getInstrument("MF-TERMS"); // see importMfCalculator: stored as a pseudo-instrument
  const terms = (item as unknown as { terms?: BondTerms[] } | undefined)?.terms;
  return new Map((terms ?? []).map((t) => [t.code, t]));
}

export async function importMfCalculator(content: Buffer, source: string) {
  const data = parseMfCalculator(content);
  const months = await repo.putReferenceIndex(data.referenceIndex, source);
  // Keep the series terms as one item so instrument imports can resolve "terms: mf" by code.
  await repo.putInstrument({
    isin: "MF-TERMS",
    code: "MF-TERMS",
    name: "Ministry of Finance treasury bond terms (import)",
    type: "FUND_MANUAL",
    currency: "PLN",
    venue: "NONE",
    sourceIds: {},
    active: false,
    terms: data.bonds as unknown as BondTerms,
  });
  return { months, series: data.bonds.length };
}

/**
 * Stores every series of the Ministry retail-bond file and refreshes the terms (newly published rates) of the
 * retail instruments already tracked. Used by the import and by the monthly job.
 */
export async function importRetailRates(content: Uint8Array, source: string) {
  const series = parseRetailRates(content);
  const stored = await repo.putRetailSeries([...series.values()], source);
  const refreshedIsins: string[] = [];
  for (const inst of await repo.listInstruments()) {
    const terms = inst.type === "BOND_RETAIL" ? series.get(inst.code) : undefined;
    // Compared whatever the key order: DynamoDB returns a stored map's keys in its own order, not as written.
    if (!terms || canonicalJson(terms) === canonicalJson(inst.retail)) continue;
    const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, updatedAt: _u, ...rest } = inst;
    await repo.putInstrument({ ...rest, retail: terms });
    refreshedIsins.push(inst.isin);
  }
  return { series: stored, refreshed: refreshedIsins.length, refreshedIsins };
}

export async function importInstruments(json: string) {
  const inputs = parseInstrumentFile(json);
  const mf = await mfTermsByCode();
  let written = 0;
  for (const i of inputs) {
    let terms: BondTerms | undefined;
    let retail: RetailTerms | undefined;
    if (i.terms === "mf") {
      terms = mf.get(i.code);
      if (!terms) throw new Error(`${i.code}: no terms in the imported MF calculator; import kalkulatorodsetek.xlsm first`);
    } else if (i.terms === "mf-retail") {
      const item = await repo.getRetailSeries(i.code);
      if (!item) throw new Error(`${i.code}: not in the imported retail-bond file; import it first (imports/mf-retail/)`);
      if (item.isin !== i.isin) throw new Error(`${i.code}: ISIN ${i.isin} doesn't match the Ministry file (${item.isin})`);
      const { PK: _p, SK: _s, source: _src, updatedAt: _u, ...t } = item;
      retail = t;
    } else if (i.terms) {
      terms = { isin: i.isin, code: i.code, ...i.terms, periods: i.terms.periods.map((p) => ({ ...p, paymentDate: p.paymentDate ?? p.end })) };
    }
    const item: Omit<InstrumentItem, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "updatedAt"> = {
      isin: i.isin,
      code: i.code,
      name: i.name,
      type: i.type,
      currency: i.currency,
      venue: i.venue,
      sourceIds: i.sourceIds,
      active: i.active,
      ...(terms ? { terms } : {}),
      ...(retail ? { retail } : {}),
      ...(i.nominal ? { nominal: i.nominal } : {}),
      ...(i.pricePath?.length ? { pricePath: [...i.pricePath].sort((x, y) => x.date.localeCompare(y.date)) } : {}),
      ...(i.splits?.length ? { splits: [...i.splits].sort((x, y) => x.date.localeCompare(y.date)) } : {}),
      ...(i.assetClass && i.assetClass !== defaultAssetClass(i) ? { assetClass: i.assetClass } : {}),
    };
    const before = await repo.getInstrument(i.isin);
    await repo.putInstrument(item);
    written++;
    // Start the history backfill for an instrument that never had one (new, or missed before). Instruments
    // without a price source (retail bonds: values are calculated) have no history to load.
    const hasSource = Object.keys(i.sourceIds).length > 0;
    // A newly recorded split changes how the (split-adjusted) source history converts back: load it again.
    const splitsChanged = canonicalJson(before?.splits ?? []) !== canonicalJson(item.splits ?? []);
    // Calculated prices: recompute whenever the known points change (a new trade).
    const pathChanged = canonicalJson(before?.pricePath ?? []) !== canonicalJson(item.pricePath ?? []);
    // A new source or venue (e.g. an IBKR bond going from calculated to quoted prices): load its history.
    const sourceChanged = !!before && (before.venue !== item.venue || canonicalJson(before.sourceIds) !== canonicalJson(item.sourceIds));
    if (item.pricePath?.length && pathChanged) await invokeAsync(Resource.Backfill.name, { isin: i.isin } satisfies BackfillEvent);
    else if (hasSource && (splitsChanged || sourceChanged || !(await repo.getBackfillStatus(i.isin)))) await invokeAsync(Resource.Backfill.name, { isin: i.isin } satisfies BackfillEvent);
  }
  // Instruments priced in another currency need NBP rates for their whole history: fetch what's missing now.
  if (inputs.some((i) => i.currency !== "PLN")) await invokeAsync(Resource.Fx.name, {});
  return { instruments: written };
}

export async function importTransactions(json: string, source: string) {
  const rows = parseTransactionFile(json, source);
  return { transactions: await repo.putTransactions(rows), from: earliest(rows.map((r) => r.date)) };
}

const earliest = (dates: IsoDate[]): IsoDate | undefined => dates.reduce<IsoDate | undefined>((m, d) => (m === undefined || d < m ? d : m), undefined);

/**
 * What an imported file asks to revalue: from its earliest date, from the first transaction of the instruments it
 * changed, everything (`{}`), or nothing (undefined).
 */
type Revalue = Pick<ValuationEvent, "from" | "isins"> | undefined;
const fromDate = (from: IsoDate | undefined): Revalue => (from ? { from } : undefined);

export async function importKey(bucket: string, key: string): Promise<{ itemsWritten: number; note: string; revalue: Revalue }> {
  const kind = key.split("/")[1];
  const content = await readObject(bucket, key);
  switch (kind) {
    case "mf-calculator": {
      const r = await importMfCalculator(content, key);
      return { itemsWritten: r.months + 1, note: `${key}: ${r.months} months, ${r.series} series`, revalue: {} };
    }
    case "prices": {
      const prices = parseManualPrices(content.toString("utf8"), key);
      const n = await repo.putPrices(prices);
      return { itemsWritten: n, note: `${key}: ${n} prices`, revalue: fromDate(earliest(prices.map((p) => p.date))) };
    }
    case "coupons": {
      const periods = parseCouponPeriods(content.toString("utf8"));
      const n = await repo.putCouponPeriods(periods);
      return { itemsWritten: n, note: `${key}: ${n} coupon periods`, revalue: fromDate(earliest(periods.map((p) => p.start))) };
    }
    case "accounts": {
      const n = await repo.putAccounts(parseAccountsFile(content.toString("utf8")));
      return { itemsWritten: n, note: `${key}: ${n} accounts`, revalue: {} };
    }
    case "mf-retail": {
      const r = await importRetailRates(content, key);
      return { itemsWritten: r.series + r.refreshed, note: `${key}: ${r.series} series, ${r.refreshed} instruments refreshed`, revalue: r.refreshed ? { isins: r.refreshedIsins } : undefined };
    }
    case "instruments": {
      const r = await importInstruments(content.toString("utf8"));
      // New instruments get valued after their backfill instead.
      return { itemsWritten: r.instruments, note: `${key}: ${r.instruments} instruments`, revalue: undefined };
    }
    case "transactions": {
      const r = await importTransactions(content.toString("utf8"), key);
      return { itemsWritten: r.transactions, note: `${key}: ${r.transactions} transactions`, revalue: fromDate(r.from) };
    }
    case "notes": {
      const n = await repo.putNotes(parseNotesFile(content.toString("utf8")));
      return { itemsWritten: n, note: `${key}: ${n} notes`, revalue: undefined };
    }
    default:
      throw new Error(`Unknown import kind "${kind}" in ${key}`);
  }
}

export async function handler(event: S3Event) {
  return runJob("import", async () => {
    let itemsWritten = 0;
    const notes: string[] = [];
    const revalue: NonNullable<Revalue>[] = [];
    const failed: string[] = [];
    // Each file on its own: a bad one is reported without failing the others (a retry would re-import them).
    for (const r of event.Records) {
      const key = decodeURIComponent(r.s3.object.key.replace(/\+/g, " "));
      try {
        const result = await importKey(r.s3.bucket.name, key);
        itemsWritten += result.itemsWritten;
        notes.push(result.note);
        if (result.revalue) revalue.push(result.revalue);
      } catch (err) {
        failed.push(`${key}: ${(err as Error).message}`);
      }
    }
    // One request per file; the valuation merges requests waiting together into one run.
    for (const r of revalue) await queueValuation({ reason: "import", ...r });
    if (failed.length === event.Records.length) throw new Error(failed.join("; "));
    return { itemsWritten, note: [...notes, ...failed.map((f) => `failed ${f}`)].join("; ") };
  });
}
