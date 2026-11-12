// The AI agent's tokens (Docs/catalyst.md, "The catalyst CLI"): several at once, one per machine or routine, each
// with a name to tell it apart. Each is made here and shown once, kept by the CLI in that machine's profile
// (`! npx catalyst login --stage <stage>`); the app keeps only its SHA-256. Revoking one stops it at once (the others
// go on), so it asks first.
import { useState } from "react";
import { apiSend } from "../api.ts";
import { fmtDateTime } from "../format.ts";
import { useApi } from "../useApi.ts";

interface TokenView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The stage this page belongs to, for the login command (prod at the root domain). */
const stage = () => {
  const host = window.location.hostname;
  return host.startsWith("localhost") || host.startsWith("127.") ? "dev" : (/^([a-z0-9-]+)\.portfoliotracker\./.exec(host)?.[1] ?? "prod");
};

export function AgentTokenPanel() {
  const state = useApi<{ tokens: TokenView[] }>("/catalyst/agent-tokens");
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ id: string; name: string; token: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokens = state.data?.tokens ?? [];
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
      state.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    act(async () => {
      const res = await apiSend<{ id: string; name: string; token: string }>("POST", "/catalyst/agent-tokens", { name: name.trim() });
      setMade({ id: res.id, name: res.name, token: res.token });
      setName("");
      setCopied(false);
    });
  const revoke = (id: string) =>
    act(async () => {
      await apiSend("DELETE", `/catalyst/agent-tokens/${encodeURIComponent(id)}`);
      if (made?.id === id) setMade(null);
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made?.token ?? "");
      setCopied(true);
    } catch {
      setError("Couldn't copy: select the token and copy it.");
    }
  };

  return (
    <section className="panel cat-agent-token" data-testid="agent-token">
      <h3>AI agent's tokens</h3>
      <p className="muted">
        What the agent uses through the <code>catalyst</code> CLI: reading the module, and writing names, company descriptions, reports, collected figures, judgements and checklist entries. Not market data, settings, a lender's kind, the AI analysis switches,
        year reviews, or anything of the portfolio. One token per machine or routine: its name is recorded with what the agent writes.
      </p>
      {state.loading && !state.data && <p className="muted">Loading…</p>}
      {state.data && tokens.length === 0 && <p data-testid="agent-token-state">No token.</p>}
      {tokens.length > 0 && (
        <ul className="cat-token-list" data-testid="agent-token-list">
          {tokens.map((t) => (
            <li key={t.id} data-testid="agent-token-row" data-name={t.name}>
              <span>
                <strong>{t.name}</strong>{" "}
                <span className="muted">
                  made {fmtDateTime(t.createdAt)}, {t.lastUsedAt ? `last used ${fmtDateTime(t.lastUsedAt)}` : "not used yet"}
                </span>
              </span>
              {confirm === t.id ? (
                <span className="confirm">
                  "{t.name}" stops working.
                  <button type="button" disabled={busy} onClick={() => void revoke(t.id)} data-testid="agent-token-confirm">
                    Revoke
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirm(t.id)} data-testid="agent-token-revoke">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {made && (
        <div className="cat-token-made" data-testid="agent-token-made">
          <p>
            "{made.name}", shown only now. Click Copy, then on that machine type <code>! npx catalyst login --stage {stage()} --from-clipboard</code> in Claude Code (or, in a terminal, <code>npx catalyst login --stage {stage()}</code> and paste it at the prompt). The CLI keeps it in your profile and shows only its last four characters; the agent never sees it.
          </p>
          <div className="cf-formula">
            <input readOnly value={made.token} onFocus={(e) => e.target.select()} aria-label="Agent token" data-testid="agent-token-value" />
            <button type="button" className="primary" onClick={() => void copy()} data-testid="agent-token-copy">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      <form
        className="modal-footer"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name, e.g. Laptop" aria-label="New token's name" data-testid="agent-token-name" />
        <button type="submit" className="primary" disabled={busy || !name.trim()} data-testid="agent-token-create">
          Make a token
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
