// The Catalyst module's monthly backup (Docs/catalyst.md, "Storage"): what exists nowhere else, its settings (the
// assumptions and the saved views) and the issuers (companies with your switches and names, listed names with their
// links and confirmations, each bond's link; per company its years with their lines, filings, judgements, collected
// figures and documents; the known answers and the reports checklist), to exports/<date>/catalyst/ in the files
// bucket. The originals stay in the bucket (versioned). The market data is rebuilt from the archive; the quotes pages
// are archived raw.

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
    const [entities, names, links, known, checklist] = await Promise.all([catalystRepo.listEntities(), catalystRepo.listNames(), catalystRepo.listLinks(), catalystRepo.listKnown(), catalystRepo.listChecklist()]);
    const strip = <T extends { PK: string; SK: string; GSI1PK: string; GSI1SK: string }>({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...rest }: T) => rest;
    const keys = <T extends { PK: string; SK: string }>({ PK: _p, SK: _s, ...rest }: T) => rest;
    // Each company's own rows (years with their lines, as the CLI's import would send them again).
    const own = await Promise.all(
      entities.map(async (e) => {
        const [years, filings, analyses, collected, documents] = await Promise.all([catalystRepo.listYears(e.entityId), catalystRepo.listFilings(e.entityId), catalystRepo.listAnalyses(e.entityId), catalystRepo.listCollectedFigures(e.entityId), catalystRepo.listDocuments(e.entityId)]);
        return { years: years.map(keys), filings: filings.map(keys), analyses: analyses.map(keys), collected: collected.map(keys), documents: documents.map(keys) };
      }),
    );
    const all = <K extends keyof (typeof own)[number]>(k: K): unknown[] => own.flatMap((o) => o[k] as unknown[]);
    const files: [string, unknown][] = [
      ["settings.json", settings],
      ["entities.json", entities.map(strip)],
      ["names.json", names.map(strip)],
      ["links.json", links.map(strip)],
      ["years.json", all("years")],
      ["filings.json", all("filings")],
      ["analyses.json", all("analyses")],
      ["collected.json", all("collected")],
      ["documents.json", all("documents")],
      ["known.json", known.map(strip)],
      ["checklist.json", checklist.map(strip)],
    ];
    for (const [name, body] of files)
      await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: `exports/${date}/catalyst/${name}`, Body: JSON.stringify(body, null, 1), ContentType: "application/json" }));
    return { itemsWritten: files.length, note: `exports/${date}/catalyst/: settings, ${entities.length} companies, ${names.length} names, ${links.length} links, ${all("years").length} years, ${all("filings").length} filings, ${all("analyses").length} judgements, ${all("documents").length} documents, ${known.length} known answers, ${checklist.length} checklist entries` };
  });
}
