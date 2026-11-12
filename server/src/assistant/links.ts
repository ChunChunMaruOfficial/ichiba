import type { Button } from './types.js';

/**
 * Pages the assistant may point at. The model names a key; a path never comes from the model, so it can't invent a
 * link. Checked against the client's routes in test/unit/assistant.test.ts.
 */
export const LINKS = {
  sell: ['Выставить вещь', '/sell'],
  wardrobe: ['Мой гардероб', '/wardrobe'],
  sales: ['Мои продажи', '/sales'],
  sales_action: ['Ждут моего ответа', '/sales?tab=action'],
  stats: ['Статистика', '/sales/stats'],
  purchases: ['Мои покупки', '/purchases'],
  purchases_offers: ['Мои предложения цены', '/purchases?tab=offers'],
  cart: ['Корзина', '/cart'],
  favorites: ['Избранное', '/favorites'],
  following: ['Подписки', '/favorites?tab=following'],
  notifications: ['Уведомления', '/notifications'],
  messages: ['Сообщения', '/messages'],
  settings: ['Настройки', '/settings'],
  settings_look: ['Вид карточек', '/settings#appearance'],
  settings_phone: ['Телефон', '/settings#phone'],
  settings_sizes: ['Размеры и мерки', '/settings#sizes'],
  settings_bundle: ['Скидка за комплект', '/settings#bundle'],
  settings_email: ['Письма', '/settings#notify'],
  settings_telegram: ['Telegram', '/settings#telegram'],
  settings_account: ['Выход и удаление аккаунта', '/settings#danger'],
  onboarding: ['Подобрать ленту заново', '/welcome'],
  brands: ['Бренды', '/'],
  resale: ['Вторичка', '/resale'],
  auctions: ['Аукционы', '/resale?chip=auctions'],
  open_shop: ['Открыть лавку', '/sellers'],
  apply_brand: ['Анкета бренда', '/sellers/apply'],
  apply_shop: ['Анкета магазина', '/sellers/apply?kind=CATALOG'],
  journal: ['Журнал', '/journal'],
  journal_write: ['Написать статью', '/journal/write'],
  how: ['Как работает сделка', '/how-it-works'],
  rules: ['Правила', '/rules'],
  terms: ['Соглашение', '/terms'],
  privacy: ['Персональные данные', '/privacy'],
  contacts: ['Контакты', '/contacts'],
  complaint: ['Написать жалобу', '/complaint'],
} as const satisfies Record<string, readonly [string, string]>;

export type LinkKey = keyof typeof LINKS;
export const LINK_KEYS = Object.keys(LINKS) as [LinkKey, ...LinkKey[]];

export const linkButton = (key: LinkKey): Button => ({ id: `link:${key}`, label: LINKS[key][0], kind: 'link', path: LINKS[key][1] });

/** Up to four known links, two in a row; unknown keys are dropped. */
export function linkRows(keys: readonly string[] | undefined): Button[][] {
  const known = [...new Set(keys ?? [])].filter((k): k is LinkKey => k in LINKS).slice(0, 4).map(linkButton);
  const rows: Button[][] = [];
  for (let i = 0; i < known.length; i += 2) rows.push(known.slice(i, i + 2));
  return rows;
}
