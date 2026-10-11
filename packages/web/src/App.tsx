import { useCallback, useEffect, useState } from "react";
import { Hub } from "aws-amplify/utils";
import { APP_VERSION } from "./api.ts";
import { currentSession, logout, type Session } from "./auth.ts";
import { DashboardView } from "./DashboardView.tsx";
import { HoldingsView } from "./HoldingsView.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { useRoute, VIEWS } from "./route.ts";
import { TransactionsView } from "./TransactionsView.tsx";

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

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Views">
        <div className="sidebar-inner">
          <h1>Portfolio Tracker</h1>
          <ul>
            {VIEWS.map((v) => (
              <li key={v.view}>
                <a href={v.path} aria-current={route.view === v.view ? "page" : undefined} data-testid={`nav-${v.view}`}>
                  {v.label}
                </a>
              </li>
            ))}
          </ul>
          <footer className="muted">
            <div className="user" data-testid="user-email" title={email}>
              {email}
            </div>
            <button type="button" className="link" onClick={() => void logout()} data-testid="logout">
              Log out
            </button>
            <div data-testid="version">Portfolio Tracker {APP_VERSION}</div>
          </footer>
        </div>
      </nav>
      <main>
        {route.view === "dashboard" && <DashboardView />}
        {route.view === "holdings" && <HoldingsView key="holdings" params={route.params} setParams={setParams} />}
        {route.view === "transactions" && <TransactionsView key="transactions" params={route.params} setParams={setParams} />}
      </main>
    </div>
  );
}
