import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icons.tsx";
import { useNarrow } from "./useNarrow.ts";

export interface Option {
  value: string;
  label: string;
}

/**
 * A labelled dropdown with an "All" entry (value ""). Its width is fixed (`width`), so it doesn't jump when the options
 * arrive. On phones the dropdowns share a row (a `wide` one takes a row of its own, below the others): the label is hidden and the empty
 * entry shows it instead, greyed.
 */
export function FilterSelect({ label, value, options, onChange, testId, width = "11rem", wide = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; testId: string; width?: string; wide?: boolean }) {
  const narrow = useNarrow();
  return (
    <label className={["filter", value ? "" : "unset", wide ? "wide" : ""].filter(Boolean).join(" ")} style={{ "--w": width } as CSSProperties}>
      <span className="muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">{narrow ? label : "All"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Free text: instruments whose name or code contains it (case and Polish accents ignored). */
export function FilterText({ label, value, onChange, testId, placeholder = "Name or code", width = "13rem" }: { label: string; value: string; onChange: (value: string) => void; testId: string; placeholder?: string; width?: string }) {
  const narrow = useNarrow();
  return (
    <label className={["filter", "text", value ? "" : "unset"].filter(Boolean).join(" ")} style={{ "--w": width } as CSSProperties}>
      <span className="muted">{label}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={narrow ? label : placeholder} data-testid={testId} />
    </label>
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
/** Whether an instrument matches the free-text filter (empty: everything). */
export const matchesText = (text: string, i: { code: string; name: string }) => matchesAny(text, i.code, i.name);
/** Whether any of the fields contains the free text (case and Polish accents ignored; empty text: everything). */
export const matchesAny = (text: string, ...fields: (string | undefined)[]) => !text.trim() || fold(fields.filter(Boolean).join(" ")).includes(fold(text.trim()));

/**
 * The filters, a Reset button and the "n of m" count. On a phone Reset is a "Clear" link at the end of the count's line,
 * shown only while a filter is set, so the filters get the whole width.
 *
 * `search` (a FilterText) goes last on a computer. With `compact`, a phone shows only the search and a "Filters" button
 * (with how many dropdowns are set, `activeCount`) that folds the dropdowns out: the bar stays two short lines, so it
 * can stay on screen while the list scrolls.
 *
 * `after` (e.g. a FilterToggle) goes after the search; on a compact phone it's in the folded panel, after the dropdowns.
 */
export function FilterBar({ children, active, onReset, summary, search, after, compact = false, activeCount = 0 }: { children: ReactNode; active: boolean; onReset: () => void; summary: string; search?: ReactNode; after?: ReactNode; compact?: boolean; activeCount?: number }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (narrow && compact)
    return (
      <div className="filters compact" data-testid="filters">
        <div className="filters-top">
          {search}
          <button type="button" className={`filters-toggle${activeCount ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="filters-toggle">
            <Icon name="filter" size={14} /> Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
        </div>
        {open && (
          <div className="filters-panel" data-testid="filters-panel">
            {children}
            {after}
          </div>
        )}
        <div className="filters-foot">
          <span className="muted filters-summary" data-testid="filters-summary">
            {summary}
          </span>
          {active && (
            <button type="button" className="clear" onClick={onReset} title="Clear filters" data-testid="filters-reset">
              <Icon name="clear-filters" size={14} /> Clear
            </button>
          )}
        </div>
      </div>
    );
  if (narrow)
    return (
      <div className="filters" data-testid="filters">
        {children}
        {search}
        {after}
        <div className="filters-foot">
          <span className="muted filters-summary" data-testid="filters-summary">
            {summary}
          </span>
          {active && (
            <button type="button" className="clear" onClick={onReset} title="Clear filters" data-testid="filters-reset">
              <Icon name="clear-filters" size={14} /> Clear
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="filters" data-testid="filters">
      {children}
      {search}
      {after}
      <button type="button" className="reset" onClick={onReset} disabled={!active} title="Clear filters" aria-label="Clear filters" data-testid="filters-reset">
        <Icon name="clear-filters" size={16} />
      </button>
      <span className="muted filters-summary" data-testid="filters-summary">
        {summary}
      </span>
    </div>
  );
}

/** Distinct values, sorted by label. */
export function uniqueOptions<T>(items: T[], pick: (item: T) => Option | null): Option[] {
  const map = new Map<string, Option>();
  for (const item of items) {
    const o = pick(item);
    if (o && !map.has(o.value)) map.set(o.value, o);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** A toggle button among the filters (e.g. "Show closed"), as tall as the dropdowns; filled while on. */
export function FilterToggle({ label, checked, onChange, testId, title }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId: string; title?: string }) {
  return (
    <button type="button" className={`toggle${checked ? " active" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)} title={title} data-testid={testId}>
      {label}
    </button>
  );
}
