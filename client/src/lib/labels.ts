import type { Condition, DeliveryMethod, ListingStatus, RequestStatus } from "./types";

export const CONDITION_LABEL: Record<Condition, string> = {
  NEW_WITH_TAGS: "Новое с биркой",
  LIKE_NEW: "Как новое",
  GOOD: "Хорошее",
  VISIBLE_WEAR: "Заметные следы носки",
};

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  IN_PERSON: "Передача лично",
  PICKUP: "Самовывоз",
  DELIVERY: "Доставка",
};

/** Item status badge (frame 05). PUBLISHED has no badge. */
export const LISTING_BADGE: Partial<Record<ListingStatus, { label: string; tone: "warn" | "dark" | "muted" | "danger" | "outline" }>> = {
  RESERVED: { label: "Зарезервировано", tone: "warn" },
  SOLD: { label: "Продано", tone: "dark" },
  HIDDEN: { label: "Скрыто", tone: "muted" },
  BLOCKED: { label: "Заблокировано", tone: "danger" },
  DRAFT: { label: "Черновик", tone: "outline" },
};

/** Deal status as each side sees it (frame 13 status table). */
export const DEAL_STATUS: Record<RequestStatus, { buyer: string; seller: string; tone: "muted" | "ok" | "danger" | "warn" | "dark" }> = {
  CREATED: { buyer: "Создан", seller: "Создан", tone: "muted" },
  PENDING_SELLER: { buyer: "Ожидает подтверждения", seller: "Новый запрос", tone: "warn" },
  ACCEPTED: { buyer: "Продавец подтвердил", seller: "Вы приняли запрос", tone: "ok" },
  DECLINED: { buyer: "Продавец отклонил", seller: "Отклонён", tone: "danger" },
  COUNTER_OFFERED: { buyer: "Встречная цена", seller: "Ждём покупателя", tone: "warn" },
  WAITING_PAYMENT: { buyer: "Ожидает оплаты", seller: "Ждём оплату", tone: "warn" },
  WAITING_HANDOVER: { buyer: "Ожидает передачи", seller: "Договоритесь о передаче", tone: "warn" },
  HANDED_OVER: { buyer: "Передано продавцом", seller: "Передано", tone: "ok" },
  IN_TRANSIT: { buyer: "В пути", seller: "Отправлено", tone: "ok" },
  RECEIVED: { buyer: "Получено", seller: "Покупатель получил", tone: "ok" },
  COMPLETED: { buyer: "Сделка завершена", seller: "Продано", tone: "dark" },
  CANCELLED: { buyer: "Отменено", seller: "Отменено", tone: "muted" },
  DISPUTED: { buyer: "Открыт спор", seller: "Открыт спор", tone: "danger" },
};

export const formatPrice = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("ru-RU")} BYN`);

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
