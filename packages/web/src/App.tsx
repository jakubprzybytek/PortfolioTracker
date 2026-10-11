import { useEffect } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { APP_VERSION } from "./api.ts";
import { login, logout } from "./auth.ts";
import { DashboardView } from "./DashboardView.tsx";
import { HoldingsView } from "./HoldingsView.tsx";
import { useRoute, VIEWS } from "./route.ts";
import { TransactionsView } from "./TransactionsView.tsx";

/** Shows the app only to a logged-in user; otherwise goes straight to the Cognito login page. */
export function App() {
  const auth = useAuth();
  const needsLogin = !auth.isAuthenticated && !auth.isLoading && !auth.activeNavigator && !auth.error && !hasAuthParams();

  useEffect(() => {
    if (needsLogin) void login();
  }, [needsLogin]);

  if (auth.error) {
    return (
      <div className="gate" data-testid="auth-error">
        <h1>Portfolio Tracker</h1>
        <p className="error">Sign-in failed: {auth.error.message}</p>
        <button type="button" onClick={() => void login()}>
          Sign in again
        </button>
      </div>
    );
  }
  if (!auth.isAuthenticated) {
    return (
      <div className="gate muted" data-testid="auth-pending">
        Signing in…
      </div>
    );
  }
  return <Shell email={auth.user?.profile.email ?? ""} />;
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
