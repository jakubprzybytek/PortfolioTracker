import { RANGES, type RangeKey } from "./format.ts";

/**
 * Time-span buttons above a chart. While the chart reloads (`busy`) they're disabled and the chosen one shows a
 * spinner. `options` default to 1M / 6M / 1Y / ALL.
 */
export function RangePicker<K extends string = RangeKey>({
  value,
  onChange,
  testId,
  busy = false,
  options = RANGES.map((r) => r.key) as unknown as readonly K[],
}: {
  value: K;
  onChange: (r: K) => void;
  testId: string;
  busy?: boolean;
  options?: readonly K[];
}) {
  return (
    <div className="range" data-testid={testId} aria-busy={busy}>
      {options.map((key) => (
        <button key={key} type="button" className={key === value ? "active" : ""} onClick={() => onChange(key)} aria-pressed={key === value} disabled={busy}>
          {key === value && busy && <span className="spinner" aria-hidden />}
          {key}
        </button>
      ))}
    </div>
  );
}
