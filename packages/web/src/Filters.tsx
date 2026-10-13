import type { CSSProperties, ReactNode } from "react";
import { useNarrow } from "./useNarrow.ts";

export interface Option {
  value: string;
  label: string;
}

/**
 * A labelled dropdown with an "All" entry (value ""). Its width is fixed (`width`), so it doesn't jump when the options
 * arrive. On phones the dropdowns share a row: the label is hidden and the empty entry shows it instead, greyed.
 */
export function FilterSelect({ label, value, options, onChange, testId, width = "11rem" }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; testId: string; width?: string }) {
  const narrow = useNarrow();
  return (
    <label className={value ? "filter" : "filter unset"} style={{ "--w": width } as CSSProperties}>
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

export function FilterBar({ children, active, onReset, summary }: { children: ReactNode; active: boolean; onReset: () => void; summary: string }) {
  return (
    <div className="filters" data-testid="filters">
      {children}
      <button type="button" onClick={onReset} disabled={!active} data-testid="filters-reset">
        Reset
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
