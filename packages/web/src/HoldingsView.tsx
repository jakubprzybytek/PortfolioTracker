import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartPanel } from "./ChartPanel.tsx";
import { ManualValues } from "./ManualValues.tsx";
import { FilterBar, FilterSelect, uniqueOptions, type Option } from "./Filters.tsx";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { fmtInt, fmtMoney, fmtNum, fmtPct, fmtPln, rangeFrom, signClass, today, typeLabel, type RangeKey } from "./format.ts";
import { RangePicker } from "./RangePicker.tsx";
import { ValueChart, type ValuePoint } from "./ValueChart.tsx";
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
  /** Cash row, when shown (the account's cash is non-zero or it's incomplete): its PLN value. */
  cash: number | null;
  /** The cash per currency (PLN and others, each with its PLN value); one line without a currency for PLN-only accounts. */
  cashLines: CashLine[];
  incomplete: string[];
  sums: Sums;
}

/**
 * Foreign cash (EUR, USD at IBKR) is cash like the PLN, shown next to it. It's held as a position because it was bought
 * with PLN at a rate: its cost is what the PLN paid, its gain the exchange-rate gain.
 */
const isForeignCash = (h: Holding) => h.type === "CURRENCY";
/** Asset type shown (and filtered by): foreign cash is "Cash". */
const shownType = (h: Holding) => (isForeignCash(h) ? "CASH" : h.type);
/** Instruments by code, foreign cash after them. */
const byCode = (a: Holding, b: Holding) => Number(isForeignCash(a)) - Number(isForeignCash(b)) || a.code.localeCompare(b.code) || a.name.localeCompare(b.name);
const labelOf = (h: Holding) =>
  isForeignCash(h) ? (
    <>
      <strong>Cash</strong> <span className="ccy">{h.currency}</span>
    </>
  ) : (
    <InstrumentLabel code={h.code} name={h.name} />
  );
const FOREIGN_CASH_TITLE = "Foreign cash, bought with PLN: cost is the PLN paid, gain the exchange-rate gain. Click for its value over time.";

/** Price in the instrument's currency (ETFs: EUR …; bonds: % of nominal); foreign cash: the NBP rate. */
const fmtPrice = (h: Holding) =>
  isForeignCash(h) ? (h.fx ? `${fmtNum(h.fx.rate, 4)} PLN` : "–") : h.cleanPrice !== null && h.currency !== "PLN" ? `${fmtNum(h.cleanPrice)} ${h.currency}` : fmtNum(h.cleanPrice);
/** Quantity; foreign cash: the amount in its currency. */
const fmtQty = (h: Holding, quantity = h.quantity) => (isForeignCash(h) ? `${fmtNum(quantity)} ${h.currency}` : fmtInt(quantity));
const priceTitle = (h: Holding) =>
  [h.priceDate, h.fx && `1 ${h.currency} = ${fmtNum(h.fx.rate, 4)} PLN (NBP, ${h.fx.date})`].filter(Boolean).join(" · ");

interface InstrumentGroup {
  isin: string;
  first: Holding;
  /** One row per account holding it. */
  holdings: Holding[];
  sums: Sums;
}

/** One holding as a row; `label` is what goes in the first column (the instrument, or the account). */
function HoldingRow({
  h,
  label,
  second,
  account,
  detail,
  selected,
  onSelect,
}: {
  h: Holding;
  label: ReactNode;
  /** Second column: the asset type by default. */
  second?: ReactNode;
  account: string;
  detail: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      data-testid="holding-row"
      data-account={account}
      data-isin={h.isin}
      className={`clickable${selected ? " selected" : ""}`}
      onClick={onSelect}
      title={isForeignCash(h) ? FOREIGN_CASH_TITLE : "Show its value over time"}
    >
      <td className="left indent instrument">{label}</td>
      <td className="left">{second ?? typeLabel(shownType(h))}</td>
      <td>{fmtQty(h)}</td>
      <td title={priceTitle(h)}>{detail ? fmtPrice(h) : ""}</td>
      <td>{detail ? fmtNum(h.accruedInterest) : ""}</td>
      <td>{fmtPln(h.value)}</td>
      <td title={h.costNative ? `Paid ${fmtMoney(h.costNative.amount, h.costNative.currency)}; in PLN at the NBP rate of the day before each purchase` : ""}>{fmtPln(h.cost)}</td>
      <td className={signClass(h.gain)}>{fmtPln(h.gain)}</td>
      <td className={signClass(h.gainPct)}>{fmtPct(h.gainPct)}</td>
      <td>{fmtPln(h.couponsReceived)}</td>
    </tr>
  );
}

interface CashLine {
  /** Absent: the account holds only PLN. */
  currency?: string;
  amount: number;
  /** In PLN (null: no exchange rate). */
  value: number | null;
  rate?: number;
}

/**
 * An account's cash: one line, or one per currency it holds (each with its amount, the NBP rate and its PLN value),
 * the account's own currency first, then the others alphabetically.
 */
const cashLinesOf = (info: { cash: number; baseCurrency?: string; currencies?: Record<string, { amount: number; value: number | null; rate?: number }> }): CashLine[] =>
  info.currencies
    ? Object.entries(info.currencies)
        .filter(([, c]) => c.amount !== 0)
        .sort(([a], [b]) => {
          const base = info.baseCurrency ?? "PLN";
          return a === base ? -1 : b === base ? 1 : a.localeCompare(b);
        })
        .map(([currency, c]) => ({ currency, amount: c.amount, value: c.value, ...(c.rate ? { rate: c.rate } : {}) }))
    : [{ amount: info.cash, value: info.cash }];

function CashRow({ account, line, incomplete, label, second = typeLabel("CASH") }: { account: string; line: CashLine; incomplete: boolean; label: ReactNode; second?: ReactNode }) {
  const foreign = line.currency && line.currency !== "PLN";
  return (
    <tr data-testid="cash-row" data-account={account} data-currency={line.currency ?? "PLN"} className={incomplete ? "muted" : ""}>
      <td className="left indent">
        {label}
        {line.currency && <span className="ccy"> {line.currency}</span>}
      </td>
      <td className="left">{second}</td>
      <td>{foreign ? `${fmtNum(line.amount)} ${line.currency}` : ""}</td>
      <td title={foreign && line.rate ? `1 ${line.currency} = ${fmtNum(line.rate, 4)} PLN (NBP)` : ""}>{foreign && line.rate ? `${fmtNum(line.rate, 4)} PLN` : ""}</td>
      <td></td>
      <td title={incomplete ? "Incomplete: purchases of untracked assets are missing, so this is too high. Not included in the sums." : ""}>{fmtPln(line.value)}</td>
      <td colSpan={4}></td>
    </tr>
  );
}

/** "▸ 2 accounts": expands an instrument (or cash) held in several accounts into one row per account. */
function ExpandToggle({ open, count, onToggle, testId }: { open: boolean; count: number; onToggle: () => void; testId: string }) {
  return (
    <button
      type="button"
      className="link expand"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation(); // the row's own click opens the chart
        onToggle();
      }}
      data-testid={testId}
    >
      {open ? "▾" : "▸"} {count} accounts
    </button>
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
 * By instrument: one row per instrument (by code) with the account it's in; one held in several accounts shows
 * "▸ n accounts" and expands into one row per account. Cash is one row the same way.
 * An incomplete account (not all of its assets tracked yet) shows its cash greyed and leaves it out of the sums.
 * Filters: account, asset type ("Cash" shows only the cash rows).
 */
export function HoldingsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const snap = useApi<Snapshot>("/holdings");
  const all = useMemo(() => (snap.data?.holdings ?? []).filter((h) => h.quantity > 0), [snap.data]);
  const accounts = useMemo(() => snap.data?.accounts ?? {}, [snap.data]);
  const { account = "", type = "" } = params;
  const byInstrument = params["group"] === "instrument";
  // By instrument: instruments (ISIN, or "cash") expanded into their accounts.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Row chart: `chart` = ISIN, `chartAccount` = one account's position (absent: the instrument across accounts).
  const chartIsin = params["chart"];
  const chartAccount = params["chartAccount"];
  const [range, setRange] = useState<RangeKey>("1Y");
  const [panelHeight, setPanelHeight] = useState(0);
  const history = useApi<ValuePoint[]>(chartIsin ? "/holdings/history" : null, { isin: chartIsin, account: chartAccount, from: rangeFrom(range), to: today() }, [chartIsin, chartAccount, range]);
  const select = (isin: string, acct?: string) =>
    setParams(chartIsin === isin && chartAccount === acct ? { ...params, chart: undefined, chartAccount: undefined } : { ...params, chart: isin, chartAccount: acct });
  const closeChart = useCallback(() => setParams({ ...params, chart: undefined, chartAccount: undefined }), [params, setParams]);
  const isSelected = (isin: string, acct?: string) => chartIsin === isin && chartAccount === acct;
  const chartHolding = (snap.data?.holdings ?? []).find((h) => h.isin === chartIsin);

  // A chart opened (e.g. from the URL) on one account of a multi-account instrument: show that row.
  useEffect(() => {
    if (byInstrument && chartIsin && chartAccount) setExpanded((e) => (e.has(chartIsin) ? e : new Set(e).add(chartIsin)));
  }, [byInstrument, chartIsin, chartAccount]);

  // Keep the clicked row visible above the panel.
  useEffect(() => {
    if (!chartIsin || panelHeight === 0) return;
    const row = document.querySelector<HTMLElement>("tr.selected");
    if (!row) return;
    const bottom = row.getBoundingClientRect().bottom;
    if (bottom > window.innerHeight - panelHeight) window.scrollBy({ top: bottom - (window.innerHeight - panelHeight) + 16, behavior: "smooth" });
  }, [chartIsin, chartAccount, panelHeight]);

  const options = useMemo(() => {
    const names = new Set([...all.map(accountOf), ...Object.entries(accounts).filter(([, a]) => a.cash !== 0 || a.incomplete).map(([n]) => n)]);
    const hasCash = Object.values(accounts).some((a) => a.cash !== 0) || all.some(isForeignCash);
    const types: Option[] = uniqueOptions(
      all.filter((h) => !isForeignCash(h)),
      (h) => ({ value: h.type, label: typeLabel(h.type) }),
    );
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
        const holdings = all.filter((h) => accountOf(h) === name && (!type || shownType(h) === type)).sort(byCode);
        const showCash = (!type || type === "CASH") && info !== undefined && (info.cash !== 0 || incomplete.length > 0);
        const cash = showCash ? info.cash : null;
        return { name, holdings, cash, cashLines: showCash ? cashLinesOf(info) : [], incomplete, sums: sums(holdings, cash !== null && incomplete.length === 0 ? cash : 0) };
      })
      .filter((g) => g.holdings.length > 0 || g.cash !== null);
  }, [options.account, accounts, all, account, type]);

  // By instrument: the same filtered holdings, regrouped; cash becomes one group with a row per account.
  const instrumentGroups = useMemo((): InstrumentGroup[] => {
    const byIsin = new Map<string, Holding[]>();
    for (const g of groups) for (const h of g.holdings) byIsin.set(h.isin, [...(byIsin.get(h.isin) ?? []), h]);
    return [...byIsin.entries()]
      .map(([isin, hs]) => ({ isin, first: hs[0]!, holdings: hs.sort((a, b) => accountOf(a).localeCompare(accountOf(b))), sums: sums(hs) }))
      .sort((a, b) => byCode(a.first, b.first));
  }, [groups]);
  // Foreign cash goes after the PLN cash.
  const instrumentRows = instrumentGroups.filter((g) => !isForeignCash(g.first));
  const foreignCashGroups = instrumentGroups.filter((g) => isForeignCash(g.first));
  const cashRows = groups.filter((g) => g.cash !== null);
  const cashSums = sums([], cashRows.reduce((s, g) => s + (g.incomplete.length ? 0 : g.cash!), 0));
  const groupCount = byInstrument ? instrumentGroups.length + (cashRows.length ? 1 : 0) : groups.length;

  /** By instrument: one instrument (or foreign currency) with its accounts. */
  const renderInstrument = (g: InstrumentGroup) => {
    const multi = g.holdings.length > 1;
    const open = multi && expanded.has(g.isin);
    const only = g.holdings[0]!;
    const label = labelOf(g.first);
    // Held in one account: the instrument row is that position (its chart, its account).
    if (!multi)
      return (
        <tr
          key={g.isin}
          className={`clickable${isSelected(g.isin, accountOf(only)) ? " selected" : ""}`}
          data-testid={`instrument-${g.first.code}`}
          data-account={accountOf(only)}
          onClick={() => select(g.isin, accountOf(only))}
          title={isForeignCash(only) ? FOREIGN_CASH_TITLE : "Show its value over time"}
        >
          <td className="left instrument">{label}</td>
          <td className="left">{accountOf(only)}</td>
          <td>{fmtQty(only)}</td>
          <td title={priceTitle(only)}>{fmtPrice(only)}</td>
          <td>{fmtNum(only.accruedInterest)}</td>
          <SumCells s={g.sums} />
        </tr>
      );
    return (
      <Fragment key={g.isin}>
        <tr
          className={`clickable${isSelected(g.isin) ? " selected" : ""}`}
          data-testid={`instrument-${g.first.code}`}
          onClick={() => select(g.isin)}
          title="Show its value over time (all accounts)"
        >
          <td className="left instrument">{label}</td>
          <td className="left">
            <ExpandToggle open={open} count={g.holdings.length} onToggle={() => toggle(g.isin)} testId={`expand-${g.first.code}`} />
          </td>
          <td>{fmtQty(g.first, g.holdings.reduce((n, h) => n + h.quantity, 0))}</td>
          <td title={priceTitle(g.first)}>{fmtPrice(g.first)}</td>
          <td>{fmtNum(g.first.accruedInterest)}</td>
          <SumCells s={g.sums} />
        </tr>
        {open &&
          g.holdings.map((h) => (
            <HoldingRow
              key={`${g.isin}/${accountOf(h)}`}
              h={h}
              account={accountOf(h)}
              label=""
              second={<span className="sub">└ {accountOf(h)}</span>}
              detail={false}
              selected={isSelected(g.isin, accountOf(h))}
              onSelect={() => select(g.isin, accountOf(h))}
            />
          ))}
      </Fragment>
    );
  };

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

      <FilterBar active={!!(account || type)} onReset={() => setParams({ group: params["group"], chart: chartIsin, chartAccount })} summary={snap.loading ? "Loading…" : `${shownCount} of ${all.length} holdings`}>
        <FilterSelect label="Account" value={account} options={options.account} onChange={set("account")} testId="filter-account" width="13rem" />
        <FilterSelect label="Asset type" value={type} options={options.type} onChange={set("type")} testId="filter-type" />
      </FilterBar>

      <div className="table-wrap">
        <table data-testid="holdings-by-account" className="static">
          <thead>
            <tr>
              <th className="left">Instrument ▲</th>
              <th className="left">{byInstrument ? "Account" : "Asset type"}</th>
              <th>Qty</th>
              <th title="Bonds: % of nominal; others in their currency">Price</th>
              <th>Accrued</th>
              <th>Value</th>
              <th>Cost</th>
              <th>Gain</th>
              <th>Gain %</th>
              <th>Coupons</th>
            </tr>
          </thead>
          <tbody>
            {!snap.data && snap.loading && <SkeletonRows rows={10} cols={10} />}
            {byInstrument && instrumentRows.map(renderInstrument)}
            {byInstrument && cashRows.length === 1 && (
              <>
                {cashRows[0]!.cashLines.map((line) => (
                  <CashRow
                    key={line.currency ?? "PLN"}
                    account={cashRows[0]!.name}
                    line={line}
                    incomplete={cashRows[0]!.incomplete.length > 0}
                    label={<strong>Cash</strong>}
                    second={
                      <>
                        {cashRows[0]!.name} {cashRows[0]!.incomplete.length > 0 && <IncompleteFlag what={cashRows[0]!.incomplete} />}
                      </>
                    }
                  />
                ))}
              </>
            )}
            {byInstrument && cashRows.length > 1 && (
              <Fragment key="cash">
                <tr data-testid="instrument-cash">
                  <td className="left">
                    <strong>Cash</strong>
                  </td>
                  <td className="left">
                    <ExpandToggle open={expanded.has("cash")} count={cashRows.length} onToggle={() => toggle("cash")} testId="expand-cash" />
                  </td>
                  <td colSpan={3}></td>
                  <td title="Accounts whose assets are all tracked (incomplete ones are greyed when expanded)">{fmtPln(cashSums.value)}</td>
                  <td colSpan={4}></td>
                </tr>
                {expanded.has("cash") &&
                  cashRows.flatMap((g) =>
                    g.cashLines.map((line) => (
                      <CashRow
                        key={`${g.name}/${line.currency ?? "PLN"}`}
                        account={g.name}
                        line={line}
                        incomplete={g.incomplete.length > 0}
                        label=""
                        second={
                          <>
                            <span className="sub">└ {g.name}</span> {g.incomplete.length > 0 && <IncompleteFlag what={g.incomplete} />}
                          </>
                        }
                      />
                    )),
                  )}
              </Fragment>
            )}
            {byInstrument && foreignCashGroups.map(renderInstrument)}
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
                {g.holdings.filter((h) => !isForeignCash(h)).map((h) => (
                  <HoldingRow
                    key={`${g.name}/${h.isin}`}
                    h={h}
                    account={g.name}
                    detail
                    selected={isSelected(h.isin, g.name)}
                    onSelect={() => select(h.isin, g.name)}
                    label={labelOf(h)}
                  />
                ))}
                {g.cashLines.map((line) => (
                  <CashRow key={line.currency ?? "PLN"} account={g.name} line={line} incomplete={g.incomplete.length > 0} label={<strong>Cash</strong>} />
                ))}
                {g.holdings.filter(isForeignCash).map((h) => (
                  <HoldingRow
                    key={`${g.name}/${h.isin}`}
                    h={h}
                    account={g.name}
                    detail
                    selected={isSelected(h.isin, g.name)}
                    onSelect={() => select(h.isin, g.name)}
                    label={labelOf(h)}
                  />
                ))}
              </Fragment>
            ))}
            {groupCount > 1 && (
              <tr className="total" data-testid="holdings-total">
                <td className="left" colSpan={5}>
                  Total {groups.some((g) => g.incomplete.length > 0) && <span className="muted">(cash of incomplete accounts not included)</span>}
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
      {/* Room below the list so its last rows can scroll above the docked chart. */}
      {chartIsin && <div style={{ height: panelHeight }} aria-hidden />}
      {chartIsin && (
        <ChartPanel
          onClose={closeChart}
          onHeight={setPanelHeight}
          title={
            <>
              {chartHolding?.code ?? chartIsin}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                {chartHolding && chartHolding.name !== chartHolding.code ? chartHolding.name : ""} · {chartAccount ?? "all accounts"} · value and cost
              </span>
            </>
          }
        >
          <div className="chart-tools">
            <RangePicker value={range} onChange={setRange} busy={history.loading} testId="holding-range" />
            {chartHolding?.type === "FUND_MANUAL" && <ManualValues key={chartHolding.isin} isin={chartHolding.isin} code={chartHolding.code} currency={chartHolding.currency} />}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {history.error ? <p className="error">{history.error}</p> : <ValueChart testId="holding-chart" data={history.data ?? []} loading={history.loading} />}
          </div>
        </ChartPanel>
      )}
    </>
  );
}
