import { useEffect, useRef } from "react";
import { MarkdownText } from "./NotesView.tsx";
import { useNarrow } from "./useNarrow.ts";
import { ARTICLES, SECTIONS, wikiHref } from "./wiki/articles.ts";

/**
 * The Wiki: how the app calculates what it shows (returns, bonds, tax), as read-only articles kept in the repo
 * (`src/wiki/`). Laid out as Notes: the list by section on the left, the open article (`?page=<slug>`) on the right;
 * on a phone they take turns. Without a page in the URL: the first article (on a phone: the list).
 */
export function WikiView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const slug = params["page"];
  const article = ARTICLES.find((a) => a.slug === slug);
  const narrow = useNarrow();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (!slug && !narrow && ARTICLES[0]) setParams({ page: ARTICLES[0].slug });
  }, [slug, narrow, setParams]);
  // A link from another article: start at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on another article only
  useEffect(() => {
    window.scrollTo(0, 0); // a block: newer browsers return a promise, which React would take for a cleanup
  }, [slug]);

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Wiki</h2>
        <span className="muted">how the app calculates what it shows</span>
      </header>
      <div className={`notes wiki${slug ? " has-note" : ""}`}>
        <nav className="notes-list panel" aria-label="Articles">
          {SECTIONS.map((s) => (
            <div key={s.name}>
              <h3 className="wiki-section">{s.name}</h3>
              <ul>
                {ARTICLES.filter((a) => a.section === s.name).map((a) => (
                  <li key={a.slug}>
                    <a href={wikiHref(a.slug)} aria-current={a.slug === slug ? "page" : undefined} data-testid="wiki-item">
                      <span className="note-title">{a.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <article className="note panel" data-testid="wiki-article">
          {slug && (
            <button type="button" className="link notes-back" onClick={() => setParams({})}>
              ← All articles
            </button>
          )}
          {article ? (
            <>
              <div className="note-header">
                <h3 data-testid="wiki-title">{article.title}</h3>
              </div>
              <p className="faint note-meta">{article.section}</p>
              <MarkdownText text={article.body} />
            </>
          ) : slug ? (
            <p className="muted">There's no such article (any more).</p>
          ) : (
            <p className="muted">Pick an article.</p>
          )}
        </article>
      </div>
    </>
  );
}
