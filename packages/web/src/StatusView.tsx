import type { QualityReportItem } from "@portfolio/core/db/items";
import type { QualityIssue } from "@portfolio/core/quality/quality";
import { SkeletonRows } from "./Placeholders.tsx";
import type { Status, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

const KIND_LABELS: Record<QualityIssue["kind"], string> = { gap: "Missing prices", stale: "Price stopped", jump: "Jump", range: "Out of range" };
const KIND_ORDER: QualityIssue["kind"][] = ["stale", "range", "jump", "gap"];

/** The latest data-quality report (`GET /quality`, the daily `quality` job): its issues, most urgent kinds first. */
function DataQuality() {
  const q = useApi<Omit<QualityReportItem, "PK" | "SK"> | null>("/quality");
  const issues = [...(q.data?.issues ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.code.localeCompare(b.code) || a.date.localeCompare(b.date));
  return (
    <>
      <h2>
        Data quality{" "}
        <span className="muted chart-legend" data-testid="quality-summary">
          {q.data
            ? `${q.data.instruments} held instruments' prices, ${q.data.from} – ${q.data.lastDay}; checked ${q.data.checkedAt.replace("T", " ").slice(0, 16)}`
            : q.data === null
              ? "not checked yet (daily at 08:30, Tue–Sat)"
              : ""}
        </span>
      </h2>
      {q.error && <p className="error">{q.error}</p>}
      <div className="table-wrap">
        <table data-testid="quality-table" className="static">
          <thead>
            <tr>
              <th className="left">Instrument</th>
              <th className="left">Problem</th>
              <th className="left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {q.data === undefined && q.loading && <SkeletonRows rows={3} cols={3} />}
            {q.data && issues.length === 0 && (
              <tr>
                <td className="left muted" colSpan={3}>
                  No problems found.
                </td>
              </tr>
            )}
            {issues.map((i) => (
              <tr key={`${i.kind}|${i.isin}|${i.date}`} data-testid="quality-row" data-kind={i.kind}>
                <td className="left" title={i.isin}>
                  {i.code}
                </td>
                <td className={`left ${i.kind === "gap" ? "" : "status-failed"}`}>{KIND_LABELS[i.kind]}</td>
                <td className="left muted" style={{ whiteSpace: "normal" }}>
                  {i.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Data quality and the scheduled jobs' last runs (opened from the menu's footer and the Dashboard's failed-jobs warning). */
export function StatusView() {
  const status = useApi<Status>("/status");
  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Status</h2>
        <span className="muted">{status.loading ? "Loading…" : ""}</span>
      </header>
      {status.error && <p className="error">{status.error}</p>}
      {!!status.data?.deadLetter && (
        <p className="error" role="alert" data-testid="dead-letter">
          {status.data.deadLetter} revaluation request{status.data.deadLetter > 1 ? "s" : ""} failed 3 times and wait{status.data.deadLetter > 1 ? "" : "s"} in the dead-letter queue: the days they cover may be out of date. Run a full revaluation once the cause is fixed.
        </p>
      )}

      <DataQuality />

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
                <td className="left muted">{(j?.finishedAt ?? j?.startedAt)?.replace("T", " ").slice(0, 16) ?? "never"}</td>
                <td className={`left ${j?.status === "failed" ? "status-failed" : j?.status === "ok" ? "status-ok" : "muted"}`}>{j?.status ?? "–"}</td>
                <td className="left muted" style={{ whiteSpace: "normal", maxWidth: 600 }}>
                  {j?.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TransactionLog />
    </>
  );
}

interface LogEntry {
  at: string;
  action: "added" | "edited" | "deleted";
  by: string;
  before?: Transaction;
  after?: Transaction;
}

/** What changed in a transaction: the fields that differ, "old → new". */
function changes(e: LogEntry): string {
  const t = (e.after ?? e.before)!;
  const what = `${t.date} · ${t.account} · ${t.type}${t.isin ? ` ${t.isin}` : ""} · ${t.amount} ${t.currency}`;
  if (e.action !== "edited" || !e.before || !e.after) return what;
  const before = e.before as unknown as Record<string, unknown>;
  const after = e.after as unknown as Record<string, unknown>;
  const diff = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${String(before[k] ?? "–")} → ${String(after[k] ?? "–")}`);
  return `${what}${diff.length ? ` (${diff.join(", ")})` : " (no change)"}`;
}

/** The audit trail: the latest changes to transactions made in the app. */
function TransactionLog() {
  const log = useApi<LogEntry[]>("/transactions/log", { limit: "30" });
  return (
    <>
      <h2>Changes to transactions</h2>
      {log.error && <p className="error">{log.error}</p>}
      <div className="table-wrap">
        <table data-testid="tx-log" className="static">
          <thead>
            <tr>
              <th className="left">When</th>
              <th className="left">Change</th>
              <th className="left">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {!log.data && log.loading && <SkeletonRows rows={3} cols={3} />}
            {log.data?.length === 0 && (
              <tr>
                <td className="left muted" colSpan={3}>
                  No changes made in the app yet.
                </td>
              </tr>
            )}
            {log.data?.map((e) => (
              <tr key={`${e.at}/${(e.after ?? e.before)?.id}`} data-testid="tx-log-row">
                <td className="left muted">{e.at.replace("T", " ").slice(0, 16)}</td>
                <td className="left">{e.action}</td>
                <td className="left" style={{ whiteSpace: "normal" }}>
                  {changes(e)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
