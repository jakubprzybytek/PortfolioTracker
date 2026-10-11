// Downloads the Ministry of Finance retail-bond file ("Dane dotyczące obligacji detalicznych", XLS) from
// https://www.gov.pl/web/finanse/obligacje-detaliczne1. The attachment id changes with every update, so the
// link is found on the page by its text.

const PAGE = "https://www.gov.pl/web/finanse/obligacje-detaliczne1";
const HEADERS = { "User-Agent": "portfolio-tracker (personal use)" };

/** The attachment path of the XLS, e.g. "/attachment/3d42a295-…", or undefined. */
export function findRetailFileLink(html: string): string | undefined {
  for (const m of html.matchAll(/<a[^>]*href="(\/attachment\/[a-f0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/obligacji detalicznych/i.test(text) && /xls/i.test(text)) return m[1];
  }
  return undefined;
}

export async function fetchRetailFile(): Promise<{ url: string; content: Uint8Array }> {
  const page = await fetch(PAGE, { headers: HEADERS });
  if (!page.ok) throw new Error(`MF retail page: HTTP ${page.status}`);
  const link = findRetailFileLink(await page.text());
  if (!link) throw new Error("MF retail page: no link to the retail-bond XLS (page layout changed?)");
  const url = `https://www.gov.pl${link}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`MF retail file: HTTP ${res.status}`);
  return { url, content: new Uint8Array(await res.arrayBuffer()) };
}
