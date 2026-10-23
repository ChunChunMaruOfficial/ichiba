/**
 * Reads a public Telegram channel through its web preview (t.me/s/<channel>): no API keys, no account.
 * The preview shows ~20 posts per page, newest last; `?before=<id>` pages back through the history.
 */

export interface TgPostData {
  id: number;
  date: string | null;
  text: string;
  /** Photo URLs in the order the album shows them. */
  photos: string[];
  hasVideo: boolean;
}

export interface TgChannelData {
  title: string;
  description: string;
  avatarUrl: string | null;
  posts: TgPostData[];
}

import { safeFetch, safeFetchText, telegramHost } from './fetch-safe.js';

const UA = 'Mozilla/5.0 (compatible; ichiba-import/1.0)';

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/** Inner HTML of a message text block to plain text: <br> → newline, tags dropped, entities decoded. */
const toText = (html: string) =>
  decode(html.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .trim();

export function parsePage(html: string): TgChannelData {
  const title = /tgme_channel_info_header_title[^>]*>\s*<span[^>]*>([^<]*)/.exec(html)?.[1] ?? '';
  const description = /tgme_channel_info_description">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const avatarUrl = /<i class="tgme_page_photo_image[^"]*"[^>]*><img src="([^"]+)"/.exec(html)?.[1] ?? null;

  const posts: TgPostData[] = [];
  const chunks = html.split('<div class="tgme_widget_message_wrap').slice(1);
  for (const chunk of chunks) {
    const id = /data-post="[^"/]+\/(\d+)"/.exec(chunk)?.[1];
    if (!id) continue;
    const text = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    const photos = [...chunk.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    posts.push({
      id: Number(id),
      date: /datetime="([^"]+)"/.exec(chunk)?.[1] ?? null,
      text: text ? toText(text) : '',
      photos,
      hasVideo: chunk.includes('tgme_widget_message_video_player'),
    });
  }
  return { title: decode(title).trim(), description: toText(description), avatarUrl, posts };
}

/** A channel page: only Telegram's own hosts, however the page or a redirect points elsewhere. */
function get(url: string): Promise<string> {
  return safeFetchText(url, { allow: telegramHost, userAgent: UA });
}

/**
 * The whole channel history, oldest first. `complete` is false when a page failed midway: the caller must
 * not treat posts missing from an incomplete crawl as deleted.
 */
export async function fetchChannel(channel: string, maxPages = 60): Promise<TgChannelData & { complete: boolean }> {
  const first = parsePage(await get(`https://t.me/s/${channel}`));
  const byId = new Map(first.posts.map((p) => [p.id, p]));
  let complete = true;
  let before = first.posts.length ? Math.min(...first.posts.map((p) => p.id)) : 0;
  for (let page = 1; page < maxPages && before > 1; page++) {
    await new Promise((r) => setTimeout(r, 700));
    let posts: TgPostData[];
    try {
      posts = parsePage(await get(`https://t.me/s/${channel}?before=${before}`)).posts;
    } catch {
      complete = false;
      break;
    }
    const fresh = posts.filter((p) => !byId.has(p.id));
    if (!fresh.length) break;
    for (const p of fresh) byId.set(p.id, p);
    before = Math.min(...fresh.map((p) => p.id));
  }
  if (!first.posts.length) complete = false;
  return { ...first, posts: [...byId.values()].sort((a, b) => a.id - b.id), complete };
}

/** The channel picture at 320 px (the history page carries only a 160 px one). */
export async function fetchAvatarUrl(channel: string): Promise<string | null> {
  return /<meta property="og:image" content="([^"]+)"/.exec(await get(`https://t.me/${channel}`))?.[1] ?? null;
}

/** A photo or avatar URL taken from a channel page: Telegram's CDNs only, an image, at most 15 MB. */
export function download(url: string): Promise<Buffer> {
  return safeFetch(url, { allow: telegramHost, userAgent: UA, image: true });
}
