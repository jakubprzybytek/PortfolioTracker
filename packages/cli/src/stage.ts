// Where a stage's app is (sst.config.ts: prod at the root domain, any other stage at <stage>.<root>), and where the CLI
// keeps its settings: in the user's profile, never in the repo.

import { homedir } from "node:os";
import { join } from "node:path";

const ROOT_DOMAIN = "portfoliotracker.albedoonline.com";

const STAGE = /^[a-z][a-z0-9-]{0,30}$/;

/** The API's base URL of a stage (same origin as the site, under /api). */
export function apiUrl(stage: string): string {
  if (!STAGE.test(stage)) throw new Error(`not a stage name: "${stage}"`);
  return `https://${stage === "prod" ? ROOT_DOMAIN : `${stage}.${ROOT_DOMAIN}`}/api`;
}

/** The CLI's settings directory: %APPDATA%\portfolio-tracker on Windows, ~/.config/portfolio-tracker elsewhere. */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32" && env["APPDATA"]) return join(env["APPDATA"], "portfolio-tracker");
  return join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "portfolio-tracker");
}
