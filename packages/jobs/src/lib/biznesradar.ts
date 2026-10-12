// BiznesRadar (biznesradar.pl) pages for Catalyst corporate bonds: the only working free source with history
// (gpwcatalyst.pl is a snapshot without archive; Bossa's feed is frozen). Personal use, slow requests.
//   /notowania-historyczne/<CODE>[,<page>]  daily OHLC + volume, 50 sessions per page, newest first; lags a day
//   /notowania/<CODE>                       the latest quote (cells pr_t_close, pr_t_date with a full datetime …)
// Prices are % of nominal (clean). A bond that left the market answers 404.

import type { IsoDate } from "@portfolio/core";

const BASE = "https://www.biznesradar.pl";
const HEADERS = { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)" };

export interface BrBar {
  date: IsoDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const num = (s: string | undefined) => {
  const v = Number((s ?? "").replace(/\s/g, "").replace(",", "."));
  return s && Number.isFinite(v) ? v : null;
};
const isoFromPl = (d: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};

/** Rows of a history page (newest first), and the highest page number linked from it. */
export function parseHistoryPage(html: string, code: string): { bars: BrBar[]; lastPage: number } {
  const table = /<table[^>]*qTableFull[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";
  const bars: BrBar[] = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(text);
    const date = isoFromPl(cells[0] ?? "");
    const close = num(cells[4]);
    if (!date || close === null) continue;
    bars.push({ date, open: num(cells[1]), high: num(cells[2]), low: num(cells[3]), close, volume: num(cells[5]) ?? 0 });
  }
  const pages = [...html.matchAll(new RegExp(`/notowania-historyczne/${code},(\\d+)`, "g"))].map((m) => Number(m[1]));
  return { bars, lastPage: Math.max(1, ...pages) };
}

/** The latest quote from the bond's page (cells with ids pr_t_*); its date from the <time datetime> of the last trade. */
export function parseQuotePage(html: string): BrBar | undefined {
  const cell = (id: string) => {
    const m = new RegExp(`<td[^>]*id="pr_t_${id}"[^>]*>([\\s\\S]*?)</td>`).exec(html);
    return m ? m[1]! : undefined;
  };
  const date = /datetime="(\d{4}-\d{2}-\d{2})/.exec(cell("date") ?? "")?.[1];
  const close = num(text(cell("close") ?? ""));
  if (!date || close === null) return undefined;
  const n = (id: string) => num(text(cell(id) ?? ""));
  return { date, open: n("open"), high: n("max"), low: n("min"), close, volume: n("vol") ?? 0 };
}

async function get(path: string): Promise<string | undefined> {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`BiznesRadar ${path}: HTTP ${res.status}`);
  return res.text();
}

export const fetchHistoryPage = (code: string, page = 1) => get(`/notowania-historyczne/${code}${page > 1 ? `,${page}` : ""}`);
export const fetchQuotePage = (code: string) => get(`/notowania/${code}`);
