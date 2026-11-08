// The AI agent's token (Docs/catalyst.md, "The catalyst CLI"): made here and shown once, kept by the CLI in your
// profile (`! npx catalyst login --stage <stage>`); the app keeps only its SHA-256. Replacing or revoking it stops
// the old one at once, so both ask first.
import { useState } from "react";
import { apiSend } from "../api.ts";
import { fmtTime } from "../format.ts";
import { useApi } from "../useApi.ts";

interface TokenState {
  token: { createdAt: string; lastUsedAt: string | null } | null;
}

/** The stage this page belongs to, for the login command (prod at the root domain). */
const stage = () => {
  const host = window.location.hostname;
  return host.startsWith("localhost") || host.startsWith("127.") ? "dev" : (/^([a-z0-9-]+)\.portfoliotracker\./.exec(host)?.[1] ?? "prod");
};

export function AgentTokenPanel() {
  const state = useApi<TokenState>("/catalyst/agent-token");
  const [made, setMade] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const t = state.data?.token;
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
      setMade((await apiSend<{ token: string }>("POST", "/catalyst/agent-token")).token);
      setCopied(false);
    });
  const revoke = () =>
    act(async () => {
      await apiSend("DELETE", "/catalyst/agent-token");
      setMade(null);
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made ?? "");
      setCopied(true);
    } catch {
      setError("Couldn't copy: select the token and copy it.");
    }
  };

  return (
    <section className="panel cat-agent-token" data-testid="agent-token">
      <h3>AI agent's token</h3>
      <p className="muted">
        What the agent uses through the <code>catalyst</code> CLI: reading the module, and writing names, company descriptions, reports, collected figures, judgements and checklist entries. Not market data, settings, a lender's kind, the AI analysis switches,
        year reviews, or anything of the portfolio.
      </p>
      {state.loading && !state.data && <p className="muted">Loading…</p>}
      {state.data && !t && !made && <p data-testid="agent-token-state">No token.</p>}
      {t && (
        <p data-testid="agent-token-state">
          Made {fmtTime(t.createdAt)}, {t.lastUsedAt ? `last used ${fmtTime(t.lastUsedAt)}` : "not used yet"}.
        </p>
      )}
      {made && (
        <div className="cat-token-made">
          <p>
            Shown only now. Click Copy, then in Claude Code type <code>! npx catalyst login --stage {stage()} --from-clipboard</code> (or, in a terminal, <code>npx catalyst login --stage {stage()}</code> and paste it at the prompt). The CLI keeps it in your profile and shows only its last four characters; the agent never sees it.
          </p>
          <div className="cf-formula">
            <input readOnly value={made} onFocus={(e) => e.target.select()} aria-label="Agent token" data-testid="agent-token-value" />
            <button type="button" className="primary" onClick={() => void copy()} data-testid="agent-token-copy">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      <div className="modal-footer">
        {!t && !made && (
          <button type="button" className="primary" disabled={busy} onClick={() => void create()} data-testid="agent-token-create">
            Make a token
          </button>
        )}
        {(t || made) && confirm === null && (
          <>
            <button type="button" disabled={busy} onClick={() => setConfirm("replace")} data-testid="agent-token-replace">
              Replace
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm("revoke")} data-testid="agent-token-revoke">
              Revoke
            </button>
          </>
        )}
        {confirm && (
          <span className="confirm">
            {confirm === "replace" ? "The current token stops working." : "The agent loses its access."}
            <button type="button" disabled={busy} onClick={() => void (confirm === "replace" ? create() : revoke())} data-testid="agent-token-confirm">
              {confirm === "replace" ? "Replace" : "Revoke"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
