import type { PhotoUrls } from "./api";

/** A reader's own article as /journal/mine gives it (server/src/journal/journal.ts). */
export interface MyArticle {
  id: string;
  slug: string;
  rubric: string;
  title: string;
  description: string;
  /** Absent in the list, present when one article is opened. */
  body?: string;
  cover: { id: string; width: number; height: number; urls: PhotoUrls } | null;
  status: ArticleStatus;
  rejectReason: string | null;
  aiTopic: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  words: number;
}

export type ArticleStatus = "DRAFT" | "AI_REJECTED" | "PENDING" | "REJECTED" | "PUBLISHED";

/** What sending needs (the server checks the same); a draft may be anything shorter. */
export const ARTICLE_LIMITS = { title: [10, 120], description: [40, 300], body: [800, 40_000] } as const;

/** Each status as the author reads it, with the badge tone. */
export const ARTICLE_STATUS: Record<ArticleStatus, { label: string; tone: "muted" | "warn" | "ai" | "danger" | "ok" }> = {
  DRAFT: { label: "Черновик", tone: "muted" },
  AI_REJECTED: { label: "Тема не подошла", tone: "danger" },
  PENDING: { label: "У редактора", tone: "ai" },
  REJECTED: { label: "Вернули на доработку", tone: "warn" },
  PUBLISHED: { label: "Опубликована", tone: "ok" },
};

/** The author may change the text only before sending or after it came back. */
export const editable = (s: ArticleStatus) => s === "DRAFT" || s === "AI_REJECTED" || s === "REJECTED";
