// The Wiki's articles: Markdown files next to this one, bundled with the app (read-only, changed with the code they
// explain). An article's slug is its file name, its title the first line ("# Title"); SECTIONS sets their order. Link
// between articles with "#/wiki?page=<slug>"; an "i" links to one with `InfoTip`'s `more`.

const FILES = import.meta.glob<string>("./*.md", { query: "?raw", import: "default", eager: true });

export const SECTIONS: { name: string; slugs: string[] }[] = [
  { name: "Returns", slugs: ["xirr"] },
  { name: "Bonds", slugs: ["accrued-interest", "interest-period"] },
  { name: "Tax", slugs: ["coupon-tax"] },
];

export interface Article {
  slug: string;
  title: string;
  section: string;
  body: string;
}

/** Every file, as `{ slug: text }`. */
export const FILE_TEXTS: Record<string, string> = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [path.replace(/^.*\/|\.md$/g, ""), text]));

export const ARTICLES: Article[] = SECTIONS.flatMap((s) =>
  s.slugs.flatMap((slug) => {
    const text = FILE_TEXTS[slug];
    if (text === undefined) return [];
    const [first = "", ...rest] = text.split("\n");
    return [{ slug, title: first.replace(/^#\s*/, "").trim(), section: s.name, body: rest.join("\n").trim() }];
  }),
);

export const wikiHref = (slug: string) => `#/wiki?page=${slug}`;
