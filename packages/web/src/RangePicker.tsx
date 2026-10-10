import { RANGES, type RangeKey } from "./format.ts";

export function RangePicker({ value, onChange, testId }: { value: RangeKey; onChange: (r: RangeKey) => void; testId: string }) {
  return (
    <div className="range" data-testid={testId}>
      {RANGES.map((r) => (
        <button key={r.key} type="button" className={r.key === value ? "active" : ""} onClick={() => onChange(r.key)} aria-pressed={r.key === value}>
          {r.key}
        </button>
      ))}
    </div>
  );
}
