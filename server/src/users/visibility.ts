import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * An account the public may see: not hidden by an admin («Скрыть аккаунт» in the admin's user card, which hides the
 * listings and the profile together) and not deleted. A deleted account is only an anonymised `deleted_…` row kept for
 * the other side of its deals: it has no profile to show.
 */
export const PUBLIC_PROFILE = { listingsHiddenAt: null, deletedAt: null } satisfies Prisma.UserWhereInput;

/**
 * The account behind a profile address, or «no such wardrobe» when the public may not see it. Its owner still sees
 * it (their own wardrobe page reads the same endpoints), so hiding never breaks anything on their side.
 */
export async function visibleProfile(prisma: PrismaService, username: string, viewerId?: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true, listingsHiddenAt: true, deletedAt: true } });
  if (!user || (user.id !== viewerId && (user.listingsHiddenAt || user.deletedAt))) throw new NotFoundException({ message: 'Такого гардероба нет' });
  return { id: user.id };
}
