/**
 * Operator details for the privacy policy. Fill them in apps/web/.env.local (see .env.example);
 * until then the policy shows highlighted placeholders so nothing ships with made-up legal data.
 */
const env = (v: string | undefined, placeholder: string) => (v && v.trim() ? v.trim() : placeholder);

export const LEGAL = {
  operator: env(process.env.NEXT_PUBLIC_LEGAL_OPERATOR, "[наименование оператора: ИП ФИО или название организации]"),
  unp: env(process.env.NEXT_PUBLIC_LEGAL_UNP, "[УНП]"),
  address: env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS, "[юридический адрес]"),
  email: env(process.env.NEXT_PUBLIC_LEGAL_EMAIL, "[почта для обращений по персональным данным]"),
  hosting: env(process.env.NEXT_PUBLIC_LEGAL_HOSTING, "[хостинг-провайдер и страна размещения серверов]"),
  /** Must match PRIVACY_VERSION in apps/api/src/auth/auth.service.ts. */
  version: "2026-10-05",
  updated: "5 октября 2026 г.",
};

export const isPlaceholder = (v: string) => v.startsWith("[");
