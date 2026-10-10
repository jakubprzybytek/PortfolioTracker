// Handles files uploaded to imports/<kind>/… in the bucket:
//   imports/mf-calculator/*.xlsm   Ministry of Finance calculator → reference index + treasury bond terms
//   imports/instruments/*.json     instruments to track (terms "mf" resolved from the imported calculator)
//   imports/transactions/*.json    your transactions

import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import {
  parseInstrumentFile,
  parseMfCalculator,
  parseTransactionFile,
  type BondTerms,
  type InstrumentItem,
} from "@portfolio/core";
import { invokeAsync, repo, runJob } from "../lib/context.ts";

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
    live: false,
    terms: data.bonds as unknown as BondTerms,
  });
  return { months, series: data.bonds.length };
}

export async function importInstruments(json: string) {
  const inputs = parseInstrumentFile(json);
  const mf = await mfTermsByCode();
  let written = 0;
  for (const i of inputs) {
    let terms: BondTerms | undefined;
    if (i.terms === "mf") {
      terms = mf.get(i.code);
      if (!terms) throw new Error(`${i.code}: no terms in the imported MF calculator; import kalkulatorodsetek.xlsm first`);
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
      live: i.live,
      ...(terms ? { terms } : {}),
    };
    await repo.putInstrument(item);
    written++;
  }
  return { instruments: written };
}

export async function importTransactions(json: string, source: string) {
  const rows = parseTransactionFile(json, source);
  return { transactions: await repo.putTransactions(rows) };
}

export async function importKey(bucket: string, key: string): Promise<{ itemsWritten: number; note: string }> {
  const kind = key.split("/")[1];
  const content = await readObject(bucket, key);
  switch (kind) {
    case "mf-calculator": {
      const r = await importMfCalculator(content, key);
      return { itemsWritten: r.months + 1, note: `${key}: ${r.months} months, ${r.series} series` };
    }
    case "instruments": {
      const r = await importInstruments(content.toString("utf8"));
      return { itemsWritten: r.instruments, note: `${key}: ${r.instruments} instruments` };
    }
    case "transactions": {
      const r = await importTransactions(content.toString("utf8"), key);
      return { itemsWritten: r.transactions, note: `${key}: ${r.transactions} transactions` };
    }
    default:
      throw new Error(`Unknown import kind "${kind}" in ${key}`);
  }
}

export async function handler(event: S3Event) {
  return runJob("import", async () => {
    let itemsWritten = 0;
    const notes: string[] = [];
    let revalue = false;
    for (const r of event.Records) {
      const key = decodeURIComponent(r.s3.object.key.replace(/\+/g, " "));
      const result = await importKey(r.s3.bucket.name, key);
      itemsWritten += result.itemsWritten;
      notes.push(result.note);
      revalue ||= !key.includes("/instruments/"); // new instruments get valued after their backfill instead
    }
    if (revalue) await invokeAsync(Resource.Valuation.name, { reason: "import" });
    return { itemsWritten, note: notes.join("; ") };
  });
}
