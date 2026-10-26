import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ASSET_CLASSES,
  assetClassOf,
  type AssetClass,
} from "@portfolio/core/valuation/history";
import { positionsXirr } from "@portfolio/core/valuation/xirr";
import { CLASS_LABELS } from "./Allocation.tsx";
import { ChartPanel } from "./ChartPanel.tsx";
import { InstrumentSettingsButton } from "./InstrumentView.tsx";
import { DECISION_LABELS, holdSellKey, type HoldSellResponse } from "./HoldSellView.tsx";
import {
  FilterBar,
  FilterSelect,
  FilterText,
  FilterToggle,
  matchesText,
  uniqueOptions,
  type Option,
} from "./Filters.tsx";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import {
  fmtInt,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtPln,
  priceAge,
  priceAgeTitle,
  rangeBefore,
  rangeFrom,
  signClass,
  today,
  typeLabel,
  type RangeKey,
} from "./format.ts";
import { RangePicker } from "./RangePicker.tsx";
import { StickyTable, useStickyToolbar } from "./sticky.tsx";
import { useNarrow } from "./useNarrow.ts";
import { ValueChart, type ValuePoint } from "./ValueChart.tsx";
import type { ClosedPosition, Holding, Snapshot } from "./types.ts";
import { useApi } from "./useApi.ts";
import { RefreshPrices } from "./RefreshPrices.tsx";
import { useShowClosed } from "./showClosed.ts";
import {
  PositionTransactions,
  TransactionsButton,
  usePositionTransactions,
} from "./PositionTransactions.tsx";

const GROUP_LABELS = { account: "Account", class: "Class", instrument: "Instrument" };

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
    (s, h) => ({
      value: s.value + (h.value ?? 0),
      cost: s.cost + h.cost,
      gain: s.gain + (h.gain ?? 0),
      couponsReceived: s.couponsReceived + h.couponsReceived,
    }),
    { value: cash, cost: 0, gain: 0, couponsReceived: 0 },
  );
const add = (a: Sums, b: Sums): Sums => ({
  value: a.value + b.value,
  cost: a.cost + b.cost,
  gain: a.gain + b.gain,
  couponsReceived: a.couponsReceived + b.couponsReceived,
});

const CLOSED_XIRR_TITLE =
  "Money-weighted annual return over the time it was held: its buys, sales, redemptions, coupons and dividends, PLN at NBP D-1 (written off: −100 %). None under 30 days held.";
const XIRR_TITLE =
  "Money-weighted annual return of the positions' own cash flows (buys, sales, coupons, dividends, fees) and their value today, PLN at NBP D-1; cash left out (with cash: the Dashboard's Accounts table). None under 30 days held.";

/** XIRR (a fraction) as a cell; `undefined`: an empty cell (rows without one, e.g. cash). */
function XirrCell({ x, title = XIRR_TITLE }: { x: number | null | undefined; title?: string }) {
  if (x === undefined) return <td></td>;
  return (
    <td className={signClass(x)} title={title} data-testid="xirr">
      {x === null ? "–" : fmtPct(x * 100)}
    </td>
  );
}

function SumCells({ s, xirr }: { s: Sums; xirr?: number | null }) {
  const pct = s.cost ? (s.gain / s.cost) * 100 : null;
  return (
    <>
      <td>{fmtPln(s.value)}</td>
      <td>{fmtPln(s.cost)}</td>
      <td className={signClass(s.gain)}>{fmtPln(s.gain)}</td>
      <td className={signClass(pct)}>{fmtPct(pct)}</td>
      <XirrCell x={xirr} />
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
  /** Positions held no more ("Show closed"), last closed first. */
  closed: ClosedPosition[];
}

/**
 * Foreign cash (EUR, USD at IBKR) is cash like the PLN, shown next to it. It's held as a position because it was bought
 * with PLN at a rate: its cost is what the PLN paid, its gain the exchange-rate gain.
 */
const isForeignCash = (h: Holding) => h.type === "CURRENCY";
/** Asset type shown (and filtered by): foreign cash is "Cash". */
const shownType = (h: Holding) => (isForeignCash(h) ? "CASH" : h.type);
/** Instruments by code, foreign cash after them. */
const byCode = (a: Holding, b: Holding) =>
  Number(isForeignCash(a)) - Number(isForeignCash(b)) ||
  a.code.localeCompare(b.code) ||
  a.name.localeCompare(b.name);
const labelOf = (h: Holding) =>
  isForeignCash(h) ? (
    <>
      <strong>Cash</strong> <span className="ccy">{h.currency}</span>
    </>
  ) : (
    <InstrumentLabel code={h.code} name={h.name} />
  );
const FOREIGN_CASH_TITLE =
  "Foreign cash, bought with PLN: cost is the PLN paid, gain the exchange-rate gain. Click for its value over time.";

/** Price in the instrument's currency (ETFs: EUR …; bonds: % of nominal); foreign cash: the NBP rate. */
const fmtPrice = (h: Holding) =>
  isForeignCash(h)
    ? h.fx
      ? `${fmtNum(h.fx.rate, 4)} PLN`
      : "–"
    : h.cleanPrice !== null && h.currency !== "PLN"
      ? `${fmtNum(h.cleanPrice)} ${h.currency}`
      : fmtNum(h.cleanPrice);
/** Quantity; foreign cash: the amount in its currency. */
const fmtQty = (h: Holding, quantity = h.quantity) =>
  isForeignCash(h) ? `${fmtNum(quantity)} ${h.currency}` : fmtInt(quantity);
const priceTitle = (h: Holding) =>
  [
    priceAgeTitle(h.priceDate, h.priceTime),
    h.fx && `1 ${h.currency} = ${fmtNum(h.fx.rate, 4)} PLN (NBP, ${h.fx.date})`,
  ]
    .filter(Boolean)
    .join(" · ");

/** The newest price date among the holdings: a price older than it is marked with its date (no trade since). */
const NewestPrice = createContext<string | undefined>(undefined);

/** The price cell: the price, and before it the time of a price fetched during the day or the date of an older one. */
function PriceCell({ h, show = true }: { h: Holding; show?: boolean }) {
  const newest = useContext(NewestPrice);
  const age = isForeignCash(h)
    ? null
    : priceAge(h.priceDate, h.priceTime, newest);
  return (
    <td title={priceTitle(h)}>
      {show && age && (
        <span className="price-age" data-testid="price-age">
          {age}
        </span>
      )}
      {show ? fmtPrice(h) : ""}
    </td>
  );
}

interface InstrumentGroup {
  isin: string;
  first: Holding;
  /** One row per account holding it. */
  holdings: Holding[];
  sums: Sums;
}

/** By class: the positions of one asset class; cash: also each account's cash. */
interface ClassGroup {
  cls: AssetClass;
  holdings: Holding[];
  /** The accounts whose cash is shown (cash only). */
  cash: Group[];
  closed: ClosedPosition[];
  sums: Sums;
}

/** One holding as a row; `label` is what goes in the first column (the instrument, or the account). */
/** A fraction as "4,85 %". */
const fmtRate = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);

/** Buy, hold or sell verdicts per position (account#isin), for the badge on bond rows. */
const HoldSellVerdicts = createContext<ReadonlyMap<string, HoldSellResponse["rows"][number]>>(new Map());

/** "buy more" / "hold" / "sell" / "matures soon" on a bond row: a link to its row in Buy, hold or sell. */
function VerdictBadge({ account, isin }: { account: string; isin: string }) {
  const r = useContext(HoldSellVerdicts).get(`${account}#${isin}`);
  if (!r) return null;
  return (
    <a
      className={`flag verdict ${r.decision.toLowerCase()}`}
      href={`#/hold-sell?row=${encodeURIComponent(holdSellKey(r))}`}
      onClick={(e) => e.stopPropagation()}
      title={`Buy, hold or sell: ${r.decision === "MATURES" ? "matures in under 3 months" : `if held ${fmtRate(r.held.yieldIfHeld)}, if bought ${fmtRate(r.bought?.netYield)}, against ${fmtRate(r.held.alternative.yield)} (${r.held.alternative.label})`}`}
      data-testid="hs-badge"
    >
      {DECISION_LABELS[r.decision]}
    </a>
  );
}

function HoldingRow({
  h,
  label,
  second,
  account,
  detail,
  selected,
  onSelect,
  xirr,
}: {
  h: Holding;
  label: ReactNode;
  /** Second column: the asset type by default. */
  second?: ReactNode;
  account: string;
  detail: boolean;
  selected: boolean;
  onSelect: () => void;
  /** None for foreign cash. */
  xirr?: number | null;
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
      <td className="left">
        {second ?? typeLabel(shownType(h))}
        <VerdictBadge account={account} isin={h.isin} />
      </td>
      <td>{fmtQty(h)}</td>
      <PriceCell h={h} show={detail} />
      <td>{detail ? <AccruedCell h={h} /> : ""}</td>
      <td>{fmtPln(h.value)}</td>
      <td
        title={
          h.costNative
            ? `Paid ${fmtMoney(h.costNative.amount, h.costNative.currency)}; in PLN at the NBP rate of the day before each purchase`
            : ""
        }
      >
        {fmtPln(h.cost)}
      </td>
      <td className={signClass(h.gain)}>{fmtPln(h.gain)}</td>
      <td className={signClass(h.gainPct)}>{fmtPct(h.gainPct)}</td>
      <XirrCell x={xirr} />
      <td>{fmtPln(h.couponsReceived)}</td>
    </tr>
  );
}

/** Accrued interest per unit; a corporate bond without a rate for its period says so (valued at the clean price). */
function AccruedCell({ h }: { h: Holding }) {
  if (!h.noCouponRate) return <>{fmtNum(h.accruedInterest)}</>;
  const why = h.noCouponRate.from
    ? `no rate for the period from ${h.noCouponRate.from}`
    : "no coupon periods";
  return (
    <span
      className="flag warn"
      title={`Clean price only: ${why}. Open the bond's chart → "Coupon periods" to add it.`}
      data-testid="no-coupon-rate"
    >
      no rate
    </span>
  );
}

/** Closed positions: units whole, or with decimals (fund units). */
const fmtUnits = (q: number) =>
  Number.isInteger(q) ? fmtInt(q) : fmtNum(q, 4);
const byClosedDate = (a: ClosedPosition, b: ClosedPosition) =>
  b.closedDate.localeCompare(a.closedDate) || a.code.localeCompare(b.code);

/**
 * "Closed · n": the closed positions' header, with their realised gain and coupons (no value: nothing is held). No cost:
 * money moved from one to the next (e.g. between fund categories) would count once per position it went through.
 */
function ClosedHeader({
  closed,
  testId,
  xirr,
}: {
  closed: ClosedPosition[];
  testId: string;
  xirr?: number | null;
}) {
  const gain = closed.reduce((n, c) => n + c.gain, 0);
  return (
    <tr className="group closed" data-testid={testId}>
      <td
        className="left indent"
        colSpan={5}
        title="Sold, redeemed or written off: realised gain (what they brought in − their cost), coupons received. Not in the sums."
      >
        Closed <span className="muted">· {closed.length}</span>
      </td>
      <td></td>
      <td></td>
      <td className={signClass(gain)}>{fmtPln(gain)}</td>
      <td></td>
      <XirrCell x={xirr} title={CLOSED_XIRR_TITLE} />
      <td>{fmtPln(closed.reduce((n, c) => n + c.couponsReceived, 0))}</td>
    </tr>
  );
}

/**
 * A position held no more, greyed: the day it closed, units and cost at its largest (sold out and bought back again,
 * the units disposed of would count the same ones twice), realised gain (% of that cost), coupons.
 */
function ClosedRow({
  c,
  second,
  indent,
  selected,
  onSelect,
  xirr,
}: {
  c: ClosedPosition;
  second: ReactNode;
  indent: boolean;
  selected: boolean;
  onSelect: () => void;
  xirr?: number | null;
}) {
  return (
    <tr
      data-testid="closed-row"
      data-account={c.account}
      data-isin={c.isin}
      className={`clickable closed${selected ? " selected" : ""}`}
      onClick={onSelect}
      title={`Held ${c.firstDate} – ${c.closedDate}; ${fmtUnits(c.quantity)} units disposed of brought in ${fmtPln(c.proceeds)} against ${fmtPln(c.cost)} cost. Click for its value over time.`}
    >
      <td className={`left instrument${indent ? " indent" : ""}`}>
        <InstrumentLabel code={c.code} name={c.name} />
      </td>
      <td className="left">{second}</td>
      <td title="The most units held at once">{fmtUnits(c.peakQuantity)}</td>
      <td>
        <span className="flag" data-testid="closed-date">
          closed {c.closedDate}
        </span>
      </td>
      <td></td>
      <td>–</td>
      <td title="The most it cost at once (FIFO), fees included">
        {fmtPln(c.peakCost)}
      </td>
      <td
        className={signClass(c.gain)}
        title={`Realised: ${fmtPln(c.proceeds)} received − ${fmtPln(c.cost)} cost`}
      >
        {fmtPln(c.gain)}
      </td>
      <td className={signClass(c.gainPct)}>{fmtPct(c.gainPct)}</td>
      <XirrCell x={xirr} title={CLOSED_XIRR_TITLE} />
      <td>{fmtPln(c.couponsReceived)}</td>
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
const cashLinesOf = (info: {
  cash: number;
  baseCurrency?: string;
  currencies?: Record<
    string,
    { amount: number; value: number | null; rate?: number }
  >;
}): CashLine[] =>
  info.currencies
    ? Object.entries(info.currencies)
        .filter(([, c]) => c.amount !== 0)
        .sort(([a], [b]) => {
          const base = info.baseCurrency ?? "PLN";
          return a === base ? -1 : b === base ? 1 : a.localeCompare(b);
        })
        .map(([currency, c]) => ({
          currency,
          amount: c.amount,
          value: c.value,
          ...(c.rate ? { rate: c.rate } : {}),
        }))
    : [{ amount: info.cash, value: info.cash }];

function CashRow({
  account,
  line,
  incomplete,
  label,
  second = typeLabel("CASH"),
}: {
  account: string;
  line: CashLine;
  incomplete: boolean;
  label: ReactNode;
  second?: ReactNode;
}) {
  const foreign = line.currency && line.currency !== "PLN";
  return (
    <tr
      data-testid="cash-row"
      data-account={account}
      data-currency={line.currency ?? "PLN"}
      className={incomplete ? "muted" : ""}
    >
      <td className="left indent">
        {label}
        {line.currency && <span className="ccy"> {line.currency}</span>}
      </td>
      <td className="left">{second}</td>
      <td>{foreign ? `${fmtNum(line.amount)} ${line.currency}` : ""}</td>
      <td
        title={
          foreign && line.rate
            ? `1 ${line.currency} = ${fmtNum(line.rate, 4)} PLN (NBP)`
            : ""
        }
      >
        {foreign && line.rate ? `${fmtNum(line.rate, 4)} PLN` : ""}
      </td>
      <td></td>
      <td
        title={
          incomplete
            ? "Incomplete: purchases of untracked assets are missing, so this is too high. Not included in the sums."
            : ""
        }
      >
        {fmtPln(line.value)}
      </td>
      <td colSpan={5}></td>
    </tr>
  );
}

/** "▸ 2 accounts": expands an instrument (or cash) held in several accounts into one row per account. */
function ExpandToggle({
  open,
  count,
  onToggle,
  testId,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
  testId: string;
}) {
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
  <span
    className="flag"
    title="Not all assets of this account are tracked yet: its cash and value are incomplete"
    data-testid="incomplete"
  >
    incomplete: {what.join(", ")} not tracked yet
  </span>
);

/**
 * Latest snapshot, grouped by account (default) or by instrument (`?group=instrument`).
 * By account: accounts alphabetically, instruments sorted by code, then the account's cash.
 * By instrument: one row per instrument (by code) with the account it's in; one held in several accounts shows
 * "▸ n accounts" and expands into one row per account. Cash is one row the same way.
 * An incomplete account (not all of its assets tracked yet) shows its cash greyed and leaves it out of the sums.
 * Filters: account, asset type ("Cash" shows only the cash rows), free text (instruments whose name or code contains it; no cash rows then). "Show closed" (shared with Prices while the app is open) adds the positions held no
 * more, greyed, after the open ones (by account: in their account; by instrument: at the end), with their realised gain;
 * they're not in the sums. A closed row's chart ranges count back from the day it closed (ALL: the time it was held).
 * The filters and the table's header stay at the top while the list scrolls (as in Transactions).
 */
export function HoldingsView({
  params,
  setParams,
}: {
  params: Record<string, string>;
  setParams: (p: Record<string, string | undefined>) => void;
}) {
  const [showClosed, setShowClosed] = useShowClosed();
  const snap = useApi<Snapshot>("/holdings", {
    closed: showClosed ? "1" : undefined,
  });
  // Hold or sell: the verdict per bond position, as a badge on its row (only when bonds are held).
  const holdsBonds = (snap.data?.holdings ?? []).some((h) => h.type.startsWith("BOND"));
  const holdSell = useApi<HoldSellResponse>(holdsBonds ? "/hold-sell" : null);
  const verdicts = useMemo(
    () => new Map((holdSell.data?.rows ?? []).map((r) => [holdSellKey(r), r] as const)),
    [holdSell.data],
  );
  const all = useMemo(
    () => (snap.data?.holdings ?? []).filter((h) => h.quantity > 0),
    [snap.data],
  );
  const newestPrice = useMemo(
    () =>
      all
        .map((h) => h.priceDate)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1),
    [all],
  );
  const accounts = useMemo(() => snap.data?.accounts ?? {}, [snap.data]);
  /**
   * XIRR of a set of rows: their positions' own cash flows together, plus their value on the valuation day (closed
   * ones: none). Foreign cash and positions without a value are left out.
   */
  const xirrOf = useCallback(
    (holdings: Holding[], closed: ClosedPosition[] = []): number | null | undefined => {
      // Nothing but cash: no XIRR (an empty cell).
      if (closed.length === 0 && holdings.every(isForeignCash)) return undefined;
      const flows = snap.data?.flows ?? {};
      const valued = holdings.filter((h) => !isForeignCash(h) && h.value !== null);
      return positionsXirr(
        [...valued, ...closed].map((p) => flows[`${p.account}|${p.isin}`] ?? []),
        valued.reduce((n, h) => n + h.value!, 0),
        snap.data?.date ?? today(),
      );
    },
    [snap.data],
  );
  const { account = "", type = "", q: text = "" } = params;
  const closedAll = useMemo(
    () => (showClosed ? (snap.data?.closed ?? []) : []),
    [showClosed, snap.data],
  );
  const closedShown = useMemo(
    () =>
      closedAll
        .filter(
          (c) =>
            (!account || c.account === account) &&
            (!type || c.type === type) &&
            matchesText(text, c),
        )
        .sort(byClosedDate),
    [closedAll, account, type, text],
  );
  const byInstrument = params["group"] === "instrument";
  const byClass = params["group"] === "class";
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
  /** The position's transactions next to its chart (stays open from one row to the next). */
  const [showTxs, setShowTxs] = useState(false);
  const positionTxs = usePositionTransactions(chartIsin, chartAccount);
  // On a phone there's no room for both: the transactions take the chart's place.
  const txsOnly = useNarrow() && showTxs;
  const openHolding = (snap.data?.holdings ?? []).find(
    (h) =>
      h.isin === chartIsin && (!chartAccount || h.account === chartAccount),
  );
  // A closed position's chart: the range counts back from the day it closed.
  const chartClosed = openHolding
    ? undefined
    : closedAll.find((c) => c.isin === chartIsin && c.account === chartAccount);
  const history = useApi<ValuePoint[]>(chartIsin ? "/holdings/history" : null, {
    isin: chartIsin,
    account: chartAccount,
    from: chartClosed
      ? rangeBefore(range, chartClosed.closedDate, chartClosed.firstDate)
      : rangeFrom(range),
    to: chartClosed ? chartClosed.closedDate : today(),
  });
  const select = (isin: string, acct?: string) =>
    setParams(
      chartIsin === isin && chartAccount === acct
        ? { ...params, chart: undefined, chartAccount: undefined }
        : { ...params, chart: isin, chartAccount: acct },
    );
  const closeChart = useCallback(
    () => setParams({ ...params, chart: undefined, chartAccount: undefined }),
    [params, setParams],
  );
  const isSelected = (isin: string, acct?: string) =>
    chartIsin === isin && chartAccount === acct;
  const chartHolding:
    Pick<Holding, "isin" | "code" | "name" | "type" | "currency"> | undefined =
    (snap.data?.holdings ?? []).find((h) => h.isin === chartIsin) ??
    chartClosed;

  // A chart opened (e.g. from the URL) on one account of a multi-account instrument: show that row.
  useEffect(() => {
    if (byInstrument && chartIsin && chartAccount)
      setExpanded((e) => (e.has(chartIsin) ? e : new Set(e).add(chartIsin)));
  }, [byInstrument, chartIsin, chartAccount]);

  // Keep the clicked row visible above the panel.
  useEffect(() => {
    if (!chartIsin || panelHeight === 0) return;
    const row = document.querySelector<HTMLElement>("tr.selected");
    if (!row) return;
    const bottom = row.getBoundingClientRect().bottom;
    if (bottom > window.innerHeight - panelHeight)
      window.scrollBy({
        top: bottom - (window.innerHeight - panelHeight) + 16,
        behavior: "smooth",
      });
  }, [chartIsin, chartAccount, panelHeight]);

  const options = useMemo(() => {
    const names = new Set([
      ...all.map(accountOf),
      ...Object.entries(accounts)
        .filter(([, a]) => a.cash !== 0 || a.incomplete)
        .map(([n]) => n),
      ...closedAll.map((c) => c.account),
    ]);
    const hasCash =
      Object.values(accounts).some((a) => a.cash !== 0) ||
      all.some(isForeignCash);
    const types: Option[] = uniqueOptions(
      [...all.filter((h) => !isForeignCash(h)), ...closedAll],
      (h) => ({ value: h.type, label: typeLabel(h.type) }),
    );
    return {
      account: [...names].sort().map((n) => ({ value: n, label: n })),
      type: hasCash
        ? [...types, { value: "CASH", label: typeLabel("CASH") }].sort((a, b) =>
            a.label.localeCompare(b.label),
          )
        : types,
    };
  }, [all, accounts, closedAll]);

  const groups = useMemo((): Group[] => {
    return options.account
      .map((o) => o.value)
      .filter((name) => !account || name === account)
      .map((name): Group => {
        const info = accounts[name];
        const incomplete = info?.incomplete ?? [];
        // Text: instruments only (foreign cash isn't one).
        const holdings = all
          .filter(
            (h) =>
              accountOf(h) === name &&
              (!type || shownType(h) === type) &&
              (!text.trim() || (!isForeignCash(h) && matchesText(text, h))),
          )
          .sort(byCode);
        const showCash =
          (!type || type === "CASH") &&
          !text.trim() &&
          info !== undefined &&
          (info.cash !== 0 || incomplete.length > 0);
        const cash = showCash ? info.cash : null;
        const closed = closedShown.filter((c) => c.account === name);
        return {
          name,
          holdings,
          cash,
          cashLines: showCash ? cashLinesOf(info) : [],
          incomplete,
          sums: sums(
            holdings,
            cash !== null && incomplete.length === 0 ? cash : 0,
          ),
          closed,
        };
      })
      .filter(
        (g) => g.holdings.length > 0 || g.cash !== null || g.closed.length > 0,
      );
  }, [options.account, accounts, all, account, type, text, closedShown]);

  // By instrument: the same filtered holdings, regrouped; cash becomes one group with a row per account.
  const instrumentGroups = useMemo((): InstrumentGroup[] => {
    const byIsin = new Map<string, Holding[]>();
    for (const g of groups)
      for (const h of g.holdings)
        byIsin.set(h.isin, [...(byIsin.get(h.isin) ?? []), h]);
    return [...byIsin.entries()]
      .map(([isin, hs]) => ({
        isin,
        first: hs[0]!,
        holdings: hs.sort((a, b) => accountOf(a).localeCompare(accountOf(b))),
        sums: sums(hs),
      }))
      .sort((a, b) => byCode(a.first, b.first));
  }, [groups]);
  // Foreign cash goes after the PLN cash.
  const instrumentRows = instrumentGroups.filter(
    (g) => !isForeignCash(g.first),
  );
  const foreignCashGroups = instrumentGroups.filter((g) =>
    isForeignCash(g.first),
  );
  const cashRows = groups.filter((g) => g.cash !== null);
  const cashSums = sums(
    [],
    cashRows.reduce((s, g) => s + (g.incomplete.length ? 0 : g.cash!), 0),
  );

  // By class: the same filtered rows, regrouped into shares, bonds, cash (the accounts' cash and foreign cash), other.
  const classGroups = useMemo((): ClassGroup[] => {
    const holdings = groups.flatMap((g) => g.holdings);
    const cashGroups = groups.filter((g) => g.cash !== null);
    return ASSET_CLASSES.map((cls): ClassGroup => {
      const hs = holdings
        .filter((h) => assetClassOf(h) === cls)
        .sort((a, b) => byCode(a, b) || accountOf(a).localeCompare(accountOf(b)));
      const cash = cls === "CASH" ? cashGroups : [];
      return {
        cls,
        holdings: hs,
        cash,
        closed: closedShown.filter((c) => assetClassOf(c) === cls),
        sums: sums(
          hs,
          cash.reduce((n, g) => n + (g.incomplete.length ? 0 : g.cash!), 0),
        ),
      };
    }).filter(
      (g) => g.holdings.length > 0 || g.cash.length > 0 || g.closed.length > 0,
    );
  }, [groups, closedShown]);

  const groupCount = byInstrument
    ? instrumentGroups.length + (cashRows.length ? 1 : 0)
    : byClass
      ? classGroups.length
      : groups.length;

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
          title={
            isForeignCash(only)
              ? FOREIGN_CASH_TITLE
              : "Show its value over time"
          }
        >
          <td className="left instrument">{label}</td>
          <td className="left">{accountOf(only)}</td>
          <td>{fmtQty(only)}</td>
          <PriceCell h={only} />
          <td>
            <AccruedCell h={only} />
          </td>
          <SumCells
            s={g.sums}
            xirr={xirrOf(g.holdings)}
          />
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
            <ExpandToggle
              open={open}
              count={g.holdings.length}
              onToggle={() => toggle(g.isin)}
              testId={`expand-${g.first.code}`}
            />
          </td>
          <td>
            {fmtQty(
              g.first,
              g.holdings.reduce((n, h) => n + h.quantity, 0),
            )}
          </td>
          <PriceCell h={g.first} />
          <td>
            <AccruedCell h={g.first} />
          </td>
          <SumCells
            s={g.sums}
            xirr={xirrOf(g.holdings)}
          />
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
              xirr={xirrOf([h])}
            />
          ))}
      </Fragment>
    );
  };

  /** By class: the class's header, its positions, cash (the accounts' cash, then foreign cash), its closed positions. */
  const renderClass = (g: ClassGroup) => {
    const positions = g.holdings.filter((h) => !isForeignCash(h));
    return (
      <Fragment key={g.cls}>
        <tr className="group account-group" data-testid={`class-${g.cls}`}>
          <td className="left" colSpan={5}>
            {CLASS_LABELS[g.cls]}{" "}
            <span className="muted">
              ·{" "}
              {g.holdings.length +
                g.cash.reduce((n, c) => n + c.cashLines.length, 0)}
            </span>
          </td>
          <SumCells
            s={g.sums}
            xirr={xirrOf(positions)}
          />
        </tr>
        {positions.map((h) => (
          <HoldingRow
            key={`${accountOf(h)}/${h.isin}`}
            h={h}
            account={accountOf(h)}
            detail
            selected={isSelected(h.isin, accountOf(h))}
            onSelect={() => select(h.isin, accountOf(h))}
            label={labelOf(h)}
            second={accountOf(h)}
            xirr={xirrOf([h])}
          />
        ))}
        {g.cash.flatMap((c) =>
          c.cashLines.map((line) => (
            <CashRow
              key={`${c.name}/${line.currency ?? "PLN"}`}
              account={c.name}
              line={line}
              incomplete={c.incomplete.length > 0}
              label={<strong>Cash</strong>}
              second={
                <>
                  {c.name}{" "}
                  {c.incomplete.length > 0 && (
                    <IncompleteFlag what={c.incomplete} />
                  )}
                </>
              }
            />
          )),
        )}
        {g.holdings.filter(isForeignCash).map((h) => (
          <HoldingRow
            key={`${accountOf(h)}/${h.isin}`}
            h={h}
            account={accountOf(h)}
            detail
            selected={isSelected(h.isin, accountOf(h))}
            onSelect={() => select(h.isin, accountOf(h))}
            label={labelOf(h)}
            second={accountOf(h)}
          />
        ))}
        {g.closed.length > 0 && (
          <ClosedHeader
            closed={g.closed}
            testId={`closed-class-${g.cls}`}
            xirr={xirrOf([], g.closed)}
          />
        )}
        {g.closed.map((c) => (
          <ClosedRow
            key={`closed/${c.account}/${c.isin}`}
            c={c}
            second={c.account}
            indent
            selected={isSelected(c.isin, c.account)}
            onSelect={() => select(c.isin, c.account)}
            xirr={xirrOf([], [c])}
          />
        ))}
      </Fragment>
    );
  };

  const shownCount = groups.reduce((n, g) => n + g.holdings.length, 0);
  const total = groups.reduce((s, g) => add(s, g.sums), sums([]));
  const set = (key: string) => (value: string) =>
    setParams({ ...params, [key]: value || undefined });
  const [toolbar, stickyStyle] = useStickyToolbar();

  return (
    <NewestPrice.Provider value={newestPrice}>
    <HoldSellVerdicts.Provider value={verdicts}>
    <div style={stickyStyle}>
      <header className="view-header">
        <h2 className="view-title">Holdings</h2>
        <span className="view-meta">
          <span className="muted" data-testid="holdings-date">
            {snap.data ? (
              <>
                <span className="wide-only">Valuation </span>as of{" "}
                {snap.data.date}
              </>
            ) : snap.loading ? (
              "Loading…"
            ) : (
              ""
            )}
          </span>
          <RefreshPrices />
        </span>
      </header>
      {snap.error && <p className="error">{snap.error}</p>}

      {/* One control split in two (segmented): the chosen half filled. */}
      <div className="group-by">
        <span className="muted">Group by</span>
        <span
          className="segmented"
          data-testid="group-by"
          role="group"
          aria-label="Group by"
        >
          {(["account", "class", "instrument"] as const).map((g) => {
            const active = g === (params["group"] ?? "account");
            return (
              <button
                key={g}
                type="button"
                className={active ? "active" : ""}
                aria-pressed={active}
                onClick={() =>
                  setParams({
                    ...params,
                    group: g === "account" ? undefined : g,
                  })
                }
              >
                {GROUP_LABELS[g]}
              </button>
            );
          })}
        </span>
      </div>

      <div className="sticky-toolbar" ref={toolbar} data-testid="holdings-toolbar">
      <FilterBar
        compact
        activeCount={[account, type].filter(Boolean).length + (showClosed ? 1 : 0)}
        search={
          <FilterText
            label="Instrument"
            value={text}
            onChange={set("q")}
            testId="filter-text"
          />
        }
        active={!!(account || type || text)}
        onReset={() =>
          setParams({ group: params["group"], chart: chartIsin, chartAccount })
        }
        summary={
          snap.loading
            ? "Loading…"
            : `${shownCount} of ${all.length} holdings${showClosed ? ` + ${closedShown.length} closed` : ""}`
        }
      >
        <FilterSelect
          label="Account"
          value={account}
          options={options.account}
          onChange={set("account")}
          testId="filter-account"
          width="13rem"
        />
        <FilterSelect
          label="Asset type"
          value={type}
          options={options.type}
          onChange={set("type")}
          testId="filter-type"
        />
        <FilterToggle
          label="Show closed"
          checked={showClosed}
          onChange={setShowClosed}
          testId="show-closed"
          title="Also the positions sold, redeemed or written off, with their realised gain"
        />
      </FilterBar>
      </div>

      <StickyTable
        testId="holdings-by-account"
        className="static holdings"
        head={
            <tr>
              <th className="left">Instrument ▲</th>
              <th className="left">
                {byInstrument || byClass ? "Account" : "Asset type"}
              </th>
              <th>Qty</th>
              <th title="Bonds: % of nominal; others in their currency">
                Price
              </th>
              <th>Accrued</th>
              <th>Value</th>
              <th>Cost</th>
              <th>Gain</th>
              <th>Gain %</th>
              <th title={XIRR_TITLE}>XIRR</th>
              <th>Coupons</th>
            </tr>
        }
      >
          <tbody>
            {!snap.data && snap.loading && <SkeletonRows rows={10} cols={11} />}
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
                        {cashRows[0]!.name}{" "}
                        {cashRows[0]!.incomplete.length > 0 && (
                          <IncompleteFlag what={cashRows[0]!.incomplete} />
                        )}
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
                    <ExpandToggle
                      open={expanded.has("cash")}
                      count={cashRows.length}
                      onToggle={() => toggle("cash")}
                      testId="expand-cash"
                    />
                  </td>
                  <td colSpan={3}></td>
                  <td title="Accounts whose assets are all tracked (incomplete ones are greyed when expanded)">
                    {fmtPln(cashSums.value)}
                  </td>
                  <td colSpan={5}></td>
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
                            <span className="sub">└ {g.name}</span>{" "}
                            {g.incomplete.length > 0 && (
                              <IncompleteFlag what={g.incomplete} />
                            )}
                          </>
                        }
                      />
                    )),
                  )}
              </Fragment>
            )}
            {byInstrument && foreignCashGroups.map(renderInstrument)}
            {byInstrument && closedShown.length > 0 && (
              <>
                <ClosedHeader
                  closed={closedShown}
                  testId="closed-instruments"
                  xirr={xirrOf([], closedShown)}
                />
                {closedShown.map((c) => (
                  <ClosedRow
                    key={`${c.account}/${c.isin}`}
                    c={c}
                    second={c.account}
                    indent={false}
                    selected={isSelected(c.isin, c.account)}
                    onSelect={() => select(c.isin, c.account)}
                    xirr={xirrOf([], [c])}
                  />
                ))}
              </>
            )}
            {byClass && classGroups.map(renderClass)}
            {!byInstrument &&
              !byClass &&
              groups.map((g) => (
                <Fragment key={g.name}>
                  <tr
                    className="group account-group"
                    data-testid={`account-${g.name}`}
                  >
                    <td className="left" colSpan={5}>
                      {g.name}{" "}
                      <span className="muted">· {g.holdings.length}</span>
                      {g.incomplete.length > 0 && (
                        <IncompleteFlag what={g.incomplete} />
                      )}
                    </td>
                    <SumCells s={g.sums} xirr={xirrOf(g.holdings)} />
                  </tr>
                  {g.holdings
                    .filter((h) => !isForeignCash(h))
                    .map((h) => (
                      <HoldingRow
                        key={`${g.name}/${h.isin}`}
                        h={h}
                        account={g.name}
                        detail
                        selected={isSelected(h.isin, g.name)}
                        onSelect={() => select(h.isin, g.name)}
                        label={labelOf(h)}
                        xirr={xirrOf([h])}
                      />
                    ))}
                  {g.cashLines.map((line) => (
                    <CashRow
                      key={line.currency ?? "PLN"}
                      account={g.name}
                      line={line}
                      incomplete={g.incomplete.length > 0}
                      label={<strong>Cash</strong>}
                    />
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
                  {g.closed.length > 0 && (
                    <ClosedHeader
                      closed={g.closed}
                      testId={`closed-${g.name}`}
                      xirr={xirrOf([], g.closed)}
                    />
                  )}
                  {g.closed.map((c) => (
                    <ClosedRow
                      key={`closed/${c.isin}`}
                      c={c}
                      second={typeLabel(c.type)}
                      indent
                      selected={isSelected(c.isin, g.name)}
                      onSelect={() => select(c.isin, g.name)}
                      xirr={xirrOf([], [c])}
                    />
                  ))}
                </Fragment>
              ))}
            {groupCount > 1 && (
              <tr className="total" data-testid="holdings-total">
                <td className="left" colSpan={5}>
                  Total{" "}
                  {groups.some((g) => g.incomplete.length > 0) && (
                    <span className="muted">
                      (cash of incomplete accounts not included)
                    </span>
                  )}
                </td>
                <SumCells
                  s={total}
                  xirr={xirrOf(groups.flatMap((g) => g.holdings))}
                />
              </tr>
            )}
            {!snap.loading && groups.length === 0 && (
              <tr>
                <td className="left muted" colSpan={11}>
                  {all.length === 0
                    ? "No open positions. Import transactions to get started (see data/README.md)."
                    : "No holdings match the filters."}
                </td>
              </tr>
            )}
          </tbody>
      </StickyTable>
      {/* Room below the list so its last rows can scroll above the docked chart. */}
      {chartIsin && <div style={{ height: panelHeight }} aria-hidden />}
      {chartIsin && (
        <ChartPanel
          actions={
            <>
              {/* On a phone with the transactions open there's no chart: no range either. */}
              {!txsOnly && (
                <RangePicker
                  value={range}
                  onChange={setRange}
                  busy={history.loading}
                  testId="holding-range"
                />
              )}
              <span className="chart-panel-actions-end">
                <TransactionsButton
                  open={showTxs}
                  onToggle={() => setShowTxs(!showTxs)}
                  count={
                    positionTxs.loading ? undefined : positionTxs.rows.length
                  }
                />
                <InstrumentSettingsButton isin={chartIsin} from="holdings" />
              </span>
            </>
          }
          onClose={closeChart}
          onHeight={setPanelHeight}
          title={
            <>
              {chartHolding?.code ?? chartIsin}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                {chartHolding && chartHolding.name !== chartHolding.code
                  ? chartHolding.name
                  : ""}{" "}
                · {chartAccount ?? "all accounts"} · value and cost
                {chartClosed &&
                  ` · held ${chartClosed.firstDate} – ${chartClosed.closedDate}`}
              </span>
            </>
          }
        >
          <div className="chart-with-side">
            {!txsOnly && (
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {history.error ? (
                  <p className="error">{history.error}</p>
                ) : (
                  <ValueChart
                    testId="holding-chart"
                    data={history.data ?? []}
                    loading={history.loading}
                  />
                )}
              </div>
            )}
            {showTxs && (
              <div className="chart-side">
                <PositionTransactions
                  rows={positionTxs.rows}
                  loading={positionTxs.loading}
                  error={positionTxs.error}
                  showAccount={!chartAccount}
                />
              </div>
            )}
          </div>
        </ChartPanel>
      )}
    </div>
    </HoldSellVerdicts.Provider>
    </NewestPrice.Provider>
  );
}
