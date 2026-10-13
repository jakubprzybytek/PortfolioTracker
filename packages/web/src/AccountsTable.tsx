import { useState } from "react";
import { fmtPct, fmtPln, signClass } from "./format.ts";
import { SkeletonRows } from "./Placeholders.tsx";
import type { AccountSummary } from "./types.ts";
import { useApi } from "./useApi.ts";

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
      <td className={signClass(a.xirr)} title={`Money-weighted annual return since ${a.firstDate}`}>
        {pct(a.xirr)}
      </td>
      <td>{fmtPln(a.income)}</td>
      <td>{fmtPln(a.costs)}</td>
    </tr>
  );
}

/**
 * Per account: money put in, its value now, profit and the annual return (XIRR); total of the fully tracked accounts.
 * Closed accounts (emptied) come last, folded into one row ("▸ n closed accounts"); they stay in the total.
 */
export function AccountsTable() {
  const data = useApi<{ date: string; accounts: AccountSummary[]; total: AccountSummary }>("/accounts");
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
            <th title="Money-weighted annual return (XIRR) of deposits, withdrawals and today's total">XIRR</th>
            <th title="Coupons, interest and dividends received">Income</th>
            <th title="Commissions, fees and taxes paid">Costs</th>
          </tr>
        </thead>
        <tbody>
          {!data.data && <SkeletonRows rows={6} cols={9} />}
          {open.map((a) => (
            <Row key={a.account} a={a} />
          ))}
          {closed.length > 0 && (
            <tr className="closed" data-testid="closed-accounts">
              <td className="left" colSpan={9}>
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
