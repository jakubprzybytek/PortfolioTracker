import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, apiSend } from "./api.ts";
import { TX_TYPE_LABELS, addDays, fmtMoney, fmtNum, parseNum, today, typeLabel } from "./format.ts";
import type { AccountSummary, Instrument, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

// The "Add transaction" form (Docs/ui.md): a dialog over the Transactions view, for a new transaction or one
// being edited. The server checks it again (POST/PUT /transactions) and revalues from its date.

const TYPES = ["BUY", "SELL", "COUPON", "DIVIDEND", "REDEMPTION", "WRITE_OFF", "DEPOSIT", "WITHDRAWAL", "INTEREST", "FEE", "TAX", "EXCHANGE", "SPLIT"] as const;
type TxType = (typeof TYPES)[number];
/** Money out: stored as a negative amount (the form takes the size only). */
const MONEY_OUT = new Set<string>(["BUY", "FEE", "TAX", "WITHDRAWAL", "EXCHANGE"]);
/** Currencies money can be in (plus an instrument's own). */
const CURRENCIES = ["PLN", "EUR", "USD"];
const NEEDS_INSTRUMENT = new Set<string>(["BUY", "SELL", "COUPON", "DIVIDEND", "REDEMPTION", "SPLIT", "WRITE_OFF"]);
const HAS_QUANTITY = new Set<string>(["BUY", "SELL", "REDEMPTION"]);
/** No money moves: a split changes the units, a write-off closes them at 0 (the issuer defaulted). */
const NO_AMOUNT = new Set<string>(["SPLIT", "WRITE_OFF"]);
const NEW = "__new__";
const NEW_ACCOUNT = "__new_account__";

type NewKind = "treasury" | "etf" | "corporate" | "manual";
const NEW_KINDS: { kind: NewKind; label: string }[] = [
  { kind: "treasury", label: "Treasury bond: listed (DS1030) or retail (EDO1036)" },
  { kind: "etf", label: "ETF" },
  { kind: "corporate", label: "Corporate bond (Catalyst)" },
  { kind: "manual", label: "Other asset, valued by hand" },
];

const str = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));

const isBond = (i: Instrument) => i.type === "BOND_LISTED" || i.type === "BOND_CORPORATE" || i.type === "BOND_IBKR";
const nominalOf = (i: Instrument) => i.terms?.nominal ?? i.nominal ?? 1000;

/**
 * Value of one unit at `price` in the currency paid (bonds: % of nominal; retail: PLN per 100 PLN bond): as is when
 * paid in the instrument's currency, × the broker's rate when paid in PLN for a foreign one.
 */
function unitValue(i: Instrument, price: number, paidIn: string, fx: number | undefined): number {
  const rate = paidIn === i.currency ? 1 : paidIn === "PLN" ? (fx ?? NaN) : NaN;
  if (isBond(i)) return (price / 100) * nominalOf(i) * rate;
  return price * rate;
}

const priceLabel = (i: Instrument | undefined): string =>
  !i ? "Price" : isBond(i) ? "Price, % of nominal" : i.type === "BOND_RETAIL" ? "Price per bond, PLN" : `Price, ${i.currency}`;

function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`form-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="faint">{hint}</small>}
    </label>
  );
}

export function TransactionForm({ editing, onClose, onSaved }: { editing?: Transaction; onClose: () => void; onSaved: (message: string) => void }) {
  const instruments = useApi<Instrument[]>("/instruments");
  const summaries = useApi<{ accounts: AccountSummary[] }>("/accounts");
  const accounts = useMemo(() => (summaries.data?.accounts ?? []).map((a) => a.account), [summaries.data]);
  const [date, setDate] = useState(editing?.date ?? today());
  const [account, setAccount] = useState(editing?.account ?? accounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [type, setType] = useState<TxType>((editing?.type as TxType) ?? "BUY");
  const [isin, setIsin] = useState(editing?.isin ?? "");
  const [quantity, setQuantity] = useState(str(editing?.quantity));
  const [price, setPrice] = useState(str(editing?.price));
  const [fxRate, setFxRate] = useState(str(editing?.fxRate));
  const [fee, setFee] = useState(str(editing?.fee));
  const [amount, setAmount] = useState(editing ? str(Math.abs(editing.amount)) : "");
  const [amountTouched, setAmountTouched] = useState(!!editing);
  const [ratio, setRatio] = useState(str(editing?.ratio));
  // The currency of the amount and the fee (an account's own currency by default); an exchange's other side.
  const [currency, setCurrency] = useState(editing?.currency ?? "PLN");
  const [currencyTouched, setCurrencyTouched] = useState(!!editing);
  const [toAmount, setToAmount] = useState(str(editing?.toAmount));
  const [toCurrency, setToCurrency] = useState(editing?.toCurrency ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  // A new instrument, added on save.
  const [kind, setKind] = useState<NewKind>("treasury");
  const [fields, setFields] = useState({ code: "", isin: "", ticker: "", name: "", currency: "EUR", nominal: "1000" });
  const [found, setFound] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Opened before the accounts were known: take the first once they are.
  useEffect(() => {
    if (!account && accounts.length) setAccount(accounts[0]!);
  }, [account, accounts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const list = useMemo(() => [...(instruments.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code)), [instruments.data]);
  const inst = list.find((i) => i.isin === isin);
  const needsInstrument = NEEDS_INSTRUMENT.has(type);
  // Default currency: in an account kept in several currencies (IBKR), a trade in the instrument's currency and the
  // rest in the account's own; elsewhere PLN.
  const base = summaries.data?.accounts.find((a) => a.account === account)?.base?.currency ?? "PLN";
  const cur = currencyTouched ? currency : base !== "PLN" ? (needsInstrument && inst ? inst.currency : base) : "PLN";
  const otherCur = toCurrency || (cur === "PLN" ? (base !== "PLN" ? base : "EUR") : cur === base ? "PLN" : base);
  const currencyOptions = [...new Set([...CURRENCIES, ...(inst ? [inst.currency] : []), cur])];
  // Paid in PLN for an instrument in another currency (Bossa): the broker's rate is needed.
  const foreign = !!inst && inst.currency !== "PLN" && cur === "PLN";

  // NBP rate for a foreign instrument, as a starting point for the broker's rate.
  useEffect(() => {
    if (!foreign || !inst || fxRate || editing) return;
    let cancelled = false;
    api<{ date: string; value: number }[]>(`/indicators/fx-${inst.currency.toLowerCase()}`, { from: addDays(date, -10), to: date })
      .then((r) => !cancelled && r.length && setFxRate(str(r.at(-1)!.value)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [foreign, inst, date, fxRate, editing]);

  // Retail bonds are bought at 100 PLN.
  useEffect(() => {
    if (inst?.type === "BOND_RETAIL" && type === "BUY" && !price) setPrice("100");
  }, [inst, type, price]);

  const q = parseNum(quantity);
  const p = parseNum(price);
  const fx = parseNum(fxRate);
  const f = parseNum(fee) ?? 0;
  // Suggested size of the amount: the trade value (buy: without the fee, which comes on top; sell: net of it).
  const suggested = useMemo(() => {
    if (!inst || !HAS_QUANTITY.has(type) || q === undefined || p === undefined) return undefined;
    const value = q * unitValue(inst, p, cur, fx);
    if (!Number.isFinite(value)) return undefined;
    return Math.round((type === "SELL" ? value - f : value) * 100) / 100;
  }, [inst, type, q, p, fx, f, cur]);
  const amountShown = amountTouched ? amount : str(suggested);
  const size = parseNum(amountShown);
  const signed = NO_AMOUNT.has(type) ? 0 : size === undefined ? undefined : MONEY_OUT.has(type) ? -Math.abs(size) : Math.abs(size);
  const cashEffect = signed === undefined ? undefined : type === "BUY" ? signed - f : signed;

  async function lookup() {
    setFound(null);
    try {
      const r = await api<{ tracked: boolean; instrument: Instrument }>("/instruments/lookup", { code: fields.code });
      if (r.tracked) {
        setIsin(r.instrument.isin);
        setFound({ text: `${r.instrument.code} is already tracked: selected.`, ok: true });
      } else setFound({ text: `${r.instrument.name} · ${r.instrument.isin} · added when you save`, ok: true });
    } catch (e) {
      setFound({ text: (e as Error).message, ok: false });
    }
  }

  async function save() {
    setError(null);
    const acct = account === NEW_ACCOUNT ? newAccount.trim() : account;
    if (!acct) return setError("Choose an account");
    if (needsInstrument && !isin) return setError("Choose an instrument");
    for (const [label, v] of [["Quantity", q], ["Price", p], ["FX rate", fx], ["Fee", parseNum(fee)], ["Amount", size], ["Ratio", parseNum(ratio)]] as const)
      if (v !== undefined && !Number.isFinite(v)) return setError(`${label}: not a number`);
    if (!NO_AMOUNT.has(type) && signed === undefined) return setError("Enter the amount");
    if (type === "WRITE_OFF" && !(q !== undefined && q > 0)) return setError("Enter how many units are written off");
    const got = parseNum(toAmount);
    if (type === "EXCHANGE" && (got === undefined || !Number.isFinite(got) || got <= 0)) return setError("Enter what you got");
    if (type === "EXCHANGE" && otherCur === cur) return setError("Choose two different currencies");
    setBusy(true);
    try {
      let instrumentIsin = isin;
      if (needsInstrument && isin === NEW) {
        const body =
          kind === "treasury"
            ? { kind, code: fields.code }
            : kind === "etf"
              ? { kind, isin: fields.isin.toUpperCase(), ticker: fields.ticker, name: fields.name, currency: fields.currency.toUpperCase() }
              : kind === "corporate"
                ? { kind, isin: fields.isin.toUpperCase(), code: fields.code, name: fields.name, nominal: Number(fields.nominal) }
                : { kind, code: fields.code, name: fields.name };
        instrumentIsin = (await apiSend<Instrument>("POST", "/instruments", body)).isin;
      }
      const tx = {
        date,
        account: acct,
        type,
        ...(needsInstrument || (type === "INTEREST" && isin) ? { isin: instrumentIsin } : {}),
        ...((HAS_QUANTITY.has(type) || type === "WRITE_OFF") && q !== undefined ? { quantity: q } : {}),
        ...(HAS_QUANTITY.has(type) && p !== undefined ? { price: p } : {}),
        ...(foreign && fx !== undefined ? { fxRate: fx } : {}),
        ...(type === "SPLIT" ? { ratio: parseNum(ratio) } : {}),
        amount: signed ?? 0,
        ...(f ? { fee: f } : {}),
        ...(inst?.type === "BOND_RETAIL" && type === "BUY" ? { valueDate: date } : {}),
        ...(type === "EXCHANGE" ? { toAmount: got, toCurrency: otherCur } : {}),
        currency: cur,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      if (editing) await apiSend("PUT", `/transactions/${editing.id}`, tx, { account: editing.account });
      else await apiSend("POST", "/transactions", tx);
      onSaved(editing ? "Transaction updated." : "Transaction added.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    try {
      await apiSend("DELETE", `/transactions/${editing.id}`, undefined, { account: editing.account });
      onSaved("Transaction deleted.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit transaction" : "Add transaction"}
        data-testid="tx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="modal-header">
          <h2>{editing ? "Edit transaction" : "Add transaction"}</h2>
          <button type="button" className="chart-panel-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </header>

        <div className="form-grid">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="tx-date" />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as TxType)} data-testid="tx-type">
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TX_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account" wide={account === NEW_ACCOUNT}>
            <select value={account} onChange={(e) => setAccount(e.target.value)} data-testid="tx-account">
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              <option value={NEW_ACCOUNT}>New account…</option>
            </select>
            {account === NEW_ACCOUNT && <input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name" data-testid="tx-new-account" />}
          </Field>

          {(needsInstrument || type === "INTEREST") && (
            <Field label={type === "INTEREST" ? "Instrument (optional)" : "Instrument"} wide>
              <select value={isin} onChange={(e) => setIsin(e.target.value)} disabled={instruments.loading && !instruments.data} data-testid="tx-instrument">
                <option value="">{instruments.loading && !instruments.data ? "Loading…" : "Choose…"}</option>
                <optgroup label="Tracked">
                  {list
                    .filter((i) => i.active)
                    .map((i) => (
                      <option key={i.isin} value={i.isin}>
                        {i.code} · {i.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="No longer held">
                  {list
                    .filter((i) => !i.active)
                    .map((i) => (
                      <option key={i.isin} value={i.isin}>
                        {i.code} · {i.name}
                      </option>
                    ))}
                </optgroup>
                {needsInstrument && <option value={NEW}>➕ New instrument…</option>}
              </select>
              {inst && (
                <small className="faint">
                  {typeLabel(inst.type)} · {inst.isin} · {inst.currency}
                </small>
              )}
            </Field>
          )}

          {isin === NEW && needsInstrument && (
            <fieldset className="new-instrument wide" data-testid="tx-new-instrument">
              <legend>New instrument</legend>
              <select value={kind} onChange={(e) => setKind(e.target.value as NewKind)} data-testid="tx-new-kind">
                {NEW_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              {kind === "treasury" && (
                <div className="inline">
                  <input value={fields.code} onChange={set("code")} placeholder="Code, e.g. EDO1036" data-testid="tx-new-code" />
                  <button type="button" onClick={() => void lookup()} disabled={!fields.code.trim()} data-testid="tx-lookup">
                    Find
                  </button>
                </div>
              )}
              {kind === "etf" && (
                <>
                  <input value={fields.ticker} onChange={set("ticker")} placeholder="Ticker, e.g. AMS:VWRL or FRA:EUNK" />
                  <input value={fields.isin} onChange={set("isin")} placeholder="ISIN" />
                  <input value={fields.name} onChange={set("name")} placeholder="Name" />
                  <input value={fields.currency} onChange={set("currency")} placeholder="Currency (EUR)" maxLength={3} />
                </>
              )}
              {kind === "corporate" && (
                <>
                  <input value={fields.code} onChange={set("code")} placeholder="Code, e.g. KRU0628" />
                  <input value={fields.isin} onChange={set("isin")} placeholder="ISIN" />
                  <input value={fields.name} onChange={set("name")} placeholder="Issuer and coupon, e.g. Kruk S.A. (WIBOR 3M + 4%)" />
                  <select value={fields.nominal} onChange={set("nominal")}>
                    <option value="1000">Nominal 1000 PLN</option>
                    <option value="100">Nominal 100 PLN</option>
                  </select>
                </>
              )}
              {kind === "manual" && (
                <>
                  <input value={fields.code} onChange={set("code")} placeholder="Short code, e.g. FLAT-KRK" />
                  <input value={fields.name} onChange={set("name")} placeholder="Name" />
                </>
              )}
              {found && <small className={found.ok ? "faint" : "error"}>{found.text}</small>}
            </fieldset>
          )}

          {HAS_QUANTITY.has(type) && (
            <>
              <Field label="Quantity">
                <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="tx-quantity" />
              </Field>
              <Field label={priceLabel(inst)}>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="tx-price" />
              </Field>
            </>
          )}
          {foreign && HAS_QUANTITY.has(type) && (
            <Field label={`Rate, PLN per ${inst!.currency}`} hint="Your broker's rate (prefilled: NBP)">
              <input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} data-testid="tx-fx" />
            </Field>
          )}
          {type === "WRITE_OFF" && (
            <Field label="Quantity written off" hint="The units lost. Nothing comes back: they close at 0 and their cost becomes a loss.">
              <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="tx-quantity" />
            </Field>
          )}
          {type === "SPLIT" ? (
            <Field label="Units per unit before" hint="100:1 split: 100">
              <input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} data-testid="tx-ratio" />
            </Field>
          ) : type === "WRITE_OFF" ? null : (
            <>
              <Field
                label={type === "BUY" ? "Amount paid (without the fee)" : type === "SELL" ? "Amount received (after the fee)" : type === "EXCHANGE" ? "You gave" : "Amount"}
                hint={inst && isBond(inst) && type === "BUY" ? "Suggested: price × nominal. Add accrued interest, as on your broker's note." : undefined}
              >
                <div className="with-currency">
                  <input
                    inputMode="decimal"
                    value={amountShown}
                    onChange={(e) => {
                      setAmountTouched(true);
                      setAmount(e.target.value);
                    }}
                    data-testid="tx-amount"
                  />
                  <select
                    value={cur}
                    onChange={(e) => {
                      setCurrencyTouched(true);
                      setCurrency(e.target.value);
                    }}
                    aria-label="Currency"
                    data-testid="tx-currency"
                  >
                    {currencyOptions.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </Field>
              {type === "EXCHANGE" && (
                <Field label="You got">
                  <div className="with-currency">
                    <input inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} data-testid="tx-to-amount" />
                    <select value={otherCur} onChange={(e) => setToCurrency(e.target.value)} aria-label="Currency received" data-testid="tx-to-currency">
                      {[...new Set([...CURRENCIES, otherCur])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </Field>
              )}
              {(HAS_QUANTITY.has(type) || type === "EXCHANGE") && (
                <Field label={`Fee, ${cur}`}>
                  <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} data-testid="tx-fee" />
                </Field>
              )}
            </>
          )}
          <Field label="Note" wide>
            <input value={note} onChange={(e) => setNote(e.target.value)} data-testid="tx-note" />
          </Field>
        </div>

        <p className="form-summary" data-testid="tx-summary">
          {cashEffect !== undefined && !NO_AMOUNT.has(type) ? (
            <>
              Cash in {account === NEW_ACCOUNT ? newAccount || "the new account" : account}:{" "}
              <strong className={cashEffect < 0 ? "neg" : "pos"}>{fmtMoney(type === "EXCHANGE" ? cashEffect - f : cashEffect, cur)}</strong>
              {type === "EXCHANGE" && parseNum(toAmount) !== undefined && (
                <>
                  , <strong className="pos">+{fmtMoney(parseNum(toAmount)!, otherCur)}</strong>
                  {size ? <span className="faint"> (rate {fmtNum(size / parseNum(toAmount)!, 4)} {cur} per {otherCur})</span> : null}
                </>
              )}
              {(type === "BUY" || type === "EXCHANGE") && f > 0 && <span className="faint"> (incl. fee {fmtNum(f)})</span>}
            </>
          ) : (
            <span className="faint">
              {type === "SPLIT"
                ? "A split changes the number of units only."
                : type === "WRITE_OFF"
                  ? "No cash moves: the units close at 0 and their remaining cost is a realised loss. Money recovered later goes in as its own transaction."
                  : "Enter the amount."}
            </span>
          )}
        </p>
        {error && (
          <p className="error" role="alert" data-testid="tx-error">
            {error}
          </p>
        )}

        <footer className="modal-footer">
          {editing &&
            (confirmDelete ? (
              <span className="confirm">
                Delete this transaction?{" "}
                <button type="button" className="danger" onClick={() => void remove()} disabled={busy} data-testid="tx-delete-confirm">
                  Delete
                </button>{" "}
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)} disabled={busy} data-testid="tx-delete">
                Delete
              </button>
            ))}
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy} data-testid="tx-save">
            {busy && <span className="spinner" aria-hidden />}
            {editing ? "Save" : "Add"}
          </button>
        </footer>
      </form>
    </div>
  );
}
