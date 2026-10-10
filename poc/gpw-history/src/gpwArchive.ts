// Client for the GPW quotation archive (https://www.gpw.pl/archiwum-notowan).
// For a single instrument the archive returns its whole daily history, from listing
// up to the requested date, as one XLS file.

import https from "node:https";

export const ARCHIVE_URL = "https://www.gpw.pl/archiwum-notowan";

/** Instrument categories of the archive's "type" select. */
export const InstrumentType = {
  shares: "10",
  treasuryBonds: "13", // "obligacje skarbowe"
  etf: "241",
} as const;

// Browser-like headers; the server is picky about clients.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "application/vnd.ms-excel,*/*;q=0.8",
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
};

export interface DownloadedFile {
  fileName: string;
  content: Buffer;
}

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

// node:https instead of global fetch: in testing, gpw.pl reset fetch (undici) connections
// while node:https requests went through. The server also resets everything for a while
// after too many requests, so keep the request rate low.
function httpsGet(url: URL): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
}

/** Formats a YYYY-MM-DD date as dd-mm-yyyy, the format the archive form expects. */
function toArchiveDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

/** Full daily history of one instrument, from its first listing day up to today. */
export async function downloadHistoryXls(instrument: string, type: string): Promise<DownloadedFile> {
  const file = await downloadXls({ type, instrument, date: "" }, instrument);
  if (!file) throw new Error(`No XLS for ${instrument} (unknown instrument or changed archive?)`);
  return file;
}

/**
 * One session, all instruments of the category, or null when there was no session that day.
 * There is no "last N sessions" option: with a date the archive returns only that day
 * (as XLS only when no instrument is given).
 */
export function downloadDayXls(isoDate: string, type: string): Promise<DownloadedFile | null> {
  return downloadXls({ type, instrument: "", date: toArchiveDate(isoDate) }, isoDate);
}

/** Returns null when the archive answers with its HTML page instead of a file (nothing to export). */
async function downloadXls(
  params: { type: string; instrument: string; date: string },
  label: string,
  retries = 3,
): Promise<DownloadedFile | null> {
  const url = new URL(ARCHIVE_URL);
  url.search = new URLSearchParams({
    fetch: "1", // 1 = XLS download, 0 = HTML page
    ...params,
    show_x: "Pokaż wyniki",
  }).toString();

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await httpsGet(url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

      // An HTML answer is the archive page itself: the query matched nothing. Not worth retrying.
      const contentType = String(res.headers["content-type"] ?? "");
      if (contentType.includes("text/html")) return null;
      if (!contentType.includes("ms-excel")) throw new Error(`Unexpected content type "${contentType}"`);

      const disposition = String(res.headers["content-disposition"] ?? "");
      const fileName = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `${label.toLowerCase()}.xls`;
      return { fileName, content: res.body };
    } catch (err) {
      if (attempt >= retries) throw new Error(`Download of ${label} failed after ${attempt} attempts`, { cause: err });
      const delayMs = 10_000 * attempt;
      console.warn(`  ${label}: attempt ${attempt} failed (${(err as Error).message}), retrying in ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
