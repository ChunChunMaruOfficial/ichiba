"use client";

import { useEffect } from "react";
import { Button, ButtonLink, EmptyState } from "@/components/ui";

/**
 * Any exception while rendering a page lands here instead of Next's English «Application error». The header and
 * footer (root layout) stay, so the reader can go elsewhere; «Повторить» re-fetches and re-renders the page.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Still visible in the browser console and to error monitoring that hooks console.error.
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 md:py-16">
      <EmptyState kanji="市場" title="Что-то пошло не так" hint="Страница не загрузилась из-за ошибки. Повторите — обычно этого достаточно.">
        <Button onClick={() => retry()}>Повторить</Button>
        <ButtonLink href="/" variant="secondary">
          На главную
        </ButtonLink>
      </EmptyState>
    </div>
  );
}
