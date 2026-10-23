"use client";

import { useEffect } from "react";

/**
 * Last resort when the root layout itself fails: it replaces the whole document, and globals.css, the fonts and the
 * theme may not be loaded, so everything it needs is inline. Russian, like the rest of the site.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="ru">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f4efe6", color: "#1b1b1b", fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <title>Ошибка · ichiba</title>
        <main style={{ maxWidth: 420, padding: "48px 24px", textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>Что-то пошло не так</h1>
          <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.5, color: "#4a4a4a" }}>Сайт не загрузился из-за ошибки. Повторите — обычно этого достаточно.</p>
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ height: 44, padding: "0 20px", border: 0, borderRadius: 999, background: "#1f3354", color: "#f4efe6", font: "inherit", fontWeight: 600, cursor: "pointer" }}
            >
              Повторить
            </button>
            {/* A plain link on purpose: a full page load starts the app from scratch. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ height: 44, padding: "0 20px", borderRadius: 999, border: "1.5px solid #1f3354", color: "#1f3354", display: "inline-flex", alignItems: "center", textDecoration: "none", fontWeight: 600 }}>
              На главную
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
