import { Icon } from "./Icons.tsx";
import { fmtMoney, fmtNum, signClass, TX_TYPE_LABELS } from "./format.ts";
import type { Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

/** "Transactions": shows or hides the position's transactions next to its chart (an icon on the smallest screens). */
export function TransactionsButton({
  open,
  onToggle,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={`toggle${open ? " active" : ""}`}
      aria-pressed={open}
      onClick={onToggle}
      title="The position's transactions, next to its chart"
      aria-label={`Transactions${count !== undefined ? ` (${count})` : ""}`}
      data-testid="position-tx-toggle"
    >
      {/* On the smallest screens the menu's Transactions icon instead of the word. */}
      <Icon name="transactions" size={16} className="tx-toggle-icon" />
      <span className="tx-toggle-label">Transactions</span>
      {count !== undefined && (
        <span className="count" data-testid="position-tx-count">
          {count}
        </span>
      )}
    </button>
  );
}

const fmtUnits = (q: number) => fmtNum(q, Number.isInteger(q) ? 0 : 4);

/** The instrument's transactions in one account (or in all, with an account column), newest first. */
export function usePositionTransactions(
  isin: string | undefined,
  account: string | undefined,
) {
  const txs = useApi<Transaction[]>(
    isin ? `/instruments/${isin}/transactions` : null,
  );
  const rows = (txs.data ?? [])
    .filter((t) => !account || t.account === account)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return { rows, loading: txs.loading, error: txs.error };
}

export function PositionTransactions({
  rows,
  loading,
  error,
  showAccount,
}: {
  rows: Transaction[];
  loading: boolean;
  error?: string;
  showAccount: boolean;
}) {
  if (error) return <p className="error">{error}</p>;
  return (
    <table className="static position-tx" data-testid="position-tx">
      <thead>
        <tr>
          <th className="left">Date</th>
          {showAccount && <th className="left">Account</th>}
          <th className="left">Type</th>
          <th>Qty</th>
          <th className="tx-price">Price</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr
            key={`${t.account}/${t.id}`}
            data-testid="position-tx-row"
            title={[
              t.price === undefined ? "" : `Price ${fmtNum(t.price)}`,
              t.note,
              t.fee ? `Fee ${fmtMoney(t.fee, t.currency)}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <td className="left">{t.date}</td>
            {showAccount && <td className="left">{t.account}</td>}
            <td className="left">{TX_TYPE_LABELS[t.type] ?? t.type}</td>
            <td>{t.quantity === undefined ? "–" : fmtUnits(t.quantity)}</td>
            <td className="tx-price">
              {t.price === undefined ? "–" : fmtNum(t.price)}
            </td>
            <td className={signClass(t.amount)}>
              {fmtMoney(t.amount, t.currency)}
            </td>
          </tr>
        ))}
        {!loading && rows.length === 0 && (
          <tr>
            <td className="left muted" colSpan={showAccount ? 6 : 5}>
              No transactions.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
