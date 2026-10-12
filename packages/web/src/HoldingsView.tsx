import { Fragment, useMemo, type ReactNode } from "react";
import { FilterBar, FilterSelect, uniqueOptions, type Option } from "./Filters.tsx";
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
const sums = (holdings: Holding[], cash = 0): Sums =>
  holdings.reduce(
    (s, h) => ({ value: s.value + (h.value ?? 0), cost: s.cost + h.cost, gain: s.gain + (h.gain ?? 0), couponsReceived: s.couponsReceived + h.couponsReceived }),
    { value: cash, cost: 0, gain: 0, couponsReceived: 0 },
  );
const add = (a: Sums, b: Sums): Sums => ({ value: a.value + b.value, cost: a.cost + b.cost, gain: a.gain + b.gain, couponsReceived: a.couponsReceived + b.couponsReceived });

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

interface Group {
  name: string;
  holdings: Holding[];
  /** Cash row, when shown (the account's cash is non-zero or it's incomplete). */
  cash: number | null;
  incomplete: string[];
  sums: Sums;
}

interface InstrumentGroup {
  isin: string;
  first: Holding;
  /** One row per account holding it. */
  holdings: Holding[];
  sums: Sums;
}

/** One holding as a row; `label` is what goes in the first column (the instrument, or the account). */
function HoldingRow({ h, label, account, detail }: { h: Holding; label: ReactNode; account: string; detail: boolean }) {
  return (
    <tr data-testid="holding-row" data-account={account}>
      <td className="left indent instrument">{label}</td>
      <td className="left">{detail ? typeLabel(h.type) : ""}</td>
      <td>{fmtInt(h.quantity)}</td>
      <td title={h.priceDate ?? ""}>{detail ? fmtNum(h.cleanPrice) : ""}</td>
      <td>{detail ? fmtNum(h.accruedInterest) : ""}</td>
      <td>{fmtPln(h.value)}</td>
      <td>{fmtPln(h.cost)}</td>
      <td className={signClass(h.gain)}>{fmtPln(h.gain)}</td>
      <td className={signClass(h.gainPct)}>{fmtPct(h.gainPct)}</td>
      <td>{fmtPln(h.couponsReceived)}</td>
    </tr>
  );
}

function CashRow({ account, cash, incomplete, label }: { account: string; cash: number; incomplete: boolean; label: ReactNode }) {
  return (
    <tr data-testid="cash-row" data-account={account} className={incomplete ? "muted" : ""}>
      <td className="left indent">{label}</td>
      <td className="left">{typeLabel("CASH")}</td>
      <td colSpan={3}></td>
      <td title={incomplete ? "Incomplete: purchases of untracked assets are missing, so this is too high. Not included in the sums." : ""}>{fmtPln(cash)}</td>
      <td colSpan={4}></td>
    </tr>
  );
}

const IncompleteFlag = ({ what }: { what: string[] }) => (
  <span className="flag" title="Not all assets of this account are tracked yet: its cash and value are incomplete" data-testid="incomplete">
    incomplete: {what.join(", ")} not tracked yet
  </span>
);

/**
 * Latest snapshot, grouped by account (default) or by instrument (`?group=instrument`).
 * By account: accounts alphabetically, instruments sorted by code, then the account's cash.
 * By instrument: instruments by code with one row per account, then a Cash group with one row per account.
 * An incomplete account (not all of its assets tracked yet) shows its cash greyed and leaves it out of the sums.
 * Filters: account, asset type ("Cash" shows only the cash rows).
 */
export function HoldingsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const snap = useApi<Snapshot>("/holdings");
  const all = useMemo(() => (snap.data?.holdings ?? []).filter((h) => h.quantity > 0), [snap.data]);
  const accounts = useMemo(() => snap.data?.accounts ?? {}, [snap.data]);
  const { account = "", type = "" } = params;
  const byInstrument = params["group"] === "instrument";

  const options = useMemo(() => {
    const names = new Set([...all.map(accountOf), ...Object.entries(accounts).filter(([, a]) => a.cash !== 0 || a.incomplete).map(([n]) => n)]);
    const hasCash = Object.values(accounts).some((a) => a.cash !== 0);
    const types: Option[] = uniqueOptions(all, (h) => ({ value: h.type, label: typeLabel(h.type) }));
    return {
      account: [...names].sort().map((n) => ({ value: n, label: n })),
      type: hasCash ? [...types, { value: "CASH", label: typeLabel("CASH") }].sort((a, b) => a.label.localeCompare(b.label)) : types,
    };
  }, [all, accounts]);

  const groups = useMemo((): Group[] => {
    return options.account
      .map((o) => o.value)
      .filter((name) => !account || name === account)
      .map((name): Group => {
        const info = accounts[name];
        const incomplete = info?.incomplete ?? [];
        const holdings = type === "CASH" ? [] : all.filter((h) => accountOf(h) === name && (!type || h.type === type)).sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
        const showCash = (!type || type === "CASH") && info !== undefined && (info.cash !== 0 || incomplete.length > 0);
        const cash = showCash ? info.cash : null;
        return { name, holdings, cash, incomplete, sums: sums(holdings, cash !== null && incomplete.length === 0 ? cash : 0) };
      })
      .filter((g) => g.holdings.length > 0 || g.cash !== null);
  }, [options.account, accounts, all, account, type]);

  // By instrument: the same filtered holdings, regrouped; cash becomes one group with a row per account.
  const instrumentGroups = useMemo((): InstrumentGroup[] => {
    const byIsin = new Map<string, Holding[]>();
    for (const g of groups) for (const h of g.holdings) byIsin.set(h.isin, [...(byIsin.get(h.isin) ?? []), h]);
    return [...byIsin.entries()]
      .map(([isin, hs]) => ({ isin, first: hs[0]!, holdings: hs.sort((a, b) => accountOf(a).localeCompare(accountOf(b))), sums: sums(hs) }))
      .sort((a, b) => a.first.code.localeCompare(b.first.code));
  }, [groups]);
  const cashRows = groups.filter((g) => g.cash !== null);
  const cashSums = sums([], cashRows.reduce((s, g) => s + (g.incomplete.length ? 0 : g.cash!), 0));
  const groupCount = byInstrument ? instrumentGroups.length + (cashRows.length ? 1 : 0) : groups.length;

  const shownCount = groups.reduce((n, g) => n + g.holdings.length, 0);
  const total = groups.reduce((s, g) => add(s, g.sums), sums([]));
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

      <div className="range" data-testid="group-by" role="group" aria-label="Group by">
        <span className="muted" style={{ alignSelf: "center", fontSize: "0.85rem" }}>
          Group by
        </span>
        {(["account", "instrument"] as const).map((g) => (
          <button
            key={g}
            type="button"
            className={(g === "instrument") === byInstrument ? "active" : ""}
            aria-pressed={(g === "instrument") === byInstrument}
            onClick={() => setParams({ ...params, group: g === "instrument" ? "instrument" : undefined })}
          >
            {g === "account" ? "Account" : "Instrument"}
          </button>
        ))}
      </div>

      <FilterBar active={!!(account || type)} onReset={() => setParams({ group: params["group"] })} summary={snap.loading ? "Loading…" : `${shownCount} of ${all.length} holdings`}>
        <FilterSelect label="Account" value={account} options={options.account} onChange={set("account")} testId="filter-account" />
        <FilterSelect label="Asset type" value={type} options={options.type} onChange={set("type")} testId="filter-type" />
      </FilterBar>

      <div className="table-wrap">
        <table data-testid="holdings-by-account" className="static">
          <thead>
            <tr>
              <th className="left">{byInstrument ? "Instrument ▲ / account" : "Instrument ▲"}</th>
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
            {byInstrument &&
              instrumentGroups.map((g) => (
                <Fragment key={g.isin}>
                  <tr className="group" data-testid={`instrument-${g.first.code}`}>
                    <td className="left instrument">
                      {g.first.code} <span className="muted">{g.first.name !== g.first.code ? g.first.name : ""} · {g.holdings.length}</span>
                    </td>
                    <td className="left">{typeLabel(g.first.type)}</td>
                    <td>{fmtInt(g.holdings.reduce((n, h) => n + h.quantity, 0))}</td>
                    <td title={g.first.priceDate ?? ""}>{fmtNum(g.first.cleanPrice)}</td>
                    <td>{fmtNum(g.first.accruedInterest)}</td>
                    <SumCells s={g.sums} />
                  </tr>
                  {g.holdings.map((h) => (
                    <HoldingRow key={`${g.isin}/${accountOf(h)}`} h={h} account={accountOf(h)} label={accountOf(h)} detail={false} />
                  ))}
                </Fragment>
              ))}
            {byInstrument && cashRows.length > 0 && (
              <Fragment key="cash">
                <tr className="group" data-testid="instrument-cash">
                  <td className="left" colSpan={5}>
                    Cash <span className="muted">· {cashRows.length}</span>
                  </td>
                  <SumCells s={cashSums} />
                </tr>
                {cashRows.map((g) => (
                  <CashRow
                    key={g.name}
                    account={g.name}
                    cash={g.cash!}
                    incomplete={g.incomplete.length > 0}
                    label={
                      <>
                        {g.name} {g.incomplete.length > 0 && <IncompleteFlag what={g.incomplete} />}
                      </>
                    }
                  />
                ))}
              </Fragment>
            )}
            {!byInstrument &&
              groups.map((g) => (
              <Fragment key={g.name}>
                <tr className="group" data-testid={`account-${g.name}`}>
                  <td className="left" colSpan={5}>
                    {g.name} <span className="muted">· {g.holdings.length}</span>
                    {g.incomplete.length > 0 && <IncompleteFlag what={g.incomplete} />}
                  </td>
                  <SumCells s={g.sums} />
                </tr>
                {g.holdings.map((h) => (
                  <HoldingRow
                    key={`${g.name}/${h.isin}`}
                    h={h}
                    account={g.name}
                    detail
                    label={
                      <>
                        <strong>{h.code}</strong> <span className="muted">{h.name !== h.code ? h.name : ""}</span>
                      </>
                    }
                  />
                ))}
                {g.cash !== null && <CashRow account={g.name} cash={g.cash} incomplete={g.incomplete.length > 0} label={<strong>Cash</strong>} />}
              </Fragment>
            ))}
            {groupCount > 1 && (
              <tr className="total" data-testid="holdings-total">
                <td className="left" colSpan={5}>
                  Total <span className="muted">(cash of incomplete accounts not included)</span>
                </td>
                <SumCells s={total} />
              </tr>
            )}
            {!snap.loading && groups.length === 0 && (
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
