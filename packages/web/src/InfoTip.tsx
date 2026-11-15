// An "i" in a circle that explains what it sits next to (a column's heading). It opens on hover, on focus and on a
// tap (phones have no hover), above everything: a table's sticky header would clip it. `more`: a Wiki article's slug,
// linked at the end ("More →"); the pointer can move onto the explanation to reach it.
import { useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HeaderCopy, InSortTh } from "./SortTh.tsx";

export function InfoTip({ label, children, testId, more }: { label: string; children: ReactNode; testId?: string; more?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  // In a sticky table's floating header copy: the mouse's, not the keyboard's (as SortTh's buttons).
  const copy = useContext(HeaderCopy);
  const inSortTh = useContext(InSortTh);
  const show = () => {
    clearTimeout(leaving.current);
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 16);
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)) });
    setOpen(true);
  };
  const hide = useCallback(() => {
    clearTimeout(leaving.current);
    setOpen(false);
    setPinned(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    const onDown = (e: Event) => !button.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide]);
  useEffect(() => () => clearTimeout(leaving.current), []);
  // Off the "i" or the explanation: closes a moment later, so the pointer can cross the gap between them.
  const leave = () => {
    if (pinned) return;
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setOpen(false), 200);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-tip"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={(e) => !pop.current?.contains(e.relatedTarget as Node | null) && hide()}
        onClick={(e) => {
          // Not the heading's sort.
          e.stopPropagation();
          if (pinned) hide();
          else {
            show();
            setPinned(true);
          }
        }}
        tabIndex={copy ? -1 : undefined}
        data-testid={copy || !inSortTh ? testId : undefined}
      >
        i
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            className="info-tip-pop"
            style={{ top: at.top, left: at.left }}
            onMouseEnter={() => clearTimeout(leaving.current)}
            onMouseLeave={leave}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && hide()}
            data-testid={testId ? `${testId}-text` : undefined}
          >
            {children}
            {more && (
              <>
                {" "}
                <a className="info-tip-more" href={`#/wiki?page=${more}`} onClick={hide} onBlur={(e) => e.relatedTarget !== button.current && hide()} data-testid={testId ? `${testId}-more` : undefined}>
                  More →
                </a>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
