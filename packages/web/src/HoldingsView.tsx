import { Fragment, useMemo } from "react";
import { FilterBar, FilterSelect, uniqueOptions } from "./Filters.tsx";
import { fmtInt, fmtNum, fmtPct, fmtPln, signClass, typeLabel } from "./format.ts";
import type { Holding, Snapshot } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Snapshots written before holdings carried their account have none. */
const accountOf = (h: Holding) => h.account ?? "–";

interface Sums {
  value: number;
  cost: number;
  gain: number;
  couponsReceived: number;
}
const sums = (holdings: Holding[]): Sums =>
  holdings.reduce((s, h) => ({ value: s.value + (h.value ?? 0), cost: s.cost + h.cost, gain: s.gain + (h.gain ?? 0), couponsReceived: s.couponsReceived + h.couponsReceived }), { value: 0, cost: 0, gain: 0, couponsReceived: 0 });

function SumCells({ s }: { s: Sums }) {
  const pct = s.cost ? (s.gain / s.cost) * 100 : null;
  return (
    <>
      <td>{fmtPln(s.value)}</td>
      <td>{fmtPln(s.cost)}</td>
      <td className={signClass(s.gain)}>{fmtPln(s.gain)}</td>
      <td className={signClass(pct)}>{fmtPct(pct)}</td>
      <td>{fmtPln(s.couponsReceived)}</td>
    </>
  );
}

/** Latest snapshot, grouped by account (alphabetically), instruments sorted by code; filters: account, asset type. */
export function HoldingsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const snap = useApi<Snapshot>("/holdings");
  const all = useMemo(() => (snap.data?.holdings ?? []).filter((h) => h.quantity > 0), [snap.data]);
  const { account = "", type = "" } = params;

  const options = useMemo(
    () => ({
      account: uniqueOptions(all, (h) => ({ value: accountOf(h), label: accountOf(h) })),
      type: uniqueOptions(all, (h) => ({ value: h.type, label: typeLabel(h.type) })),
    }),
    [all],
  );

  const groups = useMemo(() => {
    const shown = all.filter((h) => (!account || accountOf(h) === account) && (!type || h.type === type));
    const byAccount = new Map<string, Holding[]>();
    for (const h of shown) byAccount.set(accountOf(h), [...(byAccount.get(accountOf(h)) ?? []), h]);
    return [...byAccount.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, holdings]) => ({ name, holdings: holdings.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)) }));
  }, [all, account, type]);

  const shownCount = groups.reduce((n, g) => n + g.holdings.length, 0);
  const set = (key: string) => (value: string) => setParams({ ...params, [key]: value || undefined });

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Holdings</h2>
        <span className="muted" data-testid="holdings-date">
          {snap.data ? `Valuation as of ${snap.data.date}` : snap.loading ? "Loading…" : ""}
        </span>
      </header>
      {snap.error && <p className="error">{snap.error}</p>}

      <FilterBar active={!!(account || type)} onReset={() => setParams({})} summary={snap.loading ? "Loading…" : `${shownCount} of ${all.length} holdings`}>
        <FilterSelect label="Account" value={account} options={options.account} onChange={set("account")} testId="filter-account" />
        <FilterSelect label="Asset type" value={type} options={options.type} onChange={set("type")} testId="filter-type" />
      </FilterBar>

      <div className="table-wrap">
        <table data-testid="holdings-by-account" className="static">
          <thead>
            <tr>
              <th className="left">Instrument ▲</th>
              <th className="left">Asset type</th>
              <th>Qty</th>
              <th>Price %</th>
              <th>Accrued</th>
              <th>Value</th>
              <th>Cost</th>
              <th>Gain</th>
              <th>Gain %</th>
              <th>Coupons</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name}>
                <tr className="group" data-testid={`account-${g.name}`}>
                  <td className="left" colSpan={5}>
                    {g.name} <span className="muted">· {g.holdings.length}</span>
                  </td>
                  <SumCells s={sums(g.holdings)} />
                </tr>
                {g.holdings.map((h) => (
                  <tr key={`${g.name}/${h.isin}`} data-testid="holding-row" data-account={g.name}>
                    <td className="left indent instrument">
                      <strong>{h.code}</strong> <span className="muted">{h.name !== h.code ? h.name : ""}</span>
                    </td>
                    <td className="left">{typeLabel(h.type)}</td>
                    <td>{fmtInt(h.quantity)}</td>
                    <td title={h.priceDate ?? ""}>{fmtNum(h.cleanPrice)}</td>
                    <td>{fmtNum(h.accruedInterest)}</td>
                    <td>{fmtPln(h.value)}</td>
                    <td>{fmtPln(h.cost)}</td>
                    <td className={signClass(h.gain)}>{fmtPln(h.gain)}</td>
                    <td className={signClass(h.gainPct)}>{fmtPct(h.gainPct)}</td>
                    <td>{fmtPln(h.couponsReceived)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length > 1 && (
              <tr className="total" data-testid="holdings-total">
                <td className="left" colSpan={5}>
                  Total
                </td>
                <SumCells s={sums(groups.flatMap((g) => g.holdings))} />
              </tr>
            )}
            {!snap.loading && shownCount === 0 && (
              <tr>
                <td className="left muted" colSpan={10}>
                  {all.length === 0 ? "No open positions. Import transactions to get started (see data/README.md)." : "No holdings match the filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
