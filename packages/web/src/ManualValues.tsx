import { useEffect, useState } from "react";
import { apiSend } from "./api.ts";
import { fmtNum, parseNum, today } from "./format.ts";
import type { Price } from "./types.ts";
import { useApi } from "./useApi.ts";
import { useTxForm } from "./txForm.ts";

/**
 * Values of an asset valued by hand (no price source): "Edit values" opens a small form (date, value per unit) above the
 * chart, with the values entered so far, newest first; each can be deleted (a second click confirms). While a value is
 * saved or deleted, its button shows a spinner and the list says it's updating.
 */
export function ManualValues({ isin, code, currency }: { isin: string; code: string; currency: string }) {
  const { saved, version } = useTxForm();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  /** What's being sent: "save", or the date of the value being deleted. */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const values = useApi<Price[]>(open ? `/instruments/${isin}/prices` : null, { from: "1900-01-01", to: today() }, [isin, open, version]);
  // An unanswered "Delete?" goes back to ✕ after a few seconds.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const price = parseNum(value);
  const save = async () => {
    if (price === undefined || !(price > 0)) return setError("Enter the value per unit.");
    setPending("save");
    setError(null);
    try {
      await apiSend("POST", `/instruments/${isin}/prices`, { date, price });
      setValue("");
      saved(`${code}: value ${fmtNum(price)} ${currency} on ${date} saved.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  const remove = async (d: string) => {
    if (confirm !== d) return setConfirm(d);
    setPending(d);
    setError(null);
    try {
      await apiSend("DELETE", `/instruments/${isin}/prices/${d}`);
      setConfirm(null);
      saved(`${code}: value of ${d} deleted.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  if (!open)
    return (
      <button type="button" className="manual-open" onClick={() => setOpen(true)} title="Add or delete values entered by hand" data-testid="manual-value-open">
        Edit values
      </button>
    );
  const list = [...(values.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="manual-values" data-testid="manual-values">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Date" data-testid="manual-value-date" />
        <span className="with-unit">
          <input inputMode="decimal" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value per unit" data-testid="manual-value-price" />
          <span className="muted">{currency}</span>
        </span>
        <button type="submit" className="primary" disabled={busy || !date} data-testid="manual-value-save">
          {pending === "save" && <span className="spinner" aria-hidden />}
          {pending === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="icon-only" onClick={() => setOpen(false)} disabled={busy} title="Close" aria-label="Close the values" data-testid="manual-value-close">
          ✕
        </button>
      </form>
      {error && <p className="error" data-testid="manual-value-error">{error}</p>}
      <p className="manual-status muted" role="status" aria-live="polite" data-testid="manual-value-status">
        {pending === "save" ? "Saving the value…" : busy ? `Deleting the value of ${pending}…` : values.loading && values.data ? "Updating the list…" : ""}
        {(busy || (values.loading && values.data)) && <span className="spinner" aria-hidden />}
      </p>
      <ul className="manual-list" data-testid="manual-value-list">
        {values.loading && !values.data && <li className="muted">Loading…</li>}
        {list.map((p) => (
          <li key={p.date} className={pending === p.date ? "pending" : ""}>
            <span>{p.date}</span>
            <span className="num">
              {fmtNum(p.close)} {currency}
            </span>
            <button
              type="button"
              className={confirm === p.date ? "danger" : "link"}
              onClick={() => void remove(p.date)}
              disabled={busy}
              title={confirm === p.date ? "Click again to delete" : "Delete this value"}
              aria-label={confirm === p.date ? `Confirm: delete the value of ${p.date}` : `Delete the value of ${p.date}`}
              data-testid={`manual-value-delete-${p.date}`}
            >
              {pending === p.date && <span className="spinner" aria-hidden />}
              {pending === p.date ? "Deleting…" : confirm === p.date ? "Delete?" : "✕"}
            </button>
          </li>
        ))}
        {!values.loading && list.length === 0 && <li className="muted">No values yet.</li>}
      </ul>
    </div>
  );
}
