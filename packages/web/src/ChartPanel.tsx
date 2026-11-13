import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons.tsx";
import { useMedia } from "./useNarrow.ts";

const MIN_PX = 160;
const MAX_FRACTION = 0.75;
/** Phone-sized screen (as the stylesheet's mobile layout): the panel starts at half the screen, its height remembered apart. */
const narrow = () => window.matchMedia("(max-width: 720px)").matches;
/** A phone, upright or turned (a low touch screen): where a `phonePage` panel takes the whole screen. */
const PHONE_PAGE = "(max-width: 720px), (max-height: 500px) and (pointer: coarse)";
/** Each panel's height is remembered apart (`id`), and apart on a phone. */
const storageKey = (id: string) => `portfolio-tracker.${id}.height${narrow() ? ".phone" : ""}`;

const initialFraction = (id: string, fallback: number): number => {
  const saved = Number(window.localStorage.getItem(storageKey(id)));
  return saved > 0 && saved <= MAX_FRACTION ? saved : narrow() ? 1 / 2 : fallback;
};

/**
 * A panel docked to the bottom of the window, below the menu. A drag handle on its top edge resizes it
 * (fraction of the window height, remembered in localStorage per `id`; `fraction` the first time); Escape or ✕ closes
 * it. Reports its height so the page can leave room for it. `actions` (range, toggles, the cog) share the title's row,
 * before ✕; on a phone they go to a row of their own below the title. With `phonePage`, on a phone it's a page of its
 * own instead (the whole screen, ‹ to go back; so is the phone's Back).
 */
export function ChartPanel({
  title,
  actions,
  onClose,
  onHeight,
  children,
  id = "chartPanel",
  fraction: firstFraction = 1 / 3,
  phonePage = false,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  onHeight: (px: number) => void;
  children: ReactNode;
  id?: string;
  fraction?: number;
  phonePage?: boolean;
}) {
  const page = useMedia(PHONE_PAGE) && phonePage;
  if (page) return <PhonePage title={title} actions={actions} onClose={onClose} onHeight={onHeight}>{children}</PhonePage>;
  return <DockedPanel title={title} actions={actions} onClose={onClose} onHeight={onHeight} id={id} firstFraction={firstFraction}>{children}</DockedPanel>;
}

/**
 * The panel as a page of its own on a phone. It adds a history entry, so the phone's Back closes it (and the list is
 * where it was); ‹ and Escape go back the same way.
 */
function PhonePage({ title, actions, onClose, onHeight, children }: { title: ReactNode; actions?: ReactNode; onClose: () => void; onHeight: (px: number) => void; children: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pushed = useRef(false);
  useEffect(() => {
    onHeight(0); // over the whole screen: the list needs no room for it
    window.history.pushState({ panelPage: true }, "", window.location.hash);
    pushed.current = true;
    const onPop = () => {
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onHeight]);
  const close = useCallback(() => (pushed.current ? window.history.back() : closeRef.current()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[aria-modal="true"]') && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <section className="panel-page" data-testid="chart-panel" aria-label="Details">
      <header className="panel-page-header">
        <button type="button" className="icon-button" onClick={close} aria-label="Back" title="Back" data-testid="chart-panel-close">
          <Icon name="back" size={18} />
        </button>
        <div className="panel-page-title" data-testid="chart-panel-title">
          {title}
        </div>
      </header>
      {actions && <div className="chart-panel-actions">{actions}</div>}
      <div className="panel-page-body">{children}</div>
    </section>
  );
}

function DockedPanel({ title, actions, onClose, onHeight, children, id, firstFraction }: { title: ReactNode; actions?: ReactNode; onClose: () => void; onHeight: (px: number) => void; children: ReactNode; id: string; firstFraction: number }) {
  const [fraction, setFraction] = useState(() => initialFraction(id, firstFraction));
  const [viewport, setViewport] = useState(window.innerHeight);
  const dragging = useRef(false);
  const height = Math.max(MIN_PX, Math.round(fraction * viewport));

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    // Escape closes the topmost layer only: a dialog open over the panel (the issuer's) closes first.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[aria-modal="true"]') && onClose();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => onHeight(height), [height, onHeight]);
  useEffect(() => () => onHeight(0), [onHeight]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const f = Math.min(MAX_FRACTION, Math.max(MIN_PX / window.innerHeight, (window.innerHeight - e.clientY) / window.innerHeight));
    setFraction(f);
  }, []);
  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setFraction((f) => {
      window.localStorage.setItem(storageKey(id), String(f));
      return f;
    });
  }, [id]);

  return (
    // --panel-h: what's in it can size itself to it (a bond's chart fills the panel).
    <section className="chart-panel" style={{ height, ["--panel-h" as string]: `${height}px` }} data-testid="chart-panel" aria-label="Chart">
      {/* biome-ignore lint/a11y/useSemanticElements: a draggable, focusable resize handle (an <hr> can't be one) */}
      <div
        className="chart-panel-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the chart"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="chart-panel-handle"
      />
      <header className="chart-panel-header">
        <div className="chart-panel-title" data-testid="chart-panel-title">
          {title}
        </div>
        {actions && <div className="chart-panel-actions">{actions}</div>}
        <button type="button" className="chart-panel-close" onClick={onClose} aria-label="Close the chart" title="Close (Esc)" data-testid="chart-panel-close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="chart-panel-body">{children}</div>
    </section>
  );
}
