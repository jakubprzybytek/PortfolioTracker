#!/usr/bin/env node
// `catalyst`: the Catalyst module's command line (Docs/catalyst.md, "The catalyst CLI"). Reading and checking run here,
// on the user's machine; the app is called only to read stored rows and to write results. The commands come with the
// milestones of Docs/catalyst-phase2-plan.md.

import { run } from "./cli.ts";

process.exitCode = run(process.argv.slice(2));
