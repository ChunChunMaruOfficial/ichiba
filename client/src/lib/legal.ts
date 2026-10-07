/**
 * Operator details for the privacy policy, from client/.env.local or the Vercel project settings
 * (see .env.example). Requisites that are not set are left out of the text rather than shown as blanks.
 */
const env = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export const LEGAL = {
  /** ИП or organisation that runs the site (Закон № 99-З requires it to be named). */
  operator: env(process.env.NEXT_PUBLIC_LEGAL_OPERATOR),
  unp: env(process.env.NEXT_PUBLIC_LEGAL_UNP),
  address: env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
  email: env(process.env.NEXT_PUBLIC_LEGAL_EMAIL) ?? "c4erkaoui@gmail.com",
  /** Must match PRIVACY_VERSION in server/src/auth/auth.service.ts. */
  version: "2026-10-07",
  updated: "7 октября 2026 г.",
};

/** "ИП Иванов И. И., УНП 123456789, адрес: …" with whatever requisites are configured. */
export function operatorLine() {
  const parts = [LEGAL.operator ?? "владелец сайта ichiba", LEGAL.unp && `УНП ${LEGAL.unp}`, LEGAL.address && `адрес: ${LEGAL.address}`].filter(Boolean);
  return parts.join(", ");
}
