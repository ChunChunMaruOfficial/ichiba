import { z } from 'zod';
import { byn, clip, findMyListings, lines, ListingFilter, things, type MyListing } from '../my-listings.js';
import { Refusal, type Tool } from '../types.js';
import { capNote, current, each, edit, failedNote, none, why } from './shared.js';

const price = z.number().int().min(1).max(100_000).nullable();

const BargainArgs = z
  .object({
    filter: ListingFilter,
    acceptsOffers: z.boolean().optional().describe('принимать ли предложения цены (торг)'),
    minOfferPrice: price.optional().describe('предложения ниже отклоняются сами; null — убрать порог'),
    autoAcceptPrice: price.optional().describe('предложения от этой цены принимаются сами; null — убрать'),
  })
  .strict()
  .refine((a) => a.acceptsOffers !== undefined || a.minOfferPrice !== undefined || a.autoAcceptPrice !== undefined, 'Что поменять в торге?');
type BargainArgsT = z.infer<typeof BargainArgs>;

type Terms = Pick<MyListing, 'acceptsOffers' | 'minOfferPrice' | 'autoAcceptPrice'>;
interface BargainSnap {
  set: Partial<Terms>;
  items: Array<{ id: string; title: string; before: Terms }>;
}
const same = (l: Terms, set: Partial<Terms>) => (Object.keys(set) as Array<keyof Terms>).every((k) => l[k] === set[k]);
const words = (set: Partial<Terms>) =>
  [
    set.acceptsOffers === undefined ? '' : set.acceptsOffers ? 'торг включён' : 'торг выключен',
    set.minOfferPrice === undefined ? '' : set.minOfferPrice === null ? 'порог автоотказа убран' : `предложения ниже ${byn(set.minOfferPrice)} отклоняются сами`,
    set.autoAcceptPrice === undefined ? '' : set.autoAcceptPrice === null ? 'автопринятие убрано' : `предложения от ${byn(set.autoAcceptPrice)} принимаются сами`,
  ]
    .filter(Boolean)
    .join(', ');

export const setBargaining: Tool<BargainArgsT> = {
  name: 'set_bargaining',
  about: 'Настроить торг у своих вещей: включить или выключить предложения цены, порог автоотказа, цену автопринятия.',
  args: BargainArgs,
  kind: 'write',
  async run(ctx, { filter, ...rest }) {
    const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<Terms>;
    const { items, total } = await findMyListings(ctx.prisma, ctx.userId, filter);
    const todo = items.filter((l) => !same(l, set));
    if (!todo.length) throw items.length ? new Refusal('У этих вещей торг уже настроен так') : none();
    const { done, failed } = await each<MyListing, unknown>(todo, (l) => edit(ctx, l.id, { ...set, ...(set.minOfferPrice != null ? { price: l.price } : {}) }));
    if (!done.length) throw new Refusal(`Не получилось.${failedNote(failed)}`);
    return {
      report: `Готово, ${things(done.length)}: ${words(set)}.\n${lines(done.map(({ item }) => clip(item.title)))}${failedNote(failed)}${capNote(total, items.length)}`,
      snapshot: { set, items: done.map(({ item }) => ({ id: item.id, title: item.title, before: { acceptsOffers: item.acceptsOffers, minOfferPrice: item.minOfferPrice, autoAcceptPrice: item.autoAcceptPrice } })) } satisfies BargainSnap,
    };
  },
  async undo(ctx, raw) {
    const snap = raw as BargainSnap;
    const keys = Object.keys(snap.set) as Array<keyof Terms>;
    const still: BargainSnap['items'] = [];
    for (const it of snap.items) {
      const l = await current(ctx, it.id);
      if (l && same(l, snap.set)) still.push(it);
    }
    const { done, failed } = await each(still, (it) => edit(ctx, it.id, Object.fromEntries(keys.map((k) => [k, it.before[k]]))));
    return `Вернул прежние настройки торга: ${things(done.length)}.${failedNote(failed)}`;
  },
};

const TextArgs = z
  .object({
    id: z.uuid().describe('id вещи из my_listings'),
    title: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(2000).optional(),
    condition: z.enum(['NEW_WITH_TAGS', 'LIKE_NEW', 'GOOD', 'VISIBLE_WEAR']).optional(),
  })
  .strict()
  .refine((a) => a.title !== undefined || a.description !== undefined || a.condition !== undefined, 'Что поменять?');
type TextArgsT = z.infer<typeof TextArgs>;
type TextFields = Partial<Pick<TextArgsT, 'title' | 'description' | 'condition'>>;
interface TextSnap {
  id: string;
  title: string;
  set: TextFields;
  before: Record<string, string | null>;
}
const LABEL: Record<string, string> = { title: 'название', description: 'описание', condition: 'состояние' };

export const editListing: Tool<TextArgsT> = {
  name: 'edit_listing',
  about: 'Изменить название, описание или состояние ОДНОЙ своей вещи (сначала найди её id через my_listings). Новый текст проходит проверку модерации. Текст пиши только со слов владельца.',
  args: TextArgs,
  kind: 'write',
  async run(ctx, { id, ...set }) {
    const l = await current(ctx, id);
    if (!l) throw none('Такой вещи у вас нет');
    const keys = (Object.keys(set) as Array<keyof TextFields>).filter((k) => set[k] !== undefined && set[k] !== l[k]);
    if (!keys.length) throw new Refusal('Там уже так написано');
    try {
      await edit(ctx, id, Object.fromEntries(keys.map((k) => [k, set[k]])));
    } catch (e) {
      throw new Refusal(why(e));
    }
    return {
      report: `Изменил у «${clip(l.title)}»: ${keys.map((k) => LABEL[k]).join(', ')}.`,
      snapshot: { id, title: l.title, set: Object.fromEntries(keys.map((k) => [k, set[k]])), before: Object.fromEntries(keys.map((k) => [k, l[k] as string | null])) } satisfies TextSnap,
    };
  },
  async undo(ctx, raw) {
    const snap = raw as TextSnap;
    const l = await current(ctx, snap.id);
    const keys = Object.keys(snap.set).filter((k) => l && (l as unknown as Record<string, unknown>)[k] === (snap.set as Record<string, unknown>)[k]);
    if (!l || !keys.length) return 'Вещь уже меняли после этого — оставил как есть.';
    await edit(ctx, snap.id, Object.fromEntries(keys.map((k) => [k, snap.before[k]])));
    return `Вернул прежнее у «${clip(snap.title)}»: ${keys.map((k) => LABEL[k]).join(', ')}.`;
  },
};
