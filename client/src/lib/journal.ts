import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";
import { authorById, type Author } from "./journal-authors";
import { rubricBySlug, type Rubric } from "./journal-rubrics";

/**
 * The journal's articles: MDX files in content/journal, one per article, the file name being the URL slug
 * (/journal/<slug>). The front matter below is the whole contract between an author and the site; the body is MDX
 * with the components of components/journal/mdx-components.tsx. Drafts (`draft: true`) render in development only.
 */

export interface Faq {
  q: string;
  a: string;
}

export interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  rubric: Rubric;
  author: Author;
  publishedAt: string;
  updatedAt: string;
  /** Under public/, e.g. /journal/<slug>/cover.jpg. */
  cover: string | null;
  coverAlt: string | null;
  tags: string[];
  /** Catalogue pages the article is about (c/jeans, brands/mirarwear): the pages show it under their items. */
  catalog: string[];
  /** «Коротко»: the 3–5 sentences that answer the article's question. */
  summary: string[];
  faq: Faq[];
  /** Slugs of the articles to read next; the section's latest fill in. */
  related: string[];
  draft: boolean;
  /** Minutes at a reading pace of 180 words a minute. */
  minutes: number;
  words: number;
}

export interface Heading {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface Article extends ArticleMeta {
  body: string;
  headings: Heading[];
}

const DIR = join(process.cwd(), "content", "journal");
const SHOW_DRAFTS = process.env.NODE_ENV !== "production";

const str = (v: unknown, field: string, slug: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`journal/${slug}: «${field}» обязательно`);
  return v.trim();
};
const date = (v: unknown, field: string, slug: string): string => {
  const d = v instanceof Date ? v : new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new Error(`journal/${slug}: «${field}» — не дата`);
  return d.toISOString().slice(0, 10);
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);

/** Words of the body without the MDX tags and front matter: the reading time and a sanity check in the checklist. */
const countWords = (body: string) =>
  body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`|-]+/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The h2 and h3 lines of the body, with the ids rehype-slug gives them (the same slugger, fresh per document). */
export function headingsOf(body: string): Heading[] {
  const slugger = new GithubSlugger();
  const out: Heading[] = [];
  let fenced = false;
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(##|###)\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    out.push({ id: slugger.slug(text), text, depth: m[1].length as 2 | 3 });
  }
  return out;
}

function parse(slug: string, raw: string): Article {
  const { data, content } = matter(raw);
  const rubric = rubricBySlug(str(data.rubric, "rubric", slug));
  if (!rubric) throw new Error(`journal/${slug}: неизвестная рубрика «${String(data.rubric)}»`);
  const author = authorById(typeof data.author === "string" && data.author ? data.author : "team");
  if (!author) throw new Error(`journal/${slug}: неизвестный автор «${String(data.author)}»`);
  const publishedAt = date(data.publishedAt, "publishedAt", slug);
  const faq = Array.isArray(data.faq)
    ? (data.faq as Array<Record<string, unknown>>).map((f) => ({ q: str(f.q, "faq.q", slug), a: str(f.a, "faq.a", slug) }))
    : [];
  const words = countWords(content);
  return {
    slug,
    title: str(data.title, "title", slug),
    description: str(data.description, "description", slug),
    rubric,
    author,
    publishedAt,
    updatedAt: data.updatedAt ? date(data.updatedAt, "updatedAt", slug) : publishedAt,
    cover: typeof data.cover === "string" && data.cover ? data.cover : null,
    coverAlt: typeof data.coverAlt === "string" && data.coverAlt ? data.coverAlt : null,
    tags: list(data.tags),
    catalog: list(data.catalog).map((p) => p.replace(/^\//, "")),
    summary: list(data.summary),
    faq,
    related: list(data.related),
    draft: data.draft === true,
    minutes: Math.max(1, Math.round(words / 180)),
    words,
    body: content,
    headings: headingsOf(content),
  };
}

let cache: Promise<Article[]> | null = null;

/** Every article, newest first; drafts only outside production. Read once per server process. */
export function allArticles(): Promise<Article[]> {
  if (cache && !SHOW_DRAFTS) return cache;
  cache = (async () => {
    let files: string[] = [];
    try {
      files = (await readdir(DIR)).filter((f) => f.endsWith(".mdx"));
    } catch {
      return [];
    }
    const all = await Promise.all(files.map(async (f) => parse(f.replace(/\.mdx$/, ""), await readFile(join(DIR, f), "utf8"))));
    return all.filter((a) => SHOW_DRAFTS || !a.draft).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  })();
  return cache;
}

export async function article(slug: string): Promise<Article | null> {
  return (await allArticles()).find((a) => a.slug === slug) ?? null;
}

export async function articlesIn(rubric: string): Promise<Article[]> {
  return (await allArticles()).filter((a) => a.rubric.slug === rubric);
}

export async function articlesBy(authorId: string): Promise<Article[]> {
  return (await allArticles()).filter((a) => a.author.id === authorId);
}

/** The articles a brand or category page shows under its items: the ones about it, then its section's latest. */
export async function articlesForCatalog(path: string, limit = 3): Promise<Article[]> {
  const all = await allArticles();
  const about = all.filter((a) => a.catalog.some((p) => p === path || path.startsWith(`${p}/`)));
  return about.slice(0, limit);
}

/** «Читать дальше»: the named ones first, then the newest of the same section, never the article itself. */
export async function relatedTo(a: Article, limit = 3): Promise<Article[]> {
  const all = await allArticles();
  const named = a.related.map((s) => all.find((x) => x.slug === s)).filter((x): x is Article => !!x && x.slug !== a.slug);
  const same = all.filter((x) => x.rubric.slug === a.rubric.slug && x.slug !== a.slug && !named.includes(x));
  return [...named, ...same].slice(0, limit);
}

export const articleHref = (slug: string) => `/journal/${slug}`;
export const rubricHref = (slug: string) => `/journal/${slug}`;

export const formatDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
