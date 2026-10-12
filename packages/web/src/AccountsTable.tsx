import { fmtPct, fmtPln, signClass } from "./format.ts";
import type { AccountSummary } from "./types.ts";
import { useApi } from "./useApi.ts";

const pct = (v: number | null) => (v === null ? "–" : fmtPct(v * 100));

function Row({ a, total = false }: { a: AccountSummary; total?: boolean }) {
  const incomplete = !!a.incomplete?.length;
  return (
    <tr
      className={total ? "total" : incomplete ? "muted" : ""}
      data-testid={total ? "accounts-total" : "account-row"}
      data-account={a.account}
      title={incomplete ? `Incomplete: ${a.incomplete!.join(", ")} not tracked yet. Its figures are partial and not in the total.` : ""}
    >
      <td className="left">
        {total ? (
          <>
            Total <span className="muted">(fully tracked accounts)</span>
          </>
        ) : (
          <>
            {a.account} {incomplete && <span className="flag">incomplete</span>}
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

/** Per account: money put in, its value now, profit and the annual return (XIRR); total of the fully tracked accounts. */
export function AccountsTable() {
  const data = useApi<{ date: string; accounts: AccountSummary[]; total: AccountSummary }>("/accounts");
  if (data.error) return <p className="error">{data.error}</p>;
  if (!data.data) return <p className="muted">{data.loading ? "Loading…" : ""}</p>;
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
          {data.data.accounts.map((a) => (
            <Row key={a.account} a={a} />
          ))}
          <Row a={data.data.total} total />
        </tbody>
      </table>
    </div>
  );
}
