// The Catalyst module's monthly backup (Docs/catalyst.md, "Storage"): what exists nowhere else, its settings (the
// assumptions and the saved views), to exports/<date>/catalyst/ in the files bucket. The market data is rebuilt from
// the archive; the quotes pages are archived raw.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { today } from "@portfolio/core";
import { bucketName, runJob } from "../../lib/context.ts";
import { catalystRepo } from "../context.ts";
import { ASSUMPTIONS_SETTING, VIEWS_SETTING } from "../metrics.ts";

const s3 = new S3Client({});

export async function handler() {
  return runJob("catalyst-export", async () => {
    const date = today();
    const settings = {
      [ASSUMPTIONS_SETTING]: (await catalystRepo.getSetting(ASSUMPTIONS_SETTING)) ?? null,
      [VIEWS_SETTING]: (await catalystRepo.getSetting(VIEWS_SETTING)) ?? null,
    };
    const key = `exports/${date}/catalyst/settings.json`;
    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: JSON.stringify(settings, null, 1), ContentType: "application/json" }));
    return { itemsWritten: 1, note: key };
  });
}
