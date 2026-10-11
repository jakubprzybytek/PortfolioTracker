import { APP_VERSION } from "./api.ts";
import { DashboardView } from "./DashboardView.tsx";
import { HoldingsView } from "./HoldingsView.tsx";
import { useRoute, VIEWS } from "./route.ts";
import { TransactionsView } from "./TransactionsView.tsx";

export function App() {
  const [route, setParams] = useRoute();

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Views">
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
        <footer className="muted" data-testid="version">
          Portfolio Tracker {APP_VERSION}
        </footer>
      </nav>
      <main>
        {route.view === "dashboard" && <DashboardView />}
        {route.view === "holdings" && <HoldingsView key="holdings" params={route.params} setParams={setParams} />}
        {route.view === "transactions" && <TransactionsView key="transactions" params={route.params} setParams={setParams} />}
      </main>
    </div>
  );
}
