import { createContext, useContext } from "react";
import { nextSort, type Sort } from "./sort.ts";

/**
 * True inside the floating copy of a StickyTable's header (sticky.tsx): the copy is what the mouse clicks, the real
 * header under it is what keyboards and screen readers use, so the copy's buttons stay out of the tab order.
 */
export const HeaderCopy = createContext(false);

/**
 * A header cell that sorts its table (sort.ts): a click cycles ascending → descending → the view's order; the
 * sorted column shows ▲ or ▼ and `aria-sort`.
 */
export function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  title,
  firstDesc = false,
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
  className?: string;
  title?: string;
  /** Start descending (the highest first), e.g. for yields. */
  firstDesc?: boolean;
}) {
  const copy = useContext(HeaderCopy);
  const active = sort?.key === sortKey;
  return (
    <th className={`sortable${active ? " sorted" : ""}${className ? ` ${className}` : ""}`} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="sort-button" tabIndex={copy ? -1 : undefined} onClick={() => onSort(nextSort(sort, sortKey, firstDesc))} title={title ?? `Sort by ${label.toLowerCase()}`} data-testid={copy ? `sort-${sortKey}` : undefined}>
        {label}
        <span className="sort-mark" aria-hidden>
          {active ? (sort.desc ? "▼" : "▲") : ""}
        </span>
      </button>
    </th>
  );
}
