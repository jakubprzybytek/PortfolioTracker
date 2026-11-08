// The Catalyst module's monthly backup (Docs/catalyst.md, "Storage"): what exists nowhere else, its settings (the
// assumptions and the saved views) and the issuers (companies with your switches and names, listed names with their
// links and confirmations, each bond's link), to exports/<date>/catalyst/ in the files bucket. The market data is rebuilt from
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
    const [entities, names, links] = await Promise.all([catalystRepo.listEntities(), catalystRepo.listNames(), catalystRepo.listLinks()]);
    const strip = <T extends { PK: string; SK: string; GSI1PK: string; GSI1SK: string }>({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...rest }: T) => rest;
    const files: [string, unknown][] = [
      ["settings.json", settings],
      ["entities.json", entities.map(strip)],
      ["names.json", names.map(strip)],
      ["links.json", links.map(strip)],
    ];
    for (const [name, body] of files)
      await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `exports/${date}/catalyst/${name}`, Body: JSON.stringify(body, null, 1), ContentType: "application/json" }));
    return { itemsWritten: files.length, note: `exports/${date}/catalyst/: settings, ${entities.length} companies, ${names.length} names, ${links.length} links` };
  });
}
