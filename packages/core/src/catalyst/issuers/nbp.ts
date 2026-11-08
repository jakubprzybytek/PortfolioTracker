// Ported from CatalystViewer (packages/core/src/bonds/fx/nbp.ts, 7e8a24c) for the Catalyst module's phase 2 (N4).

// Exchange rates from the National Bank of Poland (NBP table A mid rates, open API): PLN per one unit.
import type { Rates } from "./refinancing.ts";

const API = 'https://api.nbp.pl/api/exchangerates/tables/a/';
const DAY_MS = 24 * 60 * 60 * 1000;

type NbpTable = { effectiveDate: string; rates: { code: string; mid: number }[] }[];

export function parseNbpTable(table: NbpTable): Rates {
    return Object.fromEntries((table[0]?.rates ?? []).map(r => [r.code, r.mid]));
}

// Table A once a day per instance. A failed fetch gives no rates (bonds in other currencies are left
// out of the totals) and is tried again on the next call.
export function nbpRates(fetchJson: (url: string) => Promise<unknown> = defaultFetch, now: () => number = Date.now) {
    let cached: { at: number; rates: Rates } | undefined;
    return async (): Promise<Rates> => {
        if (cached && now() - cached.at < DAY_MS) return cached.rates;
        try {
            const rates = parseNbpTable(await fetchJson(API) as NbpTable);
            cached = { at: now(), rates };
            return rates;
        } catch (error) {
            console.log(`NBP rates: ${error instanceof Error ? error.message : error}`);
            return {};
        }
    };
}

async function defaultFetch(url: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`NBP ${response.status}`);
    return response.json();
}
