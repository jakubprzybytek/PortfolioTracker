import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiSend } from "./api.ts";
import type { Note } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Markdown (GitHub flavour: tables, task lists, strikethrough). Raw HTML in the text is shown as text, not run. */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown" data-testid="note-rendered">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

const fmtUpdated = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Notes in Markdown: the list (last changed first) and the open note (`?note=<id>`), shown rendered; "Edit" turns it
 * into a title and a text box with a live preview. On a phone the list and the note take turns.
 */
export function NotesView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const [reload, setReload] = useState(0);
  const notes = useApi<Note[]>("/notes", {}, [reload]);
  const selectedId = params["note"];
  const creating = params["note"] === "new";
  const selected = notes.data?.find((n) => n.id === selectedId);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(creating), [selectedId, creating]);

  const open = (id: string | undefined) => setParams({ note: id });
  const saved = (n: Note) => {
    setEditing(false);
    setReload((r) => r + 1);
    open(n.id);
  };
  const deleted = () => {
    setReload((r) => r + 1);
    open(undefined);
  };

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Notes</h2>
        <button type="button" className="primary" onClick={() => open("new")} data-testid="note-new">
          New note
        </button>
      </header>
      {notes.error && <p className="error">{notes.error}</p>}
      <div className={`notes${selectedId ? " has-note" : ""}`}>
        <nav className="notes-list panel" aria-label="Notes">
          {notes.loading && !notes.data ? (
            <p className="muted">Loading…</p>
          ) : notes.data?.length ? (
            <ul>
              {notes.data.map((n) => (
                <li key={n.id}>
                  <a
                    href={`#/notes?note=${n.id}`}
                    aria-current={n.id === selectedId ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      open(n.id);
                    }}
                    data-testid="note-item"
                  >
                    <span className="note-title">{n.title}</span>
                    <span className="faint">{fmtUpdated(n.updatedAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No notes yet.</p>
          )}
        </nav>
        <section className="note panel" data-testid="note">
          {selectedId && (
            <button type="button" className="link notes-back" onClick={() => open(undefined)}>
              ← All notes
            </button>
          )}
          {editing ? (
            <NoteEditor key={selected?.id ?? "new"} note={creating ? undefined : selected} onSaved={saved} onCancel={() => (creating ? open(undefined) : setEditing(false))} />
          ) : selected ? (
            <NoteBody note={selected} onEdit={() => setEditing(true)} onDeleted={deleted} />
          ) : selectedId && !notes.loading ? (
            <p className="muted">This note doesn't exist (any more).</p>
          ) : (
            !selectedId && <p className="muted">Pick a note, or write a new one.</p>
          )}
        </section>
      </div>
    </>
  );
}

function NoteBody({ note, onEdit, onDeleted }: { note: Note; onEdit: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setConfirm(false), [note.id]);
  const remove = async () => {
    setBusy(true);
    try {
      await apiSend("DELETE", `/notes/${note.id}`);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="note-header">
        <h3 data-testid="note-title">{note.title}</h3>
        <div className="note-actions">
          <button type="button" className="link" onClick={onEdit} data-testid="note-edit">
            Edit
          </button>
          {confirm ? (
            <button type="button" className="danger" onClick={() => void remove()} disabled={busy} data-testid="note-delete-confirm">
              {busy && <span className="spinner" aria-hidden />}
              Delete?
            </button>
          ) : (
            <button type="button" className="danger-link" onClick={() => setConfirm(true)} data-testid="note-delete">
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="faint note-meta">Changed {fmtUpdated(note.updatedAt)}</p>
      {error && <p className="error">{error}</p>}
      <MarkdownText text={note.body} />
    </>
  );
}

function NoteEditor({ note, onSaved, onCancel }: { note?: Note; onSaved: (n: Note) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(note ? await apiSend<Note>("PUT", `/notes/${note.id}`, { title, body }) : await apiSend<Note>("POST", "/notes", { title, body }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="note-editor" onSubmit={(e) => void save(e)}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" required maxLength={200} data-testid="note-title-input" />
      <div className="note-editor-panes">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write in Markdown: # heading, **bold**, - list, | table |" aria-label="Text (Markdown)" data-testid="note-body-input" />
        <div className="note-preview" aria-label="Preview">
          {body.trim() ? <MarkdownText text={body} /> : <p className="faint">Preview</p>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="note-editor-footer">
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy} data-testid="note-save">
          {busy && <span className="spinner" aria-hidden />}
          Save
        </button>
      </div>
    </form>
  );
}
