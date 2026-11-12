import { z } from 'zod';
import { CITIES } from '../../catalog/catalog.js';
import { BundleTiersDto } from '../../listings/bundle.js';
import { BodyMeasurementsDto, SizesDto } from '../../listings/fit.js';
import { emailPrefsOf } from '../../mail/mail.module.js';
import { NOTIFY_GROUPS } from '../../mail/templates.js';
import { TG_CATEGORIES, tgPrefsOf } from '../../telegram/texts.js';
import { UpdateMeDto, type UpdateMe } from '../../users/users.service.js';
import { Refusal, type Tool, type ToolCtx } from '../types.js';

/**
 * Settings of the account. One tool, each part optional; what was there before is kept per part, so «Отменить»
 * puts back exactly the parts this change touched (and only if nobody changed them again since).
 */
const Args = z
  .object({
    city: z.enum(CITIES as [string, ...string[]]).nullable().optional(),
    bio: z.string().trim().max(160).nullable().optional().describe('описание профиля, со слов владельца'),
    sizes: SizesDto.optional().describe('мои размеры: clothing, shoes, jeans'),
    bodyMeasurements: BodyMeasurementsDto.optional().describe('мерки в см'),
    bundleDiscounts: BundleTiersDto.optional().describe('скидка за комплект, до 3 ступеней; пустой список — убрать'),
    cardStyle: z.enum(['minimal', 'detailed']).optional().describe('вид карточек вещей'),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    telegram: z
      .object(Object.fromEntries(TG_CATEGORIES.map((c) => [c, z.boolean().optional()])) as Record<(typeof TG_CATEGORIES)[number], z.ZodOptional<z.ZodBoolean>>)
      .strict()
      .optional()
      .describe('какие уведомления слать в Telegram: deals сделки, offers торг, auctions аукционы, chat сообщения, interest интерес к вещам, digest сводка, favorites избранное, account аккаунт'),
    emailOff: z.array(z.enum(NOTIFY_GROUPS)).optional().describe('группы писем продавцу, которые выключить (полный список выключенных)'),
  })
  .strict()
  .refine((a) => Object.values(a).some((v) => v !== undefined), 'Что поменять?');
type ArgsT = z.infer<typeof Args>;

const LABEL: Record<keyof ArgsT, string> = {
  city: 'город',
  bio: 'описание профиля',
  sizes: 'размеры',
  bodyMeasurements: 'мерки',
  bundleDiscounts: 'скидка за комплект',
  cardStyle: 'вид карточек',
  theme: 'тема',
  telegram: 'уведомления в Telegram',
  emailOff: 'письма',
};

/** The parts of the account this tool can touch, in the shape of its own arguments. */
async function state(ctx: ToolCtx) {
  const u = await ctx.prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { city: true, bio: true, sizes: true, bodyMeasurements: true, bundleDiscounts: true, uiPrefs: true, tgPrefs: true, emailPrefs: true, tgChatId: true, tgSessionVersion: true, sessionVersion: true },
  });
  const ui = (u.uiPrefs ?? {}) as { cardStyle?: string; theme?: string };
  return {
    linked: !!u.tgChatId && u.tgSessionVersion === u.sessionVersion,
    values: {
      city: u.city,
      bio: u.bio,
      sizes: u.sizes ?? {},
      bodyMeasurements: u.bodyMeasurements ?? {},
      bundleDiscounts: u.bundleDiscounts ?? [],
      cardStyle: ui.cardStyle ?? 'minimal',
      theme: ui.theme ?? 'system',
      telegram: tgPrefsOf(u.tgPrefs),
      emailOff: emailPrefsOf(u.emailPrefs).notifyOff ?? [],
    } as Record<keyof ArgsT, unknown>,
  };
}

async function apply(ctx: ToolCtx, a: Partial<Record<keyof ArgsT, unknown>>) {
  const { telegram, emailOff, cardStyle, theme, ...profile } = a;
  const dto: Record<string, unknown> = { ...profile };
  if (cardStyle !== undefined || theme !== undefined) dto.uiPrefs = { ...(cardStyle !== undefined ? { cardStyle } : {}), ...(theme !== undefined ? { theme } : {}) };
  if (emailOff !== undefined) dto.emailPrefs = { notifyOff: emailOff };
  if (Object.keys(dto).length) {
    const parsed = UpdateMeDto.safeParse(dto);
    if (!parsed.success) throw new Refusal(parsed.error.issues[0]?.message ?? 'Такое значение не подходит');
    await ctx.users.updateMe(ctx.userId, parsed.data as UpdateMe);
  }
  if (telegram !== undefined) {
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { tgPrefs: true } });
    await ctx.prisma.user.update({ where: { id: ctx.userId }, data: { tgPrefs: { ...tgPrefsOf(u.tgPrefs), ...(telegram as object) } } });
  }
}

interface Snap {
  set: Record<string, unknown>;
  before: Record<string, unknown>;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** For the parts merged into what is stored (Telegram switches): only the keys that were named. */
const part = (whole: unknown, keys: unknown) => (keys && typeof keys === 'object' && !Array.isArray(keys) && whole && typeof whole === 'object' ? Object.fromEntries(Object.keys(keys).map((k) => [k, (whole as Record<string, unknown>)[k]])) : whole);

export const accountSettings: Tool<ArgsT> = {
  name: 'account_settings',
  about: 'Изменить настройки аккаунта: город, описание профиля, размеры и мерки, скидку за комплект, вид карточек и тему, уведомления в Telegram и письма. Передавай только то, что просили поменять.',
  args: Args,
  kind: 'write',
  async run(ctx, given) {
    const { linked, values } = await state(ctx);
    // Sizes and measurements are stored whole: a part named in the chat («обувь 42») is added to what is there.
    const a: ArgsT = {
      ...given,
      ...(given.sizes ? { sizes: { ...(values.sizes as object), ...given.sizes } } : {}),
      ...(given.bodyMeasurements ? { bodyMeasurements: { ...(values.bodyMeasurements as object), ...given.bodyMeasurements } } : {}),
    };
    if (a.telegram && !linked) throw new Refusal('Telegram ещё не привязан к аккаунту — привяжите его в настройках, это делается одним нажатием.', ['settings_telegram']);
    const keys = (Object.keys(a) as Array<keyof ArgsT>).filter((k) => a[k] !== undefined && !eq(part(values[k], k === 'telegram' ? a[k] : null), a[k]));
    if (!keys.length) throw new Refusal('Там уже так настроено');
    const set = Object.fromEntries(keys.map((k) => [k, a[k]]));
    await apply(ctx, set);
    return {
      report: `Изменил в настройках: ${keys.map((k) => LABEL[k]).join(', ')}.`,
      snapshot: { set, before: Object.fromEntries(keys.map((k) => [k, part(values[k], k === 'telegram' ? a[k] : null)])) } satisfies Snap,
      links: ['settings'],
    };
  },
  async undo(ctx, raw) {
    const snap = raw as Snap;
    const { values } = await state(ctx);
    const keys = Object.keys(snap.set).filter((k) => eq(part(values[k as keyof ArgsT], k === 'telegram' ? snap.set[k] : null), snap.set[k]));
    if (!keys.length) return 'Эти настройки уже меняли после этого — оставил как есть.';
    await apply(ctx, Object.fromEntries(keys.map((k) => [k, snap.before[k]])));
    return `Вернул прежние настройки: ${keys.map((k) => LABEL[k as keyof ArgsT]).join(', ')}.`;
  },
};
