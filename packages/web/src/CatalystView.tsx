import { fmtInt, fmtTime } from "./format.ts";
import type { Status } from "./types.ts";
import { useApi } from "./useApi.ts";

/** `GET /catalyst/status`: what the module holds so far and its jobs' latest runs. */
interface CatalystStatus {
  bonds: number;
  jobs: Status["jobs"];
  /** Requests that failed 3 times and wait in the dead-letter queue (null: couldn't be read). */
  deadLetter: number | null;
}

/**
 * The Catalyst module (Docs/catalyst.md): the whole Catalyst bond market, apart from the portfolio. Being built
 * (Docs/catalyst-phase1-plan.md): for now what it holds and its jobs.
 */
export function CatalystView() {
  const status = useApi<CatalystStatus>("/catalyst/status");
  const s = status.data;
  return (
    <div>
      <header className="view-header">
        <h2 className="view-title">Catalyst</h2>
      </header>
      <p className="muted">Every bond on the Catalyst market, with its yield, risk premium and liquidity: being built.</p>
      {status.error && <p className="error">{status.error}</p>}
      <p data-testid="catalyst-bonds">{s ? (s.bonds === 0 ? "No data yet." : `${fmtInt(s.bonds)} bonds.`) : status.loading ? "Loading…" : ""}</p>
      {s && (
        <div className="table-wrap">
          <table className="static" data-testid="catalyst-jobs">
            <thead>
              <tr>
                <th className="left">Job</th>
                <th className="left">Last run</th>
                <th className="left">Result</th>
                <th className="left">Note</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.jobs).map(([name, j]) => (
                <tr key={name}>
                  <td className="left">{name}</td>
                  <td className="left">{j ? `${j.startedAt.slice(0, 10)} ${fmtTime(j.startedAt)}` : "never"}</td>
                  <td className={`left ${j?.status === "failed" ? "status-failed" : j?.status === "ok" ? "status-ok" : "muted"}`}>{j?.status ?? "–"}</td>
                  <td className="left muted" style={{ whiteSpace: "normal" }}>
                    {j?.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s?.deadLetter ? <p className="error">{s.deadLetter} requests failed 3 times and wait in the dead-letter queue.</p> : null}
    </div>
  );
}
