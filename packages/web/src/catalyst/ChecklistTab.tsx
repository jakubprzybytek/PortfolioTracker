// The reports checklist (Docs/catalyst.md, "Issuers"): reports the agent can't fetch, waiting for you to download
// from the KRS financial documents repository (no API, bot protection), with the KRS number to copy and their state.
import { useState } from "react";
import { apiSend } from "../api.ts";
import { useApi } from "../useApi.ts";

interface Entry {
  entityId: string;
  krs: string | null;
  year: number;
  scope: string;
  where: string;
  status: "missing" | "downloaded" | "imported" | "not-available";
  note?: string;
  by: string;
  at: string;
}
const STATUS: Record<Entry["status"], string> = { missing: "to download", downloaded: "downloaded", imported: "imported", "not-available": "not available" };

export function ChecklistTab({ names }: { names: Map<string, string> }) {
  const list = useApi<{ checklist: Entry[] }>("/catalyst/checklist");
  const [error, setError] = useState<string | null>(null);
  const setStatus = async (e: Entry, status: Entry["status"]) => {
    setError(null);
    try {
      await apiSend("PUT", `/catalyst/checklist/${encodeURIComponent(e.entityId)}/${e.year}/${e.scope}`, { status });
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const rows = list.data?.checklist ?? [];
  return (
    <section className="panel" data-testid="checklist">
      <p className="muted cat-facts">
        Reports the agent added for you: the KRS repository (rdf-przegladarka.ms.gov.pl) has no API, so they're downloaded by hand. Search by the KRS number, download the year's statement, then
        sort and import it with the CLI (<code>catalyst filings import</code>).
      </p>
      {error && <p className="error">{error}</p>}
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {list.data && rows.length === 0 && <p className="muted">Nothing to download.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="static">
            <thead>
              <tr>
                <th className="left">Company</th>
                <th className="left">KRS</th>
                <th>Year</th>
                <th className="left">Accounts</th>
                <th className="left">Where</th>
                <th className="left">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.entityId}#${e.year}#${e.scope}`} data-testid="checklist-row">
                  <td className="left">{names.get(e.entityId) ?? e.entityId}</td>
                  <td className="left">
                    {e.krs ? (
                      <button type="button" className="link-button" title="Copy" onClick={() => void navigator.clipboard?.writeText(e.krs!)}>
                        {e.krs}
                      </button>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>{e.year}</td>
                  <td className="left">{e.scope}</td>
                  <td className="left muted">{e.where}</td>
                  <td className="left">
                    <select value={e.status} onChange={(x) => void setStatus(e, x.target.value as Entry["status"])} aria-label="State" data-testid="checklist-status">
                      {Object.entries(STATUS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
