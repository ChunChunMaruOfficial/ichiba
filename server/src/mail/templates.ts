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

const INK = '#1e2433';
const PAPER = '#eeefec';
const MUTED = '#6b7080';

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
  const paragraphs = c.lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK}">${esc(l)}</p>`).join('');
  const code = c.code
    ? `<div style="margin:8px 0 20px;padding:18px 0;border-radius:14px;background:${PAPER};text-align:center;font-size:32px;letter-spacing:10px;font-weight:700;color:${INK};font-family:'SFMono-Regular',Menlo,Consolas,monospace">${esc(c.code)}</div>`
    : '';
  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="border-radius:12px;background:${INK}"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px">${esc(c.cta.label)}</a></td></tr></table>`
    : '';
  const footer = [
    'Это автоматическое письмо от ichiba — маркетплейса вещей из открытых гардеробов. Отвечать на него не нужно.',
    c.unsubscribeUrl ? `<a href="${esc(c.unsubscribeUrl)}" style="color:${MUTED}">Отписаться от писем о сделках</a> · <a href="${esc(appUrl())}/settings" style="color:${MUTED}">Настройки</a>` : '',
  ]
    .filter(Boolean)
    .join('<br>');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 16px;font-size:20px;font-weight:700;color:${INK}">ichiba</td></tr>
    <tr><td style="background:#ffffff;border-radius:20px;padding:28px 26px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK}">${esc(c.title)}</h1>
      ${code}${paragraphs}${cta}
    </td></tr>
    <tr><td style="padding:18px 6px 0;font-size:12px;line-height:1.6;color:${MUTED}">${footer}</td></tr>
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
    ...(c.unsubscribeUrl ? [`Отписаться от писем о сделках: ${c.unsubscribeUrl}`] : []),
  ].join('\n');

  return { subject: c.subject, html, text };
}

// ---------- verification codes ----------

const CODE_COPY: Record<string, { subject: string; title: string; line: string }> = {
  VERIFY: { subject: 'Код подтверждения ichiba', title: 'Подтвердите почту', line: 'Введите этот код на сайте, чтобы закончить регистрацию.' },
  RESET: { subject: 'Сброс пароля ichiba', title: 'Сброс пароля', line: 'Введите этот код, чтобы задать новый пароль.' },
  LOGIN: { subject: 'Код для входа в ichiba', title: 'Вход по коду', line: 'Введите этот код, чтобы войти.' },
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

// ---------- deal notifications ----------

type Payload = Record<string, unknown>;
const price = (n: unknown) => (typeof n === 'number' ? `${n.toLocaleString('ru-RU')} BYN` : '');

/** Notification types that are also sent by email (decision: only deals and codes). */
export const DEAL_EMAIL_TYPES = new Set([
  'request_new',
  'request_accepted',
  'request_declined',
  'request_cancelled',
  'request_expired',
  'deal_handed_over',
  'deal_in_transit',
  'deal_completed',
  'offer_accepted',
  'auction_won',
  'auction_runner_up',
  'auction_sold',
]);

export function dealEmail(type: string, p: Payload, unsubscribeUrl: string): ReturnType<typeof render> | null {
  const title = String(p.title ?? 'вещь');
  const deal = p.requestId ? `${appUrl()}/deals/${p.requestId}` : `${appUrl()}/purchases`;
  const item = p.listingId ? `${appUrl()}/item/${p.listingId}` : deal;
  const pick = (byRole: string) => (p.requestId ? `${appUrl()}/buy/${p.listingId}?request=${p.requestId}` : byRole);
  const base = { unsubscribeUrl };
  switch (type) {
    case 'request_new':
      return render({ ...base, subject: `Новый запрос на покупку: ${title}`, preheader: `@${p.buyer} хочет купить «${title}»`, title: 'Новый запрос на покупку', lines: [`@${p.buyer} хочет купить «${title}»${p.price ? ` за ${price(p.price)}` : ''}.`, 'Ответьте в течение 48 часов — иначе запрос отменится автоматически.'], cta: { label: 'Ответить на запрос', url: deal } });
    case 'request_accepted':
      return p.confirmed
        ? render({ ...base, subject: `Покупатель выбрал способ получения: ${title}`, preheader: `@${p.buyer} подтвердил сделку`, title: 'Сделка подтверждена', lines: [`@${p.buyer} выбрал способ получения для «${title}». Контакты открыты — договоритесь о передаче.`], cta: { label: 'Открыть переписку', url: deal } })
        : render({ ...base, subject: `Продавец подтвердил: ${title}`, preheader: `@${p.seller} готов продать «${title}»`, title: 'Продавец подтвердил покупку', lines: [`@${p.seller} подтвердил запрос на «${title}». Вещь зарезервирована за вами.`, 'Контакты продавца уже открыты — договоритесь о передаче в переписке.'], cta: { label: 'Открыть переписку', url: deal } });
    case 'request_declined':
      return render({ ...base, subject: `Запрос отклонён: ${title}`, preheader: 'Продавец не может продать вещь', title: 'Продавец отклонил запрос', lines: [`К сожалению, продавец не может продать «${title}».`, ...(p.reason ? [`Причина: ${p.reason}`] : []), 'Посмотрите похожие вещи — их часто выставляют снова.'], cta: { label: 'Смотреть похожие', url: item } });
    case 'request_cancelled':
      return render({ ...base, subject: `Сделка отменена: ${title}`, preheader: p.by === 'buyer' ? 'Покупатель отменил сделку' : 'Продавец отменил сделку', title: 'Сделка отменена', lines: [`${p.by === 'buyer' ? 'Покупатель' : 'Продавец'} отменил сделку по «${title}».`, ...(p.reason ? [`Причина: ${p.reason}`] : [])], cta: { label: 'Подробнее', url: deal } });
    case 'request_expired':
      return render({ ...base, subject: `Запрос истёк: ${title}`, preheader: 'Срок ответа закончился', title: 'Запрос отменён по сроку', lines: [`Запрос на «${title}» отменён: истёк срок ответа.`], cta: { label: 'Подробнее', url: deal } });
    case 'deal_handed_over':
      return render({ ...base, subject: `Вещь передана: ${title}`, preheader: 'Подтвердите получение', title: 'Продавец отметил передачу', lines: [`Продавец отметил, что передал «${title}».`, 'Когда вещь у вас — нажмите «Я получил вещь». Если ничего не сделать, сделка завершится сама через 7 дней.'], cta: { label: 'Подтвердить получение', url: deal } });
    case 'deal_in_transit':
      return render({ ...base, subject: `Вещь отправлена: ${title}`, preheader: p.trackingNumber ? `Трек-номер ${p.trackingNumber}` : 'Посылка в пути', title: 'Посылка в пути', lines: [`Продавец отправил «${title}».`, ...(p.trackingNumber ? [`Трек-номер: ${p.trackingNumber}`] : []), 'Когда получите — подтвердите получение в переписке с продавцом.'], cta: { label: 'Открыть переписку', url: deal } });
    case 'deal_completed':
      return render({ ...base, subject: `Сделка завершена: ${title}`, preheader: 'Покупатель подтвердил получение', title: 'Сделка завершена', lines: [`Покупатель получил «${title}». Спасибо, что продаёте на ichiba!`], cta: { label: 'Открыть переписку', url: deal } });
    case 'offer_accepted':
      return render({ ...base, subject: `Цена согласована: ${title}`, preheader: `${price(p.amount)} — предложение принято`, title: 'Предложение принято', lines: [`Цена ${price(p.amount)} за «${title}» согласована, вещь зарезервирована.`, 'Выберите способ получения в течение 48 часов.'], cta: { label: 'Выбрать способ получения', url: pick(deal) } });
    case 'auction_won':
      return render({ ...base, subject: `Вы выиграли аукцион: ${title}`, preheader: `Ваша ставка ${price(p.amount)} победила`, title: 'Вы выиграли аукцион', lines: [`Ваша ставка ${price(p.amount)} за «${title}» победила.`, 'Выберите способ получения в течение 48 часов — иначе вещь предложат следующему участнику.'], cta: { label: 'Выбрать способ получения', url: pick(deal) } });
    case 'auction_runner_up':
      return render({ ...base, subject: `Вещь досталась вам: ${title}`, preheader: 'Победитель не выкупил вещь', title: 'Вещь предлагают вам', lines: [`Победитель аукциона не выкупил «${title}». Вещь ваша по вашей ставке ${price(p.amount)}.`, 'Выберите способ получения в течение 48 часов.'], cta: { label: 'Выбрать способ получения', url: pick(deal) } });
    case 'auction_sold':
      return render({ ...base, subject: `Аукцион завершён: ${title}`, preheader: `Продано за ${price(p.amount)}`, title: 'Аукцион завершён', lines: [`«${title}» продано за ${price(p.amount)}${p.runnerUp ? ' участнику со вторым местом' : ''}. Ждём, когда покупатель выберет способ получения.`], cta: { label: 'Открыть переписку', url: deal } });
    default:
      return null;
  }
}
