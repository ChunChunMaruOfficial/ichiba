import type { Condition, DeliveryMethod, ListingStatus, RequestStatus, TailorMeasurements } from "./types";

export const CONDITION_LABEL: Record<Condition, string> = {
  NEW_WITH_TAGS: "Новое",
  LIKE_NEW: "Как новое",
  GOOD: "Хорошее",
  VISIBLE_WEAR: "Заметные следы носки",
};

/** The condition as a buyer reads it: «Новое» says whether the tags are on, when the seller said so. */
export const conditionLabel = (condition: Condition, hasTags?: boolean | null) =>
  condition === "NEW_WITH_TAGS" && hasTags != null ? (hasTags ? "Новое с биркой" : "Новое без бирки") : CONDITION_LABEL[condition];

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  IN_PERSON: "Передача лично",
  PICKUP: "Самовывоз",
  DELIVERY: "Доставка",
};

/** A way to receive an item a buyer can choose (pickup was folded into a personal handover). */
export type DeliveryWay = Exclude<DeliveryMethod, "PICKUP">;

/** Delivery choice tiles: seal, title, explanation, and the wording when it is the only way. */
export const DELIVERY_WAY: Record<DeliveryWay, { seal: string; title: string; hint: string; only: string }> = {
  IN_PERSON: { seal: "手", title: "Передача лично", hint: "Место и время обсудите в чате после ответа продавца", only: "Продавец передаёт вещи только лично" },
  DELIVERY: { seal: "送", title: "Доставка", hint: "Продавец отправит сам и пришлёт трек-номер. Доставка оплачивается отдельно", only: "Продавец только отправляет доставкой" },
};

/** Ways the buyer can choose, in-person first; an old listing's "Самовывоз" counts as a personal handover. */
export const deliveryWays = (options: DeliveryMethod[]): DeliveryWay[] =>
  (["IN_PERSON", "DELIVERY"] as const).filter((w) => options.includes(w) || (w === "IN_PERSON" && options.includes("PICKUP")));

/** Item status badge (frame 05). PUBLISHED has no badge. */
export const LISTING_BADGE: Partial<Record<ListingStatus, { label: string; tone: "warn" | "dark" | "muted" | "danger" | "outline" }>> = {
  RESERVED: { label: "Зарезервировано", tone: "warn" },
  SOLD: { label: "Продано", tone: "dark" },
  HIDDEN: { label: "Скрыто", tone: "muted" },
  BLOCKED: { label: "Заблокировано", tone: "danger" },
  DRAFT: { label: "Черновик", tone: "outline" },
};

/** Deal status as each side sees it (frame 13 status table): what is happening, in plain words. */
export const DEAL_STATUS: Record<RequestStatus, { buyer: string; seller: string; tone: "muted" | "ok" | "danger" | "warn" | "dark" }> = {
  CREATED: { buyer: "Создан", seller: "Создан", tone: "muted" },
  PENDING_SELLER: { buyer: "Ожидает ответа", seller: "Ждёт вашего ответа", tone: "warn" },
  ACCEPTED: { buyer: "Продавец согласен", seller: "Вы согласились", tone: "ok" },
  DECLINED: { buyer: "Продавец отказал", seller: "Вы отказали", tone: "danger" },
  COUNTER_OFFERED: { buyer: "Встречная цена", seller: "Ожидает ответа покупателя", tone: "warn" },
  WAITING_PAYMENT: { buyer: "Ожидает оплаты", seller: "Ожидает оплаты", tone: "warn" },
  WAITING_HANDOVER: { buyer: "Ожидает передачи", seller: "Передайте вещь", tone: "warn" },
  HANDED_OVER: { buyer: "Продавец передал", seller: "Вы передали", tone: "ok" },
  IN_TRANSIT: { buyer: "В пути", seller: "Отправлено", tone: "ok" },
  RECEIVED: { buyer: "Получено", seller: "Покупатель получил", tone: "ok" },
  COMPLETED: { buyer: "Сделка завершена", seller: "Продано", tone: "dark" },
  CANCELLED: { buyer: "Отменено", seller: "Отменено", tone: "muted" },
  DISPUTED: { buyer: "Открыт спор", seller: "Открыт спор", tone: "danger" },
};

export const formatPrice = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("ru-RU")} BYN`);
/**
 * A price the seller left open, as buyers see it everywhere: they ask for it (a chat with the question ready) or name
 * their own (an offer). «Договорная» read as a flea market on a brand's items and is no longer shown to buyers; the
 * seller's own form still says «Цена договорная», which is what they choose.
 */
export const PRICE_ON_REQUEST = "Цена по запросу";
/** A listing's price as shown to buyers: «Цена по запросу» when the seller left it open. */
export const listingPrice = (l: { price: number | null; priceNegotiable?: boolean }) => (l.priceNegotiable ? PRICE_ON_REQUEST : formatPrice(l.price));
/** Imports write «Уточняйте» where the size is unknown: on a card that says nothing, so no size is shown there. */
export const shownSize = (size: string | null | undefined) => (size && size !== "Уточняйте" ? size : null);

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "только что";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function hoursLeft(iso: string | null | undefined) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600_000));
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const items = (n: number) => `${n} ${plural(n, "вещь", "вещи", "вещей")}`;

/** «Пошив по меркам»: the measurements a tailor gets, in this order. */
const TAILOR_LABEL: Record<keyof TailorMeasurements, string> = { height: "Рост", chest: "Обхват груди", waist: "Обхват талии", hips: "Обхват бёдер" };
/** [«Обхват груди», «92 см»] for each measurement filled in. */
export const tailorLines = (m: TailorMeasurements | null | undefined) =>
  (Object.keys(TAILOR_LABEL) as (keyof TailorMeasurements)[]).flatMap((k) => (m?.[k] ? [[TAILOR_LABEL[k], `${m[k]} см`] as const] : []));
/** Whether a profile has what a made-to-measure order needs: at least one girth. */
export const canSewTo = (m: TailorMeasurements | null | undefined) => !!(m?.chest || m?.waist || m?.hips);
