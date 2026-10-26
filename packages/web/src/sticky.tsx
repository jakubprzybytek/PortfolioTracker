import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNarrow } from "./useNarrow.ts";

/**
 * A view whose toolbar (the filters) sticks to the top while the list scrolls, under the phone's top bar, with the
 * table's header under it. Returns the toolbar's ref and the view's style: `--sticky-top` (the phone's top bar) and
 * `--bar-h` (the toolbar), both measured and kept up to date.
 */
export function useStickyToolbar(): [(el: HTMLDivElement | null) => void, CSSProperties] {
  const narrow = useNarrow();
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [sticky, setSticky] = useState({ top: 0, bar: 0 });
  useEffect(() => {
    const topbar = document.querySelector<HTMLElement>(".sidebar");
    const measure = () => setSticky({ top: narrow && topbar ? topbar.offsetHeight : 0, bar: bar?.offsetHeight ?? 0 });
    measure();
    const ro = new ResizeObserver(measure);
    if (bar) ro.observe(bar);
    if (topbar) ro.observe(topbar);
    return () => ro.disconnect();
  }, [narrow, bar]);
  return [setBar, { "--sticky-top": `${sticky.top}px`, "--bar-h": `${sticky.bar}px` } as CSSProperties];
}

/**
 * A table whose header sticks under the view's toolbar (`useStickyToolbar`) although the table scrolls sideways (a
 * phone, a narrow window): a box that scrolls sideways would hold a sticky header in it, so a copy of the header
 * (`head`: its one row) floats above the box instead, with the real header's column widths and following its
 * sideways scroll. The real header stays under the copy and sizes the columns. Header cells must not span columns.
 */
export function StickyTable({ head, className, testId, children }: { head: ReactNode; className?: string; testId?: string; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const table = useRef<HTMLTableElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number; cols: number[] }>({ width: 0, height: 0, cols: [] });

  const measure = useCallback(() => {
    const t = table.current;
    const row = t?.tHead?.rows[0];
    if (!t || !row) return;
    const cols = Array.from(row.cells, (c) => c.getBoundingClientRect().width);
    const width = t.getBoundingClientRect().width;
    const height = t.tHead!.getBoundingClientRect().height;
    setSize((s) => (s.width === width && s.height === height && s.cols.length === cols.length && s.cols.every((w, i) => w === cols[i]) ? s : { width, height, cols }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (table.current) ro.observe(table.current);
    if (table.current?.tHead) ro.observe(table.current.tHead);
    return () => ro.disconnect();
  }, [measure]);
  // Rows arriving change the widths without resizing the table (its width stays the box's).
  useLayoutEffect(measure);

  const follow = () => {
    if (shell.current && wrap.current) shell.current.scrollLeft = wrap.current.scrollLeft;
  };
  useLayoutEffect(follow);

  return (
    <div className="sticky-table">
      <div className="table-wrap sticky-head" ref={shell} aria-hidden data-testid={testId ? `${testId}-head` : undefined}>
        <table className={className} style={{ width: size.width || undefined, tableLayout: size.width ? "fixed" : undefined }}>
          {size.cols.length > 0 && (
            <colgroup>
              {size.cols.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          <thead>{head}</thead>
        </table>
      </div>
      <div className="table-wrap sticky-body" ref={wrap} onScroll={follow} style={{ marginTop: -size.height }}>
        <table className={className} data-testid={testId} ref={table}>
          <thead>{head}</thead>
          {children}
        </table>
      </div>
    </div>
  );
}
