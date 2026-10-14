// Monthly backup of what the app can't fetch again (core/backup/export.ts) to exports/<date>/<kind>.json in the
// files bucket, in the import formats: restore by uploading each file to imports/<kind>/ (accounts first).

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { EXPORT_KINDS, exportFiles, today, type PriceItem } from "@portfolio/core";
import { bucketName, repo, runJob } from "../lib/context.ts";

const s3 = new S3Client({});

export async function handler() {
  return runJob("export", async () => {
    const [accounts, instruments, transactions] = await Promise.all([repo.listAccounts(), repo.listInstruments(), repo.listTransactions()]);
    // Hand-entered prices: those of instruments valued by hand (venue MANUAL), every date.
    const manual = instruments.filter((i) => i.venue === "MANUAL");
    const manualPrices: PriceItem[] = (await Promise.all(manual.map((i) => repo.queryPrices(i.isin, "MANUAL", "1900-01-01", "2999-12-31")))).flat();
    const couponPeriods = (await Promise.all(instruments.filter((i) => i.type === "BOND_CORPORATE").map((i) => repo.listCouponPeriods(i.isin)))).flat();
    const files = exportFiles({ accounts, instruments, manualPrices, couponPeriods, transactions });
    const date = today();
    for (const kind of EXPORT_KINDS)
      await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `exports/${date}/${kind}.json`, Body: JSON.stringify(files[kind], null, 1), ContentType: "application/json" }));
    const counts = EXPORT_KINDS.map((k) => `${files[k].length} ${k}`).join(", ");
    return { itemsWritten: EXPORT_KINDS.reduce((n, k) => n + files[k].length, 0), note: `exports/${date}/: ${counts}` };
  });
}
