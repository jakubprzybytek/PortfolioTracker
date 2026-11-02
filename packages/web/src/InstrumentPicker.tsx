import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchesAny } from "./Filters.tsx";
import { typeLabel } from "./format.ts";
import type { Instrument } from "./types.ts";

/**
 * The instrument field of the transaction form on a phone: a button showing the choice, opening a sheet from the
 * bottom with a search and the instruments as two-line rows (code, type and currency; the name under them). It lists
 * what the form passes: the account's own, with "Other instrument…" to list every one (as the computer's dropdown).
 * A phone's native dropdown can't be styled and wraps the long names.
 */
export function InstrumentPicker({
  list,
  value,
  onChange,
  onShowAll,
  accountLabel,
  loading,
  allowNew,
  allowNone,
  newValue,
}: {
  /** The instruments to list, sorted (active first, then by code). */
  list: Instrument[];
  value: string;
  onChange: (isin: string) => void;
  /** Set while the list holds only the account's instruments: "Other instrument…" calls it to list every one. */
  onShowAll: (() => void) | undefined;
  accountLabel: string;
  loading: boolean;
  /** Offer "New instrument…" (its value is `newValue`). */
  allowNew: boolean;
  /** Offer "No instrument" (it's optional). */
  allowNone: boolean;
  newValue: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const chosen = list.find((i) => i.isin === value);
  const filtered = !!onShowAll;

  const groups = useMemo(() => {
    const hits = list.filter((i) => matchesAny(q, i.code, i.name, i.isin));
    return [
      { label: filtered ? `In ${accountLabel}` : "Tracked", items: hits.filter((i) => i.active) },
      { label: filtered ? `In ${accountLabel}, no longer held` : "No longer held", items: hits.filter((i) => !i.active) },
    ].filter((g) => g.items.length);
  }, [list, q, filtered, accountLabel]);

  const close = () => {
    setOpen(false);
    setQ("");
    trigger.current?.focus();
  };
  const pick = (isin: string) => {
    onChange(isin);
    close();
  };

  // Focus in the sheet (not the search, which would bring up the keyboard over the list), so Escape reaches it.
  useEffect(() => {
    if (open) sheet.current?.focus();
  }, [open]);

  return (
    <>
      <button ref={trigger} type="button" className="picker-trigger" onClick={() => setOpen(true)} disabled={loading} aria-haspopup="dialog" data-testid="tx-instrument-picker">
        {chosen ? (
          <span className="picker-value">
            <strong>{chosen.code}</strong> <span className="muted">{chosen.name}</span>
          </span>
        ) : (
          <span className="picker-value muted">{loading ? "Loading…" : value === newValue ? "➕ New instrument" : "Choose…"}</span>
        )}
        <span className="picker-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        // In <body>: inside the form's <label> a tap on the sheet would also "click" the field's button.
        createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: a tap outside the sheet closes it; Escape does the same
          <div
            className="sheet-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && close()}
            onKeyDown={(e) => {
              // Escape closes the sheet only, not the form under it.
              if (e.key === "Escape") {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                close();
              }
            }}
          >
            <div ref={sheet} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label="Choose an instrument" data-testid="instrument-sheet">
              <header className="sheet-header">
                <h3>Instrument</h3>
                <button type="button" className="chart-panel-close" onClick={close} aria-label="Close">
                  ✕
                </button>
              </header>
              <input
                type="search"
                className="sheet-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search code, name or ISIN"
                aria-label="Search instruments"
                data-testid="instrument-search"
              />
              <div className="sheet-list" role="listbox" aria-label="Instruments">
                {allowNone && !q && (
                  <button type="button" role="option" aria-selected={!value} className={`sheet-option${!value ? " selected" : ""}`} onClick={() => pick("")}>
                    <span className="opt-line">
                      <span className="muted">No instrument</span>
                    </span>
                  </button>
                )}
                {groups.map((g) => (
                  <fieldset key={g.label} className="sheet-groupset">
                    <legend className="sheet-group">{g.label}</legend>
                    {g.items.map((i) => (
                      <button
                        key={i.isin}
                        type="button"
                        role="option"
                        aria-selected={i.isin === value}
                        className={`sheet-option${i.isin === value ? " selected" : ""}${i.active ? "" : " inactive"}`}
                        onClick={() => pick(i.isin)}
                        data-testid="instrument-option"
                        data-isin={i.isin}
                      >
                        <span className="opt-line">
                          <strong>{i.code}</strong>
                          <span className="opt-meta">
                            {typeLabel(i.type)} · {i.currency}
                          </span>
                        </span>
                        <span className="opt-name">{i.name}</span>
                      </button>
                    ))}
                  </fieldset>
                ))}
                {!groups.length && (
                  <p className="sheet-empty muted" data-testid="instrument-empty">
                    {q ? `No instrument matches “${q}”${filtered ? ` in ${accountLabel}` : ""}.` : `None in ${accountLabel} yet.`}
                  </p>
                )}
                {onShowAll && (
                  // The sheet stays open, now listing every instrument (the search kept).
                  <button type="button" role="option" aria-selected={false} className="sheet-option sheet-more" onClick={onShowAll} data-testid="instrument-other">
                    <span className="opt-line">Other instrument…</span>
                  </button>
                )}
                {allowNew && (
                  <button type="button" role="option" aria-selected={value === newValue} className="sheet-option sheet-new" onClick={() => pick(newValue)} data-testid="instrument-new">
                    <span className="opt-line">➕ New instrument…</span>
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
