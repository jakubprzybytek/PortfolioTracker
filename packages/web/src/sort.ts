// Sorting a table by a column: the column is kept in the URL (`sort=price`, `sort=-price` for descending), a header
// click cycles ascending → descending → the view's own order. Empty values always come last.

export interface Sort {
  key: string;
  desc: boolean;
}

/** A value to sort by: numbers numerically, text in Polish order (accents, digits as numbers); null/undefined last. */
export type SortValue = number | string | null | undefined;

/** The sort in the URL, if it names one of `keys`. */
export function parseSort(param: string | undefined, keys: readonly string[]): Sort | null {
  if (!param) return null;
  const desc = param.startsWith("-");
  const key = desc ? param.slice(1) : param;
  return keys.includes(key) ? { key, desc } : null;
}

/** The URL value of a sort (undefined: the view's own order). */
export const sortParam = (sort: Sort | null): string | undefined => (sort ? `${sort.desc ? "-" : ""}${sort.key}` : undefined);

/**
 * The sort after a click on `key`'s header: a new column starts ascending (descending with `firstDesc`, e.g. for
 * yields, where the highest is wanted first), a second click reverses it, a third goes back to the view's order.
 */
export function nextSort(current: Sort | null, key: string, firstDesc = false): Sort | null {
  if (!current || current.key !== key) return { key, desc: firstDesc };
  return current.desc === firstDesc ? { key, desc: !firstDesc } : null;
}

const collator = new Intl.Collator("pl", { numeric: true, sensitivity: "base" });

const isEmpty = (v: SortValue) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

/** Ascending order of two values, empty ones last. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b));
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * `rows` in `sort`'s order (a copy; ties keep their order, so the view's own order breaks them), empty values last
 * in both directions. Without a sort, the rows as they are.
 */
export function sortRows<T>(rows: readonly T[], sort: Sort | null, value: (row: T, key: string) => SortValue): T[] {
  if (!sort) return [...rows];
  return rows
    .map((row, i) => ({ row, i, v: value(row, sort.key) }))
    .sort((a, b) => {
      const empty = Number(isEmpty(a.v)) - Number(isEmpty(b.v));
      if (empty) return empty;
      const c = compareValues(a.v, b.v);
      return (sort.desc ? -c : c) || a.i - b.i;
    })
    .map((x) => x.row);
}
