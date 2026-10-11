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
