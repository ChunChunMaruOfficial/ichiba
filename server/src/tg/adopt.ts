import type { Prisma } from '../generated/prisma/client.js';

/**
 * Whether an importer (Telegram channels, brand web shops, hand-listed batches) may treat an existing account with
 * its configured nick as its own: list items under it and set the configured password on it.
 *
 * Importers find their account by nick, and a nick can be taken by anyone. A person's account always has a way to
 * sign in other than a password (email, phone, Google, Apple or Telegram), so an account with any of those is never
 * touched; nor is a deleted one. And the account must carry an importer's mark: a Telegram or shop source attached
 * to it, or the importer's creation fingerprint — consent and onboarding stamped in the same instant the row was
 * made, which only the importers' own `user.create` does (a person consents and onboards on separate screens).
 */
export const ADOPT_SELECT = {
  email: true,
  phone: true,
  googleSub: true,
  appleSub: true,
  telegramId: true,
  deletedAt: true,
  createdAt: true,
  privacyAcceptedAt: true,
  onboardedAt: true,
  _count: { select: { tgSources: true, shopSources: true } },
} satisfies Prisma.UserSelect;

export type AdoptCandidate = Prisma.UserGetPayload<{ select: typeof ADOPT_SELECT }>;

/** The importers set both stamps with `new Date()` in the create call; the database stamps createdAt itself. */
const SAME_INSTANT_MS = 10_000;
const near = (a: Date | null, b: Date) => !!a && Math.abs(a.getTime() - b.getTime()) <= SAME_INSTANT_MS;

export function importerMayAdopt(u: AdoptCandidate): boolean {
  if (u.email || u.phone || u.googleSub || u.appleSub || u.telegramId || u.deletedAt) return false;
  if (u._count.tgSources > 0 || u._count.shopSources > 0) return true;
  return near(u.privacyAcceptedAt, u.createdAt) && near(u.onboardedAt, u.createdAt);
}
