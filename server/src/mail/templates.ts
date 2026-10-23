/**
 * Email templates: table-based HTML with inline styles (works in Gmail, Outlook, Яндекс, Mail.ru) plus a
 * plain-text part. Every user-provided string is escaped.
 */

export const appUrl = () => (process.env.APP_URL || process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// The site's washi palette (client globals.css): paper, ink, and the cinnabar of the seals.
const INK = '#1c1a17';
const INK_2 = '#48433b';
const PAPER = '#f4efe6';
const SURFACE = '#fbf8f2';
const SUNK = '#ece5d8';
const LINE = '#e2d9c9';
const SHU = '#c8102e';
const MUTED = '#8a8276';
const SERIF = "Georgia,'Noto Serif','Times New Roman',serif";

export interface EmailContent {
  subject: string;
  /** Short text shown by mail clients next to the subject. */
  preheader: string;
  title: string;
  /** Paragraphs (plain text; escaped on render). */
  lines: string[];
  cta?: { label: string; url: string };
  /** Shown in the footer of notification emails. */
  unsubscribeUrl?: string;
  /** Large code block for verification emails. */
  code?: string;
}

export function render(c: EmailContent): { subject: string; html: string; text: string } {
  const paragraphs = c.lines.map((l) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${INK_2}">${esc(l)}</p>`).join('');
  const code = c.code
    ? `<div style="margin:6px 0 22px;padding:20px 0;border-radius:16px;background:${SUNK};text-align:center;font-size:34px;letter-spacing:12px;font-weight:700;color:${INK};font-family:'SFMono-Regular',Menlo,Consolas,monospace">${esc(c.code)}</div>`
    : '';
  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 4px"><tr><td style="border-radius:999px;background:${INK}"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${SURFACE};text-decoration:none;border-radius:999px;font-family:${SERIF}">${esc(c.cta.label)}</a></td></tr></table>`
    : '';
  const footer = [
    'Это автоматическое письмо от ichiba — маркетплейса вещей из открытых гардеробов. Отвечать на него не нужно.',
    c.unsubscribeUrl ? `<a href="${esc(c.unsubscribeUrl)}" style="color:${MUTED}">Отписаться от писем</a> · <a href="${esc(appUrl())}/settings#notify" style="color:${MUTED}">Настройки</a>` : '',
  ]
    .filter(Boolean)
    .join('<br>');

  // The wordmark as text (mail clients drop SVG): «ichiba» in the serif, with a cinnabar seal beside it.
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${SERIF}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 8px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:24px;font-weight:700;letter-spacing:.5px;color:${INK};font-family:${SERIF}">ichiba</td>
      <td style="padding-left:9px"><div style="width:11px;height:11px;border-radius:50%;background:${SHU}"></div></td>
    </tr></table></td></tr>
    <tr><td style="background:${SURFACE};border:1px solid ${LINE};border-radius:22px;padding:30px 28px">
      <div style="width:32px;height:3px;border-radius:2px;background:${SHU};margin:0 0 18px"></div>
      <h1style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:${INK};font-family:${SERIF}">${esc(c.title)}</h1>
      ${code}${paragraphs}${cta}
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${MUTED};font-family:${SERIF}">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    c.title,
    '',
    ...(c.code ? [`Код: ${c.code}`, ''] : []),
    ...c.lines,
    ...(c.cta ? ['', `${c.cta.label}: ${c.cta.url}`] : []),
    '',
    '—',
    'ichiba · это автоматическое письмо, отвечать на него не нужно.',
    ...(c.unsubscribeUrl ? [`Отписаться от писем: ${c.unsubscribeUrl}`] : []),
  ].join('\n');

  return { subject: c.subject, html, text };
}

// ---------- verification codes ----------

const CODE_COPY: Record<string, { subject: string; title: string; line: string }> = {
  VERIFY: { subject: 'Код подтверждения ichiba', title: 'Подтвердите почту', line: 'Введите этот код на сайте, чтобы закончить регистрацию.' },
  RESET: { subject: 'Сброс пароля ichiba', title: 'Сброс пароля', line: 'Введите этот код, чтобы задать новый пароль.' },
  LOGIN: { subject: 'Код для входа в ichiba', title: 'Вход по коду', line: 'Введите этот код, чтобы войти.' },
  NOTIFY: { subject: 'Почта для уведомлений ichiba', title: 'Подтвердите почту', line: 'Введите этот код в настройках ichiba — и сюда будут приходить письма о покупках, предложениях цены и отзывах.' },
};

export function codeEmail(code: string, purpose: string, ttlMinutes = 10) {
  const copy = CODE_COPY[purpose] ?? CODE_COPY.VERIFY;
  return render({
    subject: `${code} — ${copy.subject}`,
    preheader: `${copy.line} Код действует ${ttlMinutes} минут.`,
    title: copy.title,
    code,
    lines: [copy.line, `Код действует ${ttlMinutes} минут. Если вы ничего не запрашивали — просто проигнорируйте письмо.`],
  });
}

// ---------- notifications to a seller's bound address ----------

type Payload = Record<string, unknown>;
const price = (n: unknown) => (typeof n === 'number' ? `${n.toLocaleString('ru-RU')} BYN` : '');
const nick = (u: unknown, fallback: string) => (u ? `@${String(u)}` : fallback);
const stars = (n: unknown) => '★'.repeat(Math.min(5, Math.max(0, Number(n) || 0)));

/**
 * Notifications worth an email: someone wants to buy, a deal moves, a price is agreed, a review or a dispute, a
 * moderator's or admin's decision. The rest (price drops, every new bid, followed sellers) stays on the site.
 */
export const NOTIFY_EMAIL_TYPES = new Set([
  'request_new',
  'request_accepted',
  'request_declined',
  'request_cancelled',
  'request_expired',
  'deal_handed_over',
  'deal_in_transit',
  'deal_completed',
  'offer_new',
  'offer_countered',
  'offer_accepted',
  'offer_auto_accepted',
  'auction_won',
  'auction_runner_up',
  'auction_sold',
  'auction_bought_out',
  'auction_no_sale',
  'review_new',
  'dispute_opened',
  'dispute_resolved',
  'listing_blocked',
  'brand_approved',
  'brand_rejected',
  'catalog_approved',
  'catalog_rejected',
]);

/** The email for one notification (links match notificationHref on the client), or null for a type not emailed. */
export function notificationEmail(type: string, p: Payload, unsubscribeUrl: string): ReturnType<typeof render> | null {
  const title = String(p.title ?? 'вещь');
  const url = (path: string) => `${appUrl()}${path}`;
  const deal = p.requestId ? url(`/deals/${String(p.requestId)}`) : url('/sales');
  const item = p.listingId ? url(`/item/${String(p.listingId)}`) : deal;
  const pick = p.requestId && p.listingId ? url(`/buy/${String(p.listingId)}?request=${String(p.requestId)}`) : deal;
  const side = p.by === 'buyer' ? 'Покупатель' : 'Продавец';
  const mail = (subject: string, preheader: string, heading: string, lines: Array<string | false>, cta: [string, string]) =>
    render({ subject, preheader, title: heading, lines: lines.filter((l): l is string => !!l), cta: { label: cta[0], url: cta[1] }, unsubscribeUrl });
  switch (type) {
    case 'request_new':
      return mail(`Хотят купить «${title}»`, `${nick(p.buyer, 'Покупатель')} хочет купить «${title}»`, 'Новый запрос на покупку', [`${nick(p.buyer, 'Покупатель')} хочет купить «${title}»${p.price ? ` за ${price(p.price)}` : ''}.`, 'Ответьте в течение 48 часов — иначе запрос отменится сам.'], ['Ответить на запрос', deal]);
    case 'request_accepted':
      return p.confirmed
        ? mail(`Сделка подтверждена: ${title}`, `${nick(p.buyer, 'Покупатель')} выбрал способ получения`, 'Покупатель подтвердил сделку', [`${nick(p.buyer, 'Покупатель')} выбрал способ получения «${title}». Контакты открыты — договоритесь о передаче.`], ['Открыть сделку', deal])
        : mail(`Продавец подтвердил: ${title}`, `${nick(p.seller, 'Продавец')} готов продать «${title}»`, 'Продавец подтвердил покупку', [`${nick(p.seller, 'Продавец')} подтвердил запрос на «${title}». Вещь зарезервирована за вами.`], ['Открыть сделку', deal]);
    case 'request_declined':
      return mail(`Запрос отклонён: ${title}`, 'Продавец не может продать вещь', 'Продавец отклонил запрос', [`Продавец не может продать «${title}».`, !!p.reason && `Причина: ${String(p.reason)}`], ['Смотреть вещь', item]);
    case 'request_cancelled':
      return mail(`Сделка отменена: ${title}`, `${side} отменил сделку`, 'Сделка отменена', [`${side} отменил сделку по «${title}».`, !!p.reason && `Причина: ${String(p.reason)}`], ['Подробнее', deal]);
    case 'request_expired':
      return mail(`Запрос отменён: ${title}`, 'Срок ответа закончился', 'Запрос отменён', [`Запрос на «${title}» отменён${p.reason ? `: ${String(p.reason).toLowerCase()}` : ' — не было ответа 48 часов'}.`], ['Подробнее', deal]);
    case 'deal_handed_over':
      return mail(`Вещь передана: ${title}`, 'Подтвердите получение', 'Продавец отметил передачу', [`Продавец отметил, что передал «${title}».`, 'Когда вещь у вас — подтвердите получение. Если ничего не сделать, сделка завершится сама через 7 дней.'], ['Подтвердить получение', deal]);
    case 'deal_in_transit':
      return mail(`Вещь отправлена: ${title}`, p.trackingNumber ? `Трек-номер ${String(p.trackingNumber)}` : 'Посылка в пути', 'Посылка в пути', [`Продавец отправил «${title}».`, !!p.trackingNumber && `Трек-номер: ${String(p.trackingNumber)}`], ['Открыть сделку', deal]);
    case 'deal_completed':
      return mail(`Сделка завершена: ${title}`, 'Покупатель получил вещь', 'Сделка завершена', [`Сделка по «${title}» завершена. Спасибо, что продаёте на ichiba!`, Array.isArray(p.sizes) && p.sizes.length > 0 && `Продан размер ${p.sizes.join(', ')} — уберите его из наличия.`], ['Открыть сделку', deal]);
    case 'offer_new':
      return mail(`Предложение цены: ${title}`, `${nick(p.buyer, 'Покупатель')} предлагает ${price(p.amount)}`, 'Новое предложение цены', [`${nick(p.buyer, 'Покупатель')} предлагает ${price(p.amount)} за «${title}»${typeof p.price === 'number' ? ` вместо ${price(p.price)}` : ''}.`, 'Примите, отклоните или назовите свою цену — у предложения 48 часов.'], ['Ответить', url('/sales')]);
    case 'offer_countered':
      return mail(`Встречное предложение: ${title}`, `${nick(p.by, 'Собеседник')} предлагает ${price(p.amount)}`, 'Встречное предложение', [`${nick(p.by, 'Собеседник')} предлагает ${price(p.amount)} за «${title}».`], ['Ответить', item]);
    case 'offer_accepted':
      return mail(`Цена согласована: ${title}`, `${price(p.amount)} — предложение принято`, 'Предложение принято', [`Цена ${price(p.amount)} за «${title}» согласована, вещь зарезервирована.`], ['Открыть сделку', deal]);
    case 'offer_auto_accepted':
      return mail(`Предложение принято: ${title}`, `${nick(p.buyer, 'Покупатель')} — ${price(p.amount)}`, 'Предложение принято автоматически', [`Предложение ${nick(p.buyer, 'покупателя')} ${price(p.amount)} за «${title}» принято автоматически — сделка открыта.`], ['Открыть сделку', deal]);
    case 'auction_won':
      return mail(`Вещь ваша: ${title}`, `${price(p.amount)} — выберите способ получения`, p.buyNow ? 'Вы выкупили вещь' : 'Вы выиграли аукцион', [`«${title}» ваша за ${price(p.amount)}.`, 'Выберите способ получения в течение 48 часов.'], ['Выбрать способ получения', pick]);
    case 'auction_runner_up':
      return mail(`Вещь досталась вам: ${title}`, 'Победитель не выкупил вещь', 'Вещь предлагают вам', [`Победитель аукциона не выкупил «${title}». Вещь ваша по вашей ставке ${price(p.amount)}.`, 'Выберите способ получения в течение 48 часов.'], ['Выбрать способ получения', pick]);
    case 'auction_sold':
      return mail(`Продано: ${title}`, `Продано за ${price(p.amount)}`, p.buyNow ? 'Вещь выкупили' : 'Аукцион завершён', [`«${title}» продано за ${price(p.amount)}${p.runnerUp ? ' участнику со вторым местом' : ''}. Ждём, когда покупатель выберет способ получения.`], ['Открыть сделку', deal]);
    case 'auction_bought_out':
      return mail(`Выкупили: ${title}`, `По цене «Купить сейчас» — ${price(p.amount)}`, 'Аукцион завершён', [`«${title}» выкупили по цене «Купить сейчас» (${price(p.amount)}).`], ['Смотреть вещь', item]);
    case 'auction_no_sale':
      return mail(`Аукцион без продажи: ${title}`, 'Вещь осталась в продаже', 'Аукцион завершён без продажи', [p.reason === 'reserve' ? `Резервная цена на «${title}» не достигнута.` : `На «${title}» не было ставок — вещь осталась в продаже.`], ['Смотреть вещь', item]);
    case 'review_new':
      return mail(`Новый отзыв ${stars(p.rating)}`, `${nick(p.buyer, 'Покупатель')} оставил отзыв`, 'Новый отзыв', [`${nick(p.buyer, 'Покупатель')} оставил отзыв ${stars(p.rating)}${p.title ? ` о «${title}»` : ''}.`, 'Ответьте на него — покупатели читают ответы продавцов.'], ['Открыть отзыв', p.requestId ? url(`/deals/${String(p.requestId)}#review`) : url('/wardrobe?tab=reviews')]);
    case 'dispute_opened':
      return mail(`Открыт спор: ${title}`, 'Сделка заморожена до решения администратора', 'Открыт спор', [`${side} открыл спор по «${title}»${p.reason ? `: ${String(p.reason)}` : ''}.`, 'Сделка заморожена до решения администратора. Опишите свою сторону в переписке.'], ['Открыть сделку', deal]);
    case 'dispute_resolved':
      return mail(`Спор решён: ${title}`, p.outcome === 'complete' ? 'Сделка завершена' : 'Сделка отменена', 'Спор решён', [`Спор по «${title}» решён: ${p.outcome === 'complete' ? 'сделка завершена' : 'сделка отменена'}.`, !!p.reason && `Комментарий администратора: ${String(p.reason)}`], ['Открыть сделку', deal]);
    case 'listing_blocked':
      return mail(`Вещь снята модератором: ${title}`, 'Объявление скрыто', 'Вещь снята модератором', [`«${title}» снята с публикации${p.reason ? `: ${String(p.reason)}` : ''}.`, 'Исправьте объявление — после правки его проверят снова.'], ['Открыть вещь', item]);
    case 'brand_approved':
      return mail('Статус бренда подтверждён', `«${String(p.brand)}» — печать «Бренд» уже на ваших вещах`, 'Статус бренда подтверждён', [`Статус бренда «${String(p.brand)}» подтверждён — печать «Бренд» уже стоит на ваших вещах и в профиле.`], ['Открыть настройки', url('/settings#brand')]);
    case 'brand_rejected':
      return mail('Заявка на статус бренда отклонена', 'Можно подать заново', 'Заявка отклонена', [`Заявка на статус бренда «${String(p.brand)}» отклонена.`, !!p.note && `Причина: ${String(p.note)}`], ['Подать заново', url('/settings#brand')]);
    case 'catalog_approved':
      return mail('Вас допустили в основной каталог', 'Новые вещи с биркой — в каталоге', 'Вы в основном каталоге', ['Новые вещи с биркой теперь показываются в основном каталоге, поношенные — на вторичке.'], ['Выставить вещь', url('/sell')]);
    case 'catalog_rejected':
      return mail('Заявка в каталог отклонена', 'Можно подать заново', 'Заявка отклонена', ['Заявка на размещение в основном каталоге отклонена.', !!p.note && `Причина: ${String(p.note)}`], ['Открыть настройки', url('/settings#brand')]);
    default:
      return null;
  }
}
