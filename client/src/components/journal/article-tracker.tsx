"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * The journal's goals in Metrica and GA4 (lib/analytics.ts), without a script in the article itself:
 * article_read when 70 % of the page has been scrolled, article_faq_open when a question is opened, and the clicks
 * marked with data-track (the sell CTA, an item in «Сейчас на ichiba»). Nothing is sent before consent.
 */
export function ArticleTracker({ slug, rubric }: { slug: string; rubric: string }) {
  useEffect(() => {
    const params = { slug, rubric };
    let read = false;
    const onScroll = () => {
      if (read) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY / max >= 0.7) {
        read = true;
        track("article_read", params);
      }
    };
    const onToggle = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLDetailsElement && el.open && el.hasAttribute("data-faq")) track("article_faq_open", params);
    };
    const onClick = (e: Event) => {
      const goal = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-track]")?.dataset.track;
      if (goal === "article_cta_sell" || goal === "article_item_click") track(goal, params);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [slug, rubric]);
  return null;
}
