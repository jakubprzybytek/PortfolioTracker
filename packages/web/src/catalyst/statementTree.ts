// A statement's lines as a tree (Financials tab): each line's depth from its `parent` links (the subtotal it adds up
// into, as ESEF and KRS XML report them), which lines are subtotals, and which are empty (zero, with nothing non-zero
// under them: most of the KRS XML template). PDF transcripts carry no parents: their lines stay flat, and the standard
// totals among them are marked as subtotals.

export interface TreeLine {
  statement: string;
  order: number;
  value: number;
  item?: string;
  parent?: number;
}

export interface LineShape {
  depth: number;
  subtotal: boolean;
  empty: boolean;
}

/** Standard items that are totals of other lines: shown as subtotals when the statement has no parent links. */
const TOTAL_ITEMS = new Set(["totalAssets", "noncurrentAssets", "currentAssets", "equity", "totalLiabilities", "noncurrentLiabilities", "currentLiabilities", "totalEquityAndLiabilities", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "netProfit", "profitBeforeTax", "ebit"]);

/** Deeper than this is cut (a cycle or a broken link must not hang the page). */
const MAX_DEPTH = 8;

/** Each line's shape, keyed `<statement>#<order>`. Parents are looked up within the same statement. */
export function lineShapes(lines: TreeLine[]): Map<string, LineShape> {
  const key = (statement: string, order: number) => `${statement}#${order}`;
  const byKey = new Map(lines.map((l) => [key(l.statement, l.order), l]));
  const linked = new Set(lines.filter((l) => l.parent !== undefined && byKey.has(key(l.statement, l.parent))).map((l) => l.statement));
  const children = new Map<string, TreeLine[]>();
  for (const l of lines) {
    if (l.parent === undefined) continue;
    const p = key(l.statement, l.parent);
    if (byKey.has(p) && p !== key(l.statement, l.order)) children.set(p, [...(children.get(p) ?? []), l]);
  }
  const depthOf = (l: TreeLine): number => {
    let depth = 0;
    const seen = new Set<string>([key(l.statement, l.order)]);
    for (let p = l.parent; p !== undefined && depth < MAX_DEPTH; ) {
      const k = key(l.statement, p);
      const up = byKey.get(k);
      if (!up || seen.has(k)) break;
      seen.add(k);
      depth++;
      p = up.parent;
    }
    return depth;
  };
  const nonZero = new Map<string, boolean>();
  const anyNonZero = (l: TreeLine, guard = 0): boolean => {
    const k = key(l.statement, l.order);
    const known = nonZero.get(k);
    if (known !== undefined) return known;
    nonZero.set(k, l.value !== 0); // provisional, breaks cycles
    const v = l.value !== 0 || (guard < MAX_DEPTH && (children.get(k) ?? []).some((c) => anyNonZero(c, guard + 1)));
    nonZero.set(k, v);
    return v;
  };
  const shapes = new Map<string, LineShape>();
  for (const l of lines) {
    const k = key(l.statement, l.order);
    const subtotal = linked.has(l.statement) ? children.has(k) : !!l.item && TOTAL_ITEMS.has(l.item);
    shapes.set(k, { depth: linked.has(l.statement) ? depthOf(l) : 0, subtotal, empty: !anyNonZero(l) });
  }
  return shapes;
}
