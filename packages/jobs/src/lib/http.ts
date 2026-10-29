// Outbound HTTP for the source adapters: every request gets a timeout, so a hung connection fails the request
// instead of eating the whole Lambda (and its retries).

/** Default timeout per request; the Ministry and GUS files get longer (FILE_TIMEOUT_MS). */
export const TIMEOUT_MS = 20_000;
export const FILE_TIMEOUT_MS = 60_000;

/** `fetch` that gives up after `timeoutMs` (a TimeoutError naming the URL). */
export async function fetchWithTimeout(url: string | URL, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new Error(`${String(url)}: no answer within ${timeoutMs / 1000} s`, { cause: err });
    throw err;
  }
}
