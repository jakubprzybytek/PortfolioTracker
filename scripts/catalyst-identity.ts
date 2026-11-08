// Links every bond without one to its issuing company (Docs/catalyst-phase2-plan.md, N2): the backlog the terms job
// would take weeks over (it links 60 a run). GLEIF and the KRS register, ~1 s apart: about half an hour for the
// whole archive. Run inside the stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-identity.ts [--limit <n>]

import { resolveIdentities } from "../packages/jobs/src/catalyst/identity.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--limit");
const limit = i >= 0 ? Number(args[i + 1]) : Number.POSITIVE_INFINITY;
const result = await resolveIdentities(limit);
console.log(`${result.itemsWritten} items written; ${result.note}`);
