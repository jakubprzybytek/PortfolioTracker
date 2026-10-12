import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const KEY = "portfolio-tracker.chartPanel.height";
const MIN_PX = 160;
const MAX_FRACTION = 0.75;

const initialFraction = (): number => {
  const saved = Number(window.localStorage.getItem(KEY));
  return saved > 0 && saved <= MAX_FRACTION ? saved : 1 / 3;
};

/**
 * A panel docked to the bottom of the window, below the menu. A drag handle on its top edge resizes it
 * (fraction of the window height, remembered in localStorage); Escape or ✕ closes it. Reports its height
 * so the page can leave room for it.
 */
export function ChartPanel({ title, onClose, onHeight, children }: { title: ReactNode; onClose: () => void; onHeight: (px: number) => void; children: ReactNode }) {
  const [fraction, setFraction] = useState(initialFraction);
  const [viewport, setViewport] = useState(window.innerHeight);
  const dragging = useRef(false);
  const height = Math.max(MIN_PX, Math.round(fraction * viewport));

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
      window.localStorage.setItem(KEY, String(f));
      return f;
    });
  }, []);

  return (
    <section className="chart-panel" style={{ height }} data-testid="chart-panel" aria-label="Chart">
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
        <button type="button" className="chart-panel-close" onClick={onClose} aria-label="Close the chart" data-testid="chart-panel-close">
          ✕
        </button>
      </header>
      <div className="chart-panel-body">{children}</div>
    </section>
  );
}
