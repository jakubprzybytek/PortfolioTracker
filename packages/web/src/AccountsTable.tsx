import { Fragment, useState } from "react";
import { fmtMoney, fmtPct, fmtPln, signClass } from "./format.ts";
import { SkeletonRows } from "./Placeholders.tsx";
import type { AccountSummary } from "./types.ts";

const pct = (v: number | null) => (v === null ? "–" : fmtPct(v * 100));

function Row({ a, total = false }: { a: AccountSummary; total?: boolean }) {
  const incomplete = !!a.incomplete?.length;
  return (
    <tr
      className={total ? "total" : incomplete ? "muted" : a.closed ? "closed" : ""}
      data-testid={total ? "accounts-total" : "account-row"}
      data-account={a.account}
      title={
        incomplete
          ? `Incomplete: ${a.incomplete!.join(", ")} not tracked yet. Its figures are partial and not in the total.`
          : a.closed
            ? `Closed: emptied on ${a.lastDate}. Its profit stays in the total.`
            : ""
      }
    >
      <td className="left">
        {total ? (
          <>
            Total <span className="muted">(fully tracked accounts)</span>
          </>
        ) : (
          <>
            {a.closed ? <span className="sub">└ {a.account}</span> : a.account} {incomplete && <span className="flag">incomplete</span>}
            {a.closed && <span className="flag">closed {a.lastDate}</span>}
          </>
        )}
      </td>
      <td>{fmtPln(a.netDeposits)}</td>
      <td>{fmtPln(a.positions)}</td>
      <td>{fmtPln(a.cash)}</td>
      <td>{fmtPln(a.total)}</td>
      <td className={signClass(a.profit)}>{fmtPln(a.profit)}</td>
      <td className={signClass(a.unrealised)}>{fmtPln(a.unrealised)}</td>
      <td className={signClass(a.realised)}>{fmtPln(a.realised)}</td>
      <td className={signClass(a.xirr)} title={`Money-weighted annual return since ${a.firstDate}`}>
        {pct(a.xirr)}
      </td>
      <td>{fmtPln(a.income)}</td>
      <td>{fmtPln(a.costs)}</td>
    </tr>
  );
}

/** The account in its own currency (IBKR: EUR), under its PLN row. */
function BaseRow({ a }: { a: AccountSummary }) {
  const b = a.base!;
  return (
    <tr className={`base-row${a.closed ? " closed" : ""}`} data-testid="account-base-row" data-account={a.account} title={`${a.account} in ${b.currency}: deposits in ${b.currency} as made, others at the NBP rate of the day before; the total at today's rate`}>
      <td className="left">
        <span className="sub">└ in {b.currency}</span>
      </td>
      <td>{fmtMoney(b.netDeposits, b.currency)}</td>
      <td></td>
      <td></td>
      <td>{fmtMoney(b.total, b.currency)}</td>
      <td className={signClass(b.profit)}>{fmtMoney(b.profit, b.currency)}</td>
      <td colSpan={2}></td>
      <td className={signClass(b.xirr)}>{pct(b.xirr)}</td>
      <td colSpan={2}></td>
    </tr>
  );
}

/**
 * Per account: money put in, its value now, profit and the annual return (XIRR); total of the fully tracked accounts.
 * Closed accounts (emptied) come last, folded into one row ("▸ n closed accounts"); they stay in the total.
 */
/** `GET /accounts`. */
export interface AccountsResponse {
  date: string;
  accounts: AccountSummary[];
  total: AccountSummary;
}

/** The request's state, as the Dashboard loads it. */
export interface AccountsData {
  data?: AccountsResponse;
  error?: string;
  loading: boolean;
}

export function AccountsTable({ data }: { data: AccountsData }) {
  const [showClosed, setShowClosed] = useState(false);
  if (data.error) return <p className="error">{data.error}</p>;
  const open = data.data?.accounts.filter((a) => !a.closed) ?? [];
  const closed = data.data?.accounts.filter((a) => a.closed) ?? [];
  return (
    <div className="table-wrap">
      <table data-testid="accounts-table" className="static">
        <thead>
          <tr>
            <th className="left">Account</th>
            <th title="Deposits − withdrawals (transfers between your accounts count on both sides)">Net deposits</th>
            <th>Positions</th>
            <th>Cash</th>
            <th>Total</th>
            <th title="Total − net deposits: everything gained, realised or not, after costs">Profit</th>
            <th title="Open positions: value now − what they cost (FIFO)">Unrealised</th>
            <th title="Sales and redemptions: proceeds − what the units sold cost (FIFO), PLN at NBP D-1">Realised</th>
            <th title="Money-weighted annual return (XIRR) of deposits, withdrawals and today's total">XIRR</th>
            <th title="Coupons, interest and dividends received">Income</th>
            <th title="Commissions, fees and taxes paid">Costs</th>
          </tr>
        </thead>
        <tbody>
          {!data.data && <SkeletonRows rows={6} cols={11} />}
          {open.map((a) => (
            <Fragment key={a.account}>
              <Row a={a} />
              {a.base && <BaseRow a={a} />}
            </Fragment>
          ))}
          {closed.length > 0 && (
            <tr className="closed" data-testid="closed-accounts">
              <td className="left" colSpan={11}>
                <button type="button" className="link expand" aria-expanded={showClosed} onClick={() => setShowClosed((s) => !s)} data-testid="toggle-closed">
                  {showClosed ? "▾" : "▸"} {closed.length} closed account{closed.length > 1 ? "s" : ""}
                </button>
              </td>
            </tr>
          )}
          {showClosed && closed.map((a) => <Row key={a.account} a={a} />)}
          {data.data && <Row a={data.data.total} total />}
        </tbody>
      </table>
    </div>
  );
}
