#!/usr/bin/env node
// `catalyst`: the Catalyst module's command line (Docs/catalyst.md, "The catalyst CLI"). Reading and checking run here,
// on the user's machine; the app is called only to read stored rows and to write results.

import { defaultIo, run } from "./cli.ts";
import { defaultConfigDir } from "./client.ts";

process.exitCode = await run(process.argv.slice(2), { ...defaultIo(), configDir: defaultConfigDir() });
