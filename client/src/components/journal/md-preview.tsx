import { Fragment } from "react";

/**
 * A reader's Markdown as the article page will show it, drawn in the browser for the editor's preview and the
 * admin's queue. Only what the editor's toolbar writes: ## and ### headings, paragraphs, - and 1. lists, > quotes,
 * --- rules, **bold**, *italic* and [links](https://…). Everything is React text — no HTML from the author ever
 * reaches the page. The published page compiles the same Markdown on the server (journal/[slug]).
 */

type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flush();
      continue;
    }
    if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) {
      flush();
      out.push({ kind: m[1].length === 2 ? "h2" : "h3", text: m[2] });
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flush();
      out.push({ kind: "hr" });
    } else if ((m = /^\s*[-*]\s+(.+)$/.exec(line))) {
      flush();
      if (last?.kind === "ul") last.items.push(m[1]);
      else out.push({ kind: "ul", items: [m[1]] });
    } else if ((m = /^\s*\d+[.)]\s+(.+)$/.exec(line))) {
      flush();
      if (last?.kind === "ol") last.items.push(m[1]);
      else out.push({ kind: "ol", items: [m[1]] });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      if (last?.kind === "quote") last.text += ` ${m[1]}`;
      else out.push({ kind: "quote", text: m[1] });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** **bold**, *italic* / _italic_ and [text](url) inside a line; a link that isn't http(s) or the site's own stays text. */
function inline(text: string, key = 0): React.ReactNode[] {
  const re = /\*\*(.+?)\*\*|(?<![*\w])[*_](?![\s*_])(.+?)(?<!\s)[*_](?![*\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const out: React.ReactNode[] = [];
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const k = `${key}-${m.index}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], key + 1)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k}>{inline(m[2], key + 1)}</em>);
    else {
      const href = m[4];
      const ok = /^https?:\/\//i.test(href) || (href.startsWith("/") && !href.startsWith("//"));
      out.push(
        ok ? (
          <a key={k} href={href} rel="ugc nofollow noopener" target="_blank">
            {inline(m[3], key + 1)}
          </a>
        ) : (
          <Fragment key={k}>{m[3]}</Fragment>
        ),
      );
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function MdPreview({ source, className }: { source: string; className?: string }) {
  const list = blocks(source);
  if (!list.length) return <p className="text-muted">Здесь появится текст статьи.</p>;
  return (
    <div className={className ?? "journal-body"}>
      {list.map((b, i) => {
        switch (b.kind) {
          case "h2":
            return <h2 key={i}>{inline(b.text)}</h2>;
          case "h3":
            return <h3 key={i}>{inline(b.text)}</h3>;
          case "quote":
            return (
              <blockquote key={i}>
                <p>{inline(b.text)}</p>
              </blockquote>
            );
          case "ul":
          case "ol": {
            const Tag = b.kind;
            return (
              <Tag key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </Tag>
            );
          }
          case "hr":
            return <hr key={i} />;
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
