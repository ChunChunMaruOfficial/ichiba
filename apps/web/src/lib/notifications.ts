export interface NotificationRow {
  id: string;
  type: string;
  payload: {
    title?: string;
    price?: number;
    amount?: number;
    buyer?: string;
    seller?: string;
    by?: string;
    reason?: string;
    bidder?: string;
    runnerUp?: boolean;
    requestId?: string;
    listingId?: string;
    offerId?: string;
    newPrice?: number;
    oldPrice?: number;
    trackingNumber?: string;
    auto?: boolean;
    confirmed?: boolean;
  };
  readAt: string | null;
  createdAt: string;
}

/** Human text for every notification type (frame 15). */
export const NOTIFICATION_TEXT: Record<string, (p: NotificationRow["payload"]) => string> = {
  request_new: (p) => `@${p.buyer} хочет купить «${p.title}» за ${p.price} BYN`,
  request_accepted: (p) => (p.confirmed ? `@${p.buyer} выбрал способ получения «${p.title}» — договоритесь о передаче` : `@${p.seller} подтвердил запрос на «${p.title}»`),
  request_declined: (p) => `Продавец отклонил запрос на «${p.title}»${p.reason ? `: ${p.reason.toLowerCase()}` : ""}`,
  request_cancelled: (p) => `Сделка по «${p.title}» отменена`,
  request_expired: (p) => `Запрос на «${p.title}» отменён — не было ответа 48 часов`,
  deal_handed_over: (p) => `Продавец отметил «${p.title}» как переданную — подтвердите получение`,
  deal_in_transit: (p) => `«${p.title}» в пути${p.trackingNumber ? `, трек ${p.trackingNumber}` : ""}`,
  deal_completed: (p) => `Сделка по «${p.title}» завершена`,
  price_drop: (p) => `Цена снижена: «${p.title}» — ${p.newPrice} BYN вместо ${p.oldPrice}`,
  item_reserved: (p) => `«${p.title}» из избранного зарезервирована`,
  item_sold: (p) => `«${p.title}» из избранного продана`,
  item_available: (p) => `«${p.title}» снова в продаже`,
  offer_new: (p) => `@${p.buyer} предлагает ${p.amount} BYN за «${p.title}» вместо ${p.price}`,
  offer_countered: (p) => `@${p.by} предлагает ${p.amount} BYN за «${p.title}»`,
  offer_accepted: (p) => `Предложение ${p.amount} BYN за «${p.title}» принято`,
  offer_declined: (p) => (p.auto ? `Продавец не готов продать «${p.title}» за ${p.amount} BYN` : `Предложение ${p.amount} BYN за «${p.title}» отклонено`),
  offer_expired: (p) => `Предложение ${p.amount} BYN за «${p.title}» истекло`,
  follow_new_item: (p) => `@${p.seller} выставил «${p.title}»`,
  listing_blocked: (p) => `«${p.title}» снята модератором${p.reason ? `: ${p.reason}` : ""}`,
  listing_unblocked: (p) => `«${p.title}» снова опубликована`,
  auction_bid: (p) => `Новая ставка ${p.amount} BYN на «${p.title}»`,
  auction_outbid: (p) => `Вашу ставку на «${p.title}» перебили: теперь ${p.amount} BYN`,
  auction_won: (p) => `Вы выиграли аукцион «${p.title}» за ${p.amount} BYN — выберите способ получения`,
  auction_runner_up: (p) => `Победитель не вышел на связь — «${p.title}» ваша за ${p.amount} BYN. Выберите способ получения`,
  auction_sold: (p) => `Аукцион «${p.title}» завершён: ${p.amount} BYN`,
  auction_no_sale: (p) => (p.reason === "reserve" ? `Аукцион «${p.title}» завершён: резервная цена не достигнута` : `Аукцион «${p.title}» завершён без продажи — вещь осталась в продаже`),
};

export const notificationText = (n: Pick<NotificationRow, "type" | "payload">) => NOTIFICATION_TEXT[n.type]?.(n.payload) ?? "Новое уведомление";

export const notificationHref = (n: Pick<NotificationRow, "type" | "payload">) => {
  const p = n.payload;
  if ((n.type === "auction_won" || n.type === "auction_runner_up") && p.listingId && p.requestId) return `/buy/${p.listingId}?request=${p.requestId}`;
  if (n.type === "offer_accepted" && p.requestId) return `/deals/${p.requestId}`;
  if (n.type.startsWith("offer_") && p.listingId) return n.type === "offer_new" ? "/sales" : `/item/${p.listingId}`;
  if (p.requestId) return `/deals/${p.requestId}`;
  if (p.listingId) return `/item/${p.listingId}`;
  return "/notifications";
};
