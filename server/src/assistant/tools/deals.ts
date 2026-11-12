import { z } from 'zod';
import { byn, clip } from '../my-listings.js';
import { Refusal, type Tool, type ToolCtx } from '../types.js';

/** Answers to buyers. All of them are final for the other side, so each waits for «Сделать». */
const deal = async (ctx: ToolCtx, id: string) => {
  const r = await ctx.prisma.buyRequest.findFirst({
    where: { id, sellerId: ctx.userId },
    select: { id: true, number: true, status: true, priceTotal: true, buyer: { select: { username: true } }, items: { select: { listing: { select: { title: true } } } } },
  });
  if (!r) throw new Refusal('Такой заявки среди ваших продаж нет');
  return { ...r, name: `№ ${r.number} от @${r.buyer.username}: ${r.items.map((i) => clip(i.listing.title, 30)).join(', ')} · ${byn(r.priceTotal)}` };
};

const RequestArgs = z
  .object({ id: z.uuid().describe('id заявки из pending'), accept: z.boolean(), reason: z.string().trim().max(300).optional().describe('причина отказа, со слов продавца') })
  .strict();
type RequestArgsT = z.infer<typeof RequestArgs>;

export const answerRequest: Tool<RequestArgsT> = {
  name: 'answer_request',
  about: 'Принять или отклонить заявку на покупку (как продавец). После принятия вещь резервируется за покупателем.',
  args: RequestArgs,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const r = await deal(ctx, a.id);
    if (r.status !== 'PENDING_SELLER') throw new Refusal('На эту заявку уже ответили');
    return a.accept
      ? `Принять заявку ${r.name}?\nВещь будет зарезервирована за покупателем, заявки остальных — отклонены.`
      : `Отклонить заявку ${r.name}?${a.reason ? `\nПричина: ${a.reason}` : ''}\nПокупатель получит отказ, вернуть заявку будет нельзя.`;
  },
  async run(ctx, a) {
    const r = await deal(ctx, a.id);
    if (a.accept) await ctx.requests.accept(ctx.userId, a.id);
    else await ctx.requests.decline(ctx.userId, a.id, a.reason);
    return { report: a.accept ? `Заявку ${r.name} принял. Дальше — передача вещи.` : `Заявку ${r.name} отклонил.`, links: ['sales'] };
  },
};

const HandArgs = z
  .object({ id: z.uuid().describe('id заявки'), trackingNumber: z.string().trim().min(4).max(40).optional().describe('трек-номер, если вещь отправлена службой доставки') })
  .strict();
type HandArgsT = z.infer<typeof HandArgs>;

export const handedOver: Tool<HandArgsT> = {
  name: 'handed_over',
  about: 'Отметить, что вещь передана покупателю или отправлена (с трек-номером, если есть).',
  args: HandArgs,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const r = await deal(ctx, a.id);
    if (r.status !== 'WAITING_HANDOVER') throw new Refusal('Эта сделка сейчас не ждёт передачи');
    return `Отметить, что вещь по заявке ${r.name} ${a.trackingNumber ? `отправлена, трек-номер ${a.trackingNumber}` : 'передана покупателю'}?\nПокупатель получит уведомление; отменить отметку нельзя.`;
  },
  async run(ctx, a) {
    const r = await deal(ctx, a.id);
    if (a.trackingNumber) await ctx.requests.setTracking(ctx.userId, a.id, a.trackingNumber);
    else await ctx.requests.handedOver(ctx.userId, a.id);
    return { report: `Готово: по заявке ${r.name} отмечено, что вещь ${a.trackingNumber ? 'отправлена' : 'передана'}. Сделка завершится, когда покупатель подтвердит получение, или сама через 7 дней.` };
  },
};

const OfferArgs = z
  .object({ id: z.uuid().describe('id предложения из pending'), action: z.enum(['accept', 'decline', 'counter']), amount: z.number().int().min(1).max(1_000_000).optional().describe('встречная цена для counter') })
  .strict()
  .refine((a) => a.action !== 'counter' || a.amount != null, 'Для встречной цены нужна сумма');
type OfferArgsT = z.infer<typeof OfferArgs>;

const offer = async (ctx: ToolCtx, id: string) => {
  const o = await ctx.prisma.offer.findFirst({
    where: { id, OR: [{ sellerId: ctx.userId }, { buyerId: ctx.userId }] },
    select: { amount: true, status: true, buyerId: true, buyer: { select: { username: true } }, seller: { select: { username: true } }, listing: { select: { title: true, price: true } } },
  });
  if (!o) throw new Refusal('Такого предложения у вас нет');
  const other = o.buyerId === ctx.userId ? o.seller.username : o.buyer.username;
  return { ...o, name: `@${other} по «${clip(o.listing.title, 30)}»: ${byn(o.amount)} при цене ${byn(o.listing.price)}` };
};

export const answerOffer: Tool<OfferArgsT> = {
  name: 'answer_offer',
  about: 'Ответить на предложение цены: принять, отклонить или назвать встречную цену.',
  args: OfferArgs,
  kind: 'confirm',
  preview: async (ctx, a) => {
    const o = await offer(ctx, a.id);
    if (o.status !== 'PENDING') throw new Refusal('На это предложение уже ответили');
    if (a.action === 'accept') return `Принять предложение ${o.name}?\nСоздастся сделка по этой цене, вещь будет зарезервирована.`;
    if (a.action === 'decline') return `Отклонить предложение ${o.name}?\nВернуть его будет нельзя.`;
    return `Ответить на предложение ${o.name} встречной ценой ${byn(a.amount)}?`;
  },
  async run(ctx, a) {
    const o = await offer(ctx, a.id);
    if (a.action === 'accept') await ctx.offers.accept(ctx.userId, a.id);
    else if (a.action === 'decline') await ctx.offers.decline(ctx.userId, a.id);
    else await ctx.offers.counter(ctx.userId, a.id, a.amount!);
    const did = a.action === 'accept' ? 'принял' : a.action === 'decline' ? 'отклонил' : `ответил встречной ценой ${byn(a.amount)}`;
    return { report: `Предложение ${o.name} — ${did}.`, links: a.action === 'accept' ? ['sales'] : [] };
  },
};
