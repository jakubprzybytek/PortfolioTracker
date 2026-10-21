import { SkeletonRows } from "./Placeholders.tsx";
import type { Status } from "./types.ts";
import { useApi } from "./useApi.ts";

/** The scheduled jobs' last runs (opened from the menu's footer and the Dashboard's failed-jobs warning). */
export function StatusView() {
  const status = useApi<Status>("/status");
  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Status</h2>
        <span className="muted">{status.loading ? "Loading…" : ""}</span>
      </header>
      {status.error && <p className="error">{status.error}</p>}

      <h2>Jobs</h2>
      <div className="table-wrap">
        <table data-testid="jobs-table" className="static">
          <thead>
            <tr>
              <th className="left">Job</th>
              <th className="left">Last run</th>
              <th className="left">Status</th>
              <th className="left">Note</th>
            </tr>
          </thead>
          <tbody>
            {!status.data && status.loading && <SkeletonRows rows={9} cols={4} />}
            {Object.entries(status.data?.jobs ?? {}).map(([name, j]) => (
              <tr key={name} data-testid={`job-${name}`}>
                <td className="left">{name}</td>
                <td className="left muted">{j?.finishedAt?.replace("T", " ").slice(0, 16) ?? "never"}</td>
                <td className={`left ${j?.status === "failed" ? "status-failed" : j ? "status-ok" : "muted"}`}>{j?.status ?? "–"}</td>
                <td className="left muted" style={{ whiteSpace: "normal", maxWidth: 600 }}>
                  {j?.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
