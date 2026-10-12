// NBP Web API, table A (mid rates, published on business days around 12:00): https://api.nbp.pl
// One request covers at most 93 days; a range without any table answers 404.

import { addDays, type IsoDate } from "@portfolio/core";

const BASE = "https://api.nbp.pl/api/exchangerates/rates/a";
const MAX_DAYS = 93;
/** Table A as a series starts here. */
export const NBP_FIRST_DATE: IsoDate = "2002-01-02";

export interface NbpRate {
  currency: string;
  date: IsoDate;
  mid: number;
  table: string;
}

interface NbpResponse {
  code: string;
  rates: { no: string; effectiveDate: string; mid: number }[];
}

export function parseNbpRates(json: NbpResponse): NbpRate[] {
  return json.rates.map((r) => ({ currency: json.code.toUpperCase(), date: r.effectiveDate, mid: r.mid, table: r.no }));
}

/** Mid rates of `currency` between two dates (inclusive), oldest first, in ≤ 93-day requests. */
export async function fetchNbpRates(currency: string, from: IsoDate, to: IsoDate): Promise<NbpRate[]> {
  const out: NbpRate[] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_DAYS)) {
    const endCandidate = addDays(start, MAX_DAYS - 1);
    const end = endCandidate < to ? endCandidate : to;
    const url = `${BASE}/${currency.toLowerCase()}/${start}/${end}/?format=json`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 404) continue; // no table in this range (holidays, or before today's table)
    if (!res.ok) throw new Error(`NBP ${currency} ${start}…${end}: HTTP ${res.status}`);
    out.push(...parseNbpRates((await res.json()) as NbpResponse));
  }
  return out;
}
