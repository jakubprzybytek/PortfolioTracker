// The Wiki's articles and the links to them: every file listed in a section, every link to an existing article.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES, FILE_TEXTS, SECTIONS } from "../src/wiki/articles.ts";

const SRC = join(import.meta.dirname, "../src");
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
const slugs = new Set(ARTICLES.map((a) => a.slug));

describe("wiki", () => {
  it("lists every article file once, each with a title", () => {
    const listed = SECTIONS.flatMap((s) => s.slugs);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(FILE_TEXTS).sort());
    for (const a of ARTICLES) {
      expect(FILE_TEXTS[a.slug]).toMatch(/^# \S/);
      expect(a.body).not.toBe("");
    }
  });

  it("links between articles to articles that exist", () => {
    for (const a of ARTICLES) for (const [, slug] of a.body.matchAll(/#\/wiki\?page=([\w-]+)/g)) expect(slugs, `${a.slug} → ${slug}`).toContain(slug);
  });

  it('links from the app ("More →") to articles that exist', () => {
    const more = sources(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bmore="([\w-]+)"/g)].map((m) => m[1]!));
    expect(more.length).toBeGreaterThan(0);
    for (const slug of more) expect(slugs).toContain(slug);
  });
});
