import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { Hub } from "aws-amplify/utils";
import { APP_VERSION, api, apiSend } from "./api.ts";
import { currentSession, logout, type Session } from "./auth.ts";
import { Icon } from "./Icons.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { useRoute, VIEWS } from "./route.ts";
import { TransactionForm } from "./TransactionForm.tsx";
import { TxFormContext } from "./txForm.ts";
import type { Status, Transaction } from "./types.ts";
import { clearApiCache, reloadAll, useApiBusy } from "./useApi.ts";

// Each view loads with its first visit (its code and the libraries only it uses), not before the login form.
const DashboardView = lazy(() => import("./DashboardView.tsx").then((m) => ({ default: m.DashboardView })));
const HoldingsView = lazy(() => import("./HoldingsView.tsx").then((m) => ({ default: m.HoldingsView })));
const HoldSellView = lazy(() => import("./HoldSellView.tsx").then((m) => ({ default: m.HoldSellView })));
const IndicatorsView = lazy(() => import("./IndicatorsView.tsx").then((m) => ({ default: m.IndicatorsView })));
const InstrumentView = lazy(() => import("./InstrumentView.tsx").then((m) => ({ default: m.InstrumentView })));
const NotesView = lazy(() => import("./NotesView.tsx").then((m) => ({ default: m.NotesView })));
const PerformanceView = lazy(() => import("./PerformanceView.tsx").then((m) => ({ default: m.PerformanceView })));
const PricesView = lazy(() => import("./PricesView.tsx").then((m) => ({ default: m.PricesView })));
const SalesView = lazy(() => import("./SalesView.tsx").then((m) => ({ default: m.SalesView })));
const StatusView = lazy(() => import("./StatusView.tsx").then((m) => ({ default: m.StatusView })));
const CashFlowsView = lazy(() => import("./CashFlowsView.tsx").then((m) => ({ default: m.CashFlowsView })));
const TransactionsView = lazy(() => import("./TransactionsView.tsx").then((m) => ({ default: m.TransactionsView })));

/** Shows the app to a logged-in user and the login form otherwise. The view (#/…) stays in the URL meanwhile. */
export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const refresh = useCallback(() => void currentSession().then(setSession), []);

  useEffect(() => {
    refresh();
    // Logged out (button, expired session, failed token renewal) → login form.
    return Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedOut" || payload.event === "tokenRefresh_failure") {
        clearApiCache();
        setSession(null);
      }
      if (payload.event === "signedIn") refresh();
    });
  }, [refresh]);

  if (session === undefined) {
    return (
      <div className="gate muted" data-testid="auth-pending">
        Loading…
      </div>
    );
  }
  if (session === null) return <LoginForm onSignedIn={refresh} />;
  return <Shell email={session.email} />;
}

function Shell({ email }: { email: string }) {
  const [route, setParams] = useRoute();
  // The transaction form, open from any view ("Add transaction", or a row of Transactions to edit it).
  const [form, setForm] = useState<{ editing?: Transaction } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // After a save the valuation reruns in the background (about a minute): "Recalculating…" stays up until a valuation
  // run finishes after the save (server clock, from /status), then every view reloads. "Refresh prices" first waits for
  // the Live job (phase "prices"), then for the valuation it queues.
  const [recalc, setRecalc] = useState<{ since: string; startedAt: number; phase: "prices" | "valuation"; done?: string } | null>(null);
  const saved = useCallback((message: string) => {
    setToast(message);
    reloadAll();
    void api<Status>("/status")
      .then((s) => setRecalc({ since: s.now, startedAt: Date.now(), phase: "valuation" }))
      .catch(() => setRecalc(null));
  }, []);
  // "Update prices" is busy from the click, not only once the API has answered (a cold Lambda takes a second or two).
  const [starting, setStarting] = useState(false);
  const refreshPrices = useCallback(async () => {
    setStarting(true);
    try {
      const { now } = await apiSend<{ now: string }>("POST", "/prices/refresh");
      setRecalc({ since: now, startedAt: Date.now(), phase: "prices" });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setStarting(false);
    }
  }, []);
  useEffect(() => {
    if (!recalc) return;
    const t = setInterval(() => {
      void api<Status>("/status")
        .then((s) => {
          if (recalc.phase === "prices") {
            const live = s.jobs["live"];
            if (!live?.finishedAt || live.finishedAt <= recalc.since) return;
            if (live.status === "failed" || !live.itemsWritten) {
              setRecalc(null);
              setToast(live.status === "failed" ? `Prices couldn't be refreshed: ${live.note ?? "see the Dashboard"}` : `No new prices (${live.note ?? "nothing traded today yet"}).`);
            } else setRecalc({ ...recalc, phase: "valuation", done: `Prices refreshed: ${live.note}.` });
            return;
          }
          const run = s.jobs["valuation"];
          if (run?.finishedAt && run.finishedAt > recalc.since) {
            setRecalc(null);
            reloadAll();
            setToast(run.status === "ok" ? (recalc.done ?? "Valuation updated.") : `The valuation failed: ${run.note ?? "see the Dashboard"}`);
          } else if (Date.now() - recalc.startedAt > 5 * 60_000) {
            setRecalc(null);
            setToast("The valuation is taking longer than usual; refresh the page later.");
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [recalc]);
  const busy = recalc?.phase ?? (starting ? "prices" : null);
  const txForm = useMemo(
    () => ({ open: (editing?: Transaction) => setForm({ editing }), saved, refreshPrices: () => void refreshPrices(), busy }),
    [saved, refreshPrices, busy],
  );
  const fetching = useApiBusy();
  // Phone: the menu opens over the page from the ☰ button; any navigation, a tap outside or Escape closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  const hash = window.location.hash;
  useEffect(() => setMenuOpen(false), [hash, route.view]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <TxFormContext.Provider value={txForm}>
    <div className="layout">
      <nav className="sidebar" aria-label="Views">
        <div className="sidebar-inner">
          <div className="topbar">
            <h1 className="brand">
              <a href="#/">
                <img src="/favicon.svg" alt="" width={26} height={26} />
                Portfolio <span className="light">Tracker</span>
              </a>
            </h1>
            <button type="button" className="primary add-tx" onClick={() => setForm({})} aria-label="Add transaction" data-testid="tx-add">
              <span aria-hidden>+</span>
              <span className="label"> Add transaction</span>
            </button>
            <button
              type="button"
              className="reload"
              onClick={reloadAll}
              title="Reload this view's data from the server (doesn't fetch new prices)"
              aria-label="Reload"
              aria-busy={fetching}
              data-testid="reload"
            >
              <Icon name="reload" size={16} className={fetching ? "spin" : undefined} />
              <span className="label">Reload</span>
            </button>
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="nav-menu"
              aria-label={menuOpen ? "Close the menu" : "Open the menu"}
              onClick={() => setMenuOpen((o) => !o)}
              data-testid="menu-toggle"
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
          <div id="nav-menu" className={`nav-menu${menuOpen ? " open" : ""}`} data-testid="nav-menu">
            <ul>
              {VIEWS.filter((v) => !v.hidden).map((v) => (
                <li key={v.view}>
                  <a href={v.path} aria-current={route.view === v.view ? "page" : undefined} data-testid={`nav-${v.view}`} onClick={() => setMenuOpen(false)}>
                    <Icon name={v.view} />
                    {v.label}
                  </a>
                </li>
              ))}
            </ul>
            <footer className="muted">
              <div className="user" data-testid="user-email" title={email}>
                {email}
              </div>
              <button type="button" className="link logout" onClick={() => void logout()} data-testid="logout">
                <Icon name="logout" size={16} />
                Log out
              </button>
              <div data-testid="version">
                Portfolio Tracker {APP_VERSION} ·{" "}
                <a href="#/status" data-testid="nav-status" onClick={() => setMenuOpen(false)}>
                  status
                </a>
              </div>
            </footer>
          </div>
        </div>
        {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)} aria-hidden data-testid="nav-backdrop" />}
      </nav>
      <main>
        <ErrorBoundary resetKey={route.view}>
        <Suspense fallback={<p className="muted view-loading" data-testid="view-loading">Loading…</p>}>
        {route.view === "dashboard" && <DashboardView />}
        {route.view === "performance" && <PerformanceView key="performance" params={route.params} setParams={setParams} />}
        {route.view === "holdings" && <HoldingsView key="holdings" params={route.params} setParams={setParams} />}
        {route.view === "prices" && <PricesView key="prices" params={route.params} setParams={setParams} />}
        {route.view === "holdsell" && <HoldSellView key="holdsell" params={route.params} setParams={setParams} />}
        {route.view === "sales" && <SalesView key="sales" params={route.params} setParams={setParams} />}
        {route.view === "cashflows" && <CashFlowsView key="cashflows" params={route.params} setParams={setParams} />}
        {route.view === "indicators" && <IndicatorsView key="indicators" params={route.params} setParams={setParams} />}
        {route.view === "transactions" && <TransactionsView key="transactions" params={route.params} setParams={setParams} />}
        {route.view === "notes" && <NotesView key="notes" params={route.params} setParams={setParams} />}
        {route.view === "instrument" && <InstrumentView key="instrument" params={route.params} />}
        {route.view === "status" && <StatusView />}
        </Suspense>
        </ErrorBoundary>
      </main>
      {(toast || recalc) && (
        <div className="toast" role="status">
          {toast && <p data-testid="tx-toast">{toast}</p>}
          {recalc && (
            <p className="recalc" data-testid="recalc">
              <span className="spinner" aria-hidden />
              {recalc.phase === "prices" ? "Fetching today's prices…" : "Recalculating the valuation…"}
            </p>
          )}
        </div>
      )}
      {form && (
        <TransactionForm
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setForm(null);
            saved(message);
          }}
        />
      )}
    </div>
    </TxFormContext.Provider>
  );
}
