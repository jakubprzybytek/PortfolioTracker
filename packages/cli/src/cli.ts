// The commands of `catalyst` (Docs/catalyst.md, "The catalyst CLI"); main.ts runs them.

import { readFileSync } from "node:fs";
import { apiUrl, configDir } from "./stage.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const HELP = `catalyst ${VERSION}: the Catalyst module's command line

Usage: catalyst <command> [options]

Commands:
  where [--stage <stage>]   the stage's API and where the CLI keeps its settings
  --version                 the CLI's version
  --help                    this text

More commands come with phase 2 (Docs/catalyst-phase2-plan.md).`;

export function run(args: string[], out: (s: string) => void = console.log): number {
  const [command] = args;
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (command === undefined || command === "--help" || command === "-h") {
    out(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    out(VERSION);
    return 0;
  }
  if (command === "where") {
    const stage = opt("--stage") ?? "dev";
    out(JSON.stringify({ stage, api: apiUrl(stage), config: configDir() }, null, 2));
    return 0;
  }
  out(`unknown command "${command}"\n\n${HELP}`);
  return 1;
}
