// Outbound HTTP for the source adapters: every request gets a timeout, so a hung connection fails the request
// instead of eating the whole Lambda (and its retries); requests to a data source also carry one user agent and,
// for scraped sites, keep one request per host every POLITE_INTERVAL_MS (Docs/catalyst.md, "Rules for every source").

/** Default timeout per request; the Ministry and GUS files get longer (FILE_TIMEOUT_MS). */
export const TIMEOUT_MS = 20_000;
export const FILE_TIMEOUT_MS = 60_000;

/** How the app introduces itself to every source: a browser-like prefix (some sites refuse bare clients) and who it is. */
export const USER_AGENT = "Mozilla/5.0 (portfolio-tracker, personal use)";

/** Scraped sites: at most one request per host this often. */
export const POLITE_INTERVAL_MS = 2000;

export interface SourceRequest {
  timeoutMs?: number;
  /** At most one request per host this often (0: no spacing, for APIs). */
  minIntervalMs?: number;
  headers?: Record<string, string>;
  /** "manual": a redirect comes back as such (gpwcatalyst.pl answers a missing file with a 302). */
  redirect?: RequestRedirect;
}

// When each host may be asked next. Module state: it holds across calls (and warm invocations) in one Lambda.
const nextTurn = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the host's turn and books the next one, so even concurrent callers keep the spacing. */
async function waitTurn(host: string, intervalMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextTurn.get(host) ?? 0);
  nextTurn.set(host, at + intervalMs);
  if (at > now) await sleep(at - now);
}

/** A request to a data source: the app's user agent, a timeout and, for scraped sites, the spacing per host. */
export async function fetchSource(url: string | URL, { timeoutMs = TIMEOUT_MS, minIntervalMs = 0, headers = {}, redirect }: SourceRequest = {}): Promise<Response> {
  if (minIntervalMs > 0) await waitTurn(new URL(url).host, minIntervalMs);
  return fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT, ...headers }, ...(redirect ? { redirect } : {}) }, timeoutMs);
}

/** `fetch` that gives up after `timeoutMs` (a TimeoutError naming the URL). */
export async function fetchWithTimeout(url: string | URL, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new Error(`${String(url)}: no answer within ${timeoutMs / 1000} s`, { cause: err });
    throw err;
  }
}
