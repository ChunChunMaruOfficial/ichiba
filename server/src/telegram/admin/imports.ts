import type { Routes } from './ctx.js';
import { btn, clip, dt, h, menu, screen, str, toast, go, type Btn } from './ui.js';

interface Overview {
  tg: Array<{ channel: string; username: string; enabled: boolean; lastSyncAt: string | null; posts: Record<string, number>; live: number; all: number }>;
  shops: Array<{ key: string; username: string; enabled: boolean; lastSyncAt: string | null; products: Record<string, number>; live: number; all: number }>;
  hand: Array<{ username: string; account: { createdAt: string; hasPassword: boolean; hasAvatar: boolean; own: boolean } | null; brand: string | null; items: number; listed: number; missing: string[]; live: number; all: number }>;
}

const counts = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${h(k)} ${n}`).join(', ') || '—';

/** Every outside source the site lists from; a channel or a shop can be paused and resumed. */
export const importRoutes: Routes = {
  async imports({ api }) {
    const o = await api<Overview>('GET', '/admin/imports');
    const lines = ['📥 <b>Импорты</b>'];
    const rows: Btn[][] = [];
    if (o.tg.length) {
      lines.push('', '<b>Telegram-каналы</b>');
      for (const s of o.tg) {
        lines.push(`${s.enabled ? '🟢' : '⏸'} t.me/${h(s.channel)} → @${h(s.username)} · в продаже ${s.live}/${s.all} · ${dt(s.lastSyncAt)}\n   <i>посты: ${counts(s.posts)}</i>`);
        rows.push([btn(`${s.enabled ? '⏸ Пауза' : '▶️ Включить'} ${clip(s.channel, 22)}`, 'imports.tg', { channel: s.channel, enabled: !s.enabled })]);
      }
    }
    if (o.shops.length) {
      lines.push('', '<b>Сайты брендов</b>');
      for (const s of o.shops) {
        lines.push(`${s.enabled ? '🟢' : '⏸'} ${h(s.key)} → @${h(s.username)} · в продаже ${s.live}/${s.all} · ${dt(s.lastSyncAt)}\n   <i>товары: ${counts(s.products)}</i>`);
        rows.push([btn(`${s.enabled ? '⏸ Пауза' : '▶️ Включить'} ${clip(s.key, 22)}`, 'imports.shop', { key: s.key, enabled: !s.enabled })]);
      }
    }
    if (o.hand.length) {
      lines.push('', '<b>Ручные партии</b>');
      for (const b of o.hand) {
        const acc = b.account ? '' : ' · ⚠️ аккаунта нет';
        lines.push(`${b.missing.length ? '🟡' : '✅'} @${h(b.username)}${b.brand ? ` («${h(b.brand)}»)` : ''} · выставлено ${b.listed}/${b.items} · в продаже ${b.live}${acc}${b.missing.length ? `\n   <i>не выставлены: ${h(clip(b.missing.join(', '), 120))}</i>` : ''}`);
      }
    }
    rows.push([btn('🔄', 'imports'), menu()]);
    return screen(lines.join('\n'), rows);
  },
  async 'imports.tg'({ api, p }) {
    await api('PATCH', `/admin/imports/tg/${encodeURIComponent(str(p.channel))}`, { enabled: p.enabled === true });
    return toast(p.enabled === true ? '▶️ Канал включён' : '⏸ Канал на паузе', go('imports'));
  },
  async 'imports.shop'({ api, p }) {
    await api('PATCH', `/admin/imports/shops/${encodeURIComponent(str(p.key))}`, { enabled: p.enabled === true });
    return toast(p.enabled === true ? '▶️ Магазин включён' : '⏸ Магазин на паузе', go('imports'));
  },
};
