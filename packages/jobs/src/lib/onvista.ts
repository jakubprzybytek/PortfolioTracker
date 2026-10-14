// onvista.de API (unofficial, no key): daily closes of bonds on the German exchanges, used for the foreign
// government bonds held at IBKR. Two calls per bond:
//   /api/v1/bonds/ISIN:<isin>/snapshot – the instrument's id and its quotes per exchange (each with an idNotation)
//   /api/v1/instruments/BOND/<id>/eod_history?idNotation=…&range=MAX&startDate=… – one close per trading day
// Prices are % of nominal (clean). Börse Stuttgart's market maker quotes every trading day, even without trades, and
// its closes match IBKR's mark prices to about 0.01 (checked on three statement dates, 2026-10-14).

const BASE = "https://api.onvista.de/api/v1";
const HEADERS = { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)", Accept: "application/json" };

export interface OnvistaBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
}

export interface OnvistaQuote extends OnvistaBar {
  /** The exchange's code, e.g. STU. */
  exchange: string;
  /** When the last price was set (ISO, UTC). */
  time: string;
  idNotation: number;
  currency: string;
}

export interface OnvistaSnapshot {
  idInstrument: string;
  isin: string;
  name: string;
  quotes: OnvistaQuote[];
}

interface SnapshotResponse {
  instrument?: { entityValue: string; isin: string; name: string };
  quoteList?: {
    list: {
      market: { codeExchange: string; idNotation: number };
      isoCurrency: string;
      datetimeLast?: string;
      open?: number;
      high?: number;
      low?: number;
      last?: number;
      volume?: number;
    }[];
  };
}

interface HistoryResponse {
  isoCurrency?: string;
  datetimeLast?: number[];
  first?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  last?: (number | null)[];
  volume?: (number | null)[];
}

/** Calendar day in Frankfurt of an instant (quotes are stamped in UTC; a session never crosses midnight there). */
const berlinDate = (iso: string | number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(typeof iso === "number" ? iso * 1000 : iso));

export function parseSnapshot(json: SnapshotResponse): OnvistaSnapshot {
  const inst = json.instrument;
  if (!inst) throw new Error("onvista: no instrument in the snapshot");
  const quotes: OnvistaQuote[] = [];
  for (const q of json.quoteList?.list ?? []) {
    if (q.last === undefined || !q.datetimeLast) continue;
    quotes.push({
      exchange: q.market.codeExchange,
      time: q.datetimeLast,
      idNotation: q.market.idNotation,
      currency: q.isoCurrency,
      date: berlinDate(q.datetimeLast),
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.last,
      volume: q.volume ?? 0,
    });
  }
  return { idInstrument: inst.entityValue, isin: inst.isin, name: inst.name, quotes };
}

/** One bar per day with a close, oldest first. The days are stamped at 12:00 UTC. */
export function parseHistory(json: HistoryResponse): OnvistaBar[] {
  const bars: OnvistaBar[] = [];
  (json.datetimeLast ?? []).forEach((t, i) => {
    const close = json.last?.[i];
    if (close === null || close === undefined) return;
    bars.push({ date: berlinDate(t), open: json.first?.[i] ?? null, high: json.high?.[i] ?? null, low: json.low?.[i] ?? null, close, volume: json.volume?.[i] ?? 0 });
  });
  return bars;
}

async function get<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`onvista ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The bond's snapshot, or undefined when onvista doesn't know the ISIN. */
export async function fetchSnapshot(isin: string): Promise<OnvistaSnapshot | undefined> {
  const json = await get<SnapshotResponse>(`/bonds/ISIN:${encodeURIComponent(isin)}/snapshot`);
  return json?.instrument ? parseSnapshot(json) : undefined;
}

/** Daily closes on one exchange from `from` on (up to the last finished session). */
export async function fetchHistory(idInstrument: string, idNotation: number, from: string): Promise<OnvistaBar[]> {
  const json = await get<HistoryResponse>(`/instruments/BOND/${idInstrument}/eod_history?idNotation=${idNotation}&range=MAX&startDate=${from}`);
  return json ? parseHistory(json) : [];
}
