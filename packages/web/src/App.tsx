import { useCallback, useEffect, useMemo, useState } from "react";
import { Hub } from "aws-amplify/utils";
import { APP_VERSION } from "./api.ts";
import { currentSession, logout, type Session } from "./auth.ts";
import { DashboardView } from "./DashboardView.tsx";
import { HoldingsView } from "./HoldingsView.tsx";
import { Icon } from "./Icons.tsx";
import { IndicatorsView } from "./IndicatorsView.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { PricesView } from "./PricesView.tsx";
import { useRoute, VIEWS } from "./route.ts";
import { TransactionForm } from "./TransactionForm.tsx";
import { TransactionsView } from "./TransactionsView.tsx";
import { TxFormContext } from "./txForm.ts";
import type { Transaction } from "./types.ts";

/** Shows the app to a logged-in user and the login form otherwise. The view (#/…) stays in the URL meanwhile. */
export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const refresh = useCallback(() => void currentSession().then(setSession), []);

  useEffect(() => {
    refresh();
    // Logged out (button, expired session, failed token renewal) → login form.
    return Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedOut" || payload.event === "tokenRefresh_failure") setSession(null);
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
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const txForm = useMemo(() => ({ open: (editing?: Transaction) => setForm({ editing }), version }), [version]);
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
              {VIEWS.map((v) => (
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
              <div data-testid="version">Portfolio Tracker {APP_VERSION}</div>
            </footer>
          </div>
        </div>
        {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)} aria-hidden data-testid="nav-backdrop" />}
      </nav>
      <main>
        {route.view === "dashboard" && <DashboardView />}
        {route.view === "holdings" && <HoldingsView key="holdings" params={route.params} setParams={setParams} />}
        {route.view === "prices" && <PricesView key="prices" params={route.params} setParams={setParams} />}
        {route.view === "indicators" && <IndicatorsView key="indicators" params={route.params} setParams={setParams} />}
        {route.view === "transactions" && <TransactionsView key="transactions" params={route.params} setParams={setParams} />}
      </main>
      {toast && (
        <p className="toast" role="status" data-testid="tx-toast">
          {toast}
        </p>
      )}
      {form && (
        <TransactionForm
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setForm(null);
            setToast(`${message} The valuation updates in about a minute.`);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
    </TxFormContext.Provider>
  );
}
