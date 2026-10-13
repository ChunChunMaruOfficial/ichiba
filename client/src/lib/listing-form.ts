import type { AiAttr, AiSuggestion, Condition, DeliveryMethod, Gender, ListingDetail, MeasurementKey, Meta, SizeSystem, VideoView } from "./types";

export interface PhotoDraft {
  key: string;
  id?: string;
  preview: string;
  /** Best source for the photo editor: the picked file, or the large size of a stored photo. */
  original?: string;
  status: "uploading" | "done" | "error";
  /** Upload progress 0…1 while uploading. */
  progress?: number;
  error?: string;
  isDefect: boolean;
  width?: number;
  height?: number;
}

export interface ListingValues {
  title: string;
  category: string | null;
  subcategory: string | null;
  sizeSystem: SizeSystem | null;
  sizeValue: string | null;
  condition: Condition | null;
  defectsPresent: boolean | null;
  defectsDescription: string;
  brand: string;
  color: string | null;
  material: string | null;
  measurements: Partial<Record<MeasurementKey, string>>;
  description: string;
  city: string | null;
  deliveryOptions: DeliveryMethod[];
  price: string;
  /** «Цена договорная»: no number, buyers make an offer or write. */
  priceNegotiable: boolean;
  acceptsOffers: boolean;
  minOfferPrice: string;
  styleTags: string[];
  saleType: "FIXED" | "AUCTION";
  auctionStep: string;
  auctionReserve: string;
  auctionHours: 24 | 72 | 168;
  auctionBuyNow: string;
  gender: Gender | null;
  /** Price new in a shop. */
  originalPrice: string;
  autoAcceptPrice: string;
  /** Other sizes of the same item, listed as copies on publish. */
  extraSizes: string[];
  video: VideoView | null;
}

/** AI-filled fields the user can accept or edit (frame 22). Size, condition, material, defects are never AI-filled. */
export type AiField = "category" | "subcategory" | "color" | "brand" | "style_tags" | "title" | "description";
export type AiState = Partial<Record<AiField, AiAttr>>;

export const emptyValues = (city: string | null): ListingValues => ({
  title: "",
  category: null,
  subcategory: null,
  sizeSystem: null,
  sizeValue: null,
  condition: null,
  defectsPresent: null,
  defectsDescription: "",
  brand: "",
  color: null,
  material: null,
  measurements: {},
  description: "",
  city,
  deliveryOptions: ["IN_PERSON"],
  price: "",
  priceNegotiable: false,
  acceptsOffers: false,
  minOfferPrice: "",
  styleTags: [],
  saleType: "FIXED",
  auctionStep: "",
  auctionReserve: "",
  auctionHours: 72,
  auctionBuyNow: "",
  gender: null,
  originalPrice: "",
  autoAcceptPrice: "",
  extraSizes: [],
  video: null,
});

/** A saved listing's photos as form photos (already uploaded). */
export const photosFromListing = (l: ListingDetail): PhotoDraft[] =>
  l.photos.map((p) => ({ key: p.id, id: p.id, preview: p.urls.m, original: p.urls.l, status: "done", isDefect: p.isDefect, width: p.width, height: p.height }));

export function valuesFromListing(l: ListingDetail): ListingValues {
  return {
    title: l.title,
    category: l.category,
    subcategory: l.subcategory,
    sizeSystem: l.sizeSystem,
    sizeValue: l.size,
    condition: l.condition,
    defectsPresent: l.defectsPresent,
    defectsDescription: l.defectsDescription ?? "",
    brand: l.brand ?? "",
    color: l.color,
    material: l.material,
    measurements: Object.fromEntries(Object.entries(l.measurements ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    description: l.description ?? "",
    city: l.city,
    deliveryOptions: l.deliveryOptions,
    price: l.price != null ? String(l.price) : "",
    priceNegotiable: !!l.priceNegotiable,
    acceptsOffers: l.acceptsOffers,
    minOfferPrice: l.owner?.minOfferPrice != null ? String(l.owner.minOfferPrice) : "",
    styleTags: l.styleTags,
    saleType: l.saleType,
    auctionStep: l.owner?.auctionStep != null ? String(l.owner.auctionStep) : "",
    auctionReserve: l.owner?.auctionReserve != null ? String(l.owner.auctionReserve) : "",
    auctionHours: ([24, 72, 168] as const).find((h) => h === l.owner?.auctionHours) ?? 72,
    auctionBuyNow: l.owner?.auctionBuyNow != null ? String(l.owner.auctionBuyNow) : "",
    gender: l.gender === "UNISEX" ? null : l.gender,
    originalPrice: l.originalPrice != null ? String(l.originalPrice) : "",
    autoAcceptPrice: l.owner?.autoAcceptPrice != null ? String(l.owner.autoAcceptPrice) : "",
    extraSizes: l.owner?.extraSizes ?? [],
    video: l.video,
  };
}

/** Maps an AI suggestion onto empty form fields and records AI provenance per field. */
function applySuggestion(values: ListingValues, s: AiSuggestion): { values: ListingValues; ai: AiState } {
  const ai: AiState = {};
  const next = { ...values };
  const take = <K extends AiField>(field: K, value: unknown, confidence: number) => {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return false;
    ai[field] = { value, confidence, accepted_by_user: true, edited_by_user: false };
    return true;
  };
  if (take("category", s.category.value, s.category.confidence)) next.category = s.category.value;
  if (take("subcategory", s.subcategory.value, s.subcategory.confidence)) next.subcategory = s.subcategory.value;
  if (take("color", s.color.value, s.color.confidence)) next.color = s.color.value;
  if (take("brand", s.brand.value, s.brand.confidence)) next.brand = s.brand.value ?? "";
  if (take("style_tags", s.style_tags.value, s.style_tags.confidence)) next.styleTags = s.style_tags.value;
  if (take("title", s.title.value, s.title.confidence)) next.title = s.title.value;
  if (take("description", s.description.value, s.description.confidence)) next.description = s.description.value;
  return { values: next, ai };
}

/**
 * The suggestion fills only what is still empty: the form is open while the photo is analysed, so anything the
 * seller typed meanwhile wins. A subcategory is taken only together with the suggested category.
 */
export function applySuggestionToEmpty(values: ListingValues, s: AiSuggestion): { values: ListingValues; ai: AiState } {
  const full = applySuggestion(values, s);
  const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length);
  const field: Record<AiField, keyof ListingValues> = {
    category: "category",
    subcategory: "subcategory",
    color: "color",
    brand: "brand",
    style_tags: "styleTags",
    title: "title",
    description: "description",
  };
  const next = { ...values };
  const ai: AiState = {};
  for (const [k, key] of Object.entries(field) as [AiField, keyof ListingValues][]) {
    if (!full.ai[k] || !empty(values[key])) continue;
    if (k === "subcategory" && values.category && values.category !== full.values.category) continue;
    (next as Record<string, unknown>)[key] = full.values[key];
    ai[k] = full.ai[k];
  }
  return { values: next, ai };
}

/** Marks an AI field as edited once the user changes it; the AI badge then disappears. */
export function markEdited(ai: AiState, field: AiField, newValue: unknown): AiState {
  const a = ai[field];
  if (!a || a.edited_by_user || JSON.stringify(a.value) === JSON.stringify(newValue)) return ai;
  return { ...ai, [field]: { ...a, edited_by_user: true } };
}

const sizeRequired = (meta: Meta | undefined, category: string | null) => (meta?.categories.find((c) => c.slug === category)?.sizeSystems.length ?? 0) > 0;

export function validate(values: ListingValues, meta: Meta | undefined, photos: PhotoDraft[], step: "describe" | "price" | "all"): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === "describe" || step === "all") {
    if (!photos.some((p) => p.status === "done")) e.photos = "Добавьте хотя бы одно фото";
    if (!values.category) e.category = "Выберите категорию";
    if (sizeRequired(meta, values.category) && !values.sizeValue) e.size = "Укажите размер";
    if (!values.condition) e.condition = "Выберите состояние";
    if (values.defectsPresent == null) e.defects = "Укажите, есть ли дефекты";
    if (values.defectsPresent && !values.defectsDescription.trim()) e.defectsDescription = "Опишите дефекты";
    if (!values.title.trim()) e.title = "Укажите название";
    if (!values.deliveryOptions.length) e.deliveryOptions = "Выберите хотя бы один способ";
  }
  if ((step === "price" || step === "all") && !(values.priceNegotiable && values.saleType === "FIXED")) {
    const price = Number(values.price);
    if (!values.price || !Number.isInteger(price) || price < 1) e.price = "Укажите цену";
    if (values.saleType === "FIXED" && values.minOfferPrice && Number(values.minOfferPrice) >= price) e.minOfferPrice = "Минимальная цена должна быть меньше цены";
    if (values.saleType === "FIXED" && values.acceptsOffers && values.autoAcceptPrice) {
      const auto = Number(values.autoAcceptPrice);
      if (auto >= price) e.autoAcceptPrice = "Должно быть ниже цены — по цене покупают без торга";
      else if (values.minOfferPrice && auto <= Number(values.minOfferPrice)) e.autoAcceptPrice = "Должно быть выше порога автоотказа";
    }
    if (values.originalPrice && Number(values.originalPrice) <= price) e.originalPrice = "Цена в магазине должна быть выше вашей";
    if (values.saleType === "AUCTION") {
      if (values.auctionReserve && Number(values.auctionReserve) < price) e.auctionReserve = "Резерв не может быть ниже стартовой цены";
      if (values.auctionStep && Number(values.auctionStep) < 1) e.auctionStep = "Шаг — от 1 BYN";
      if (values.auctionBuyNow && Number(values.auctionBuyNow) <= price) e.auctionBuyNow = "Должна быть выше стартовой цены";
      else if (values.auctionBuyNow && values.auctionReserve && Number(values.auctionBuyNow) < Number(values.auctionReserve)) e.auctionBuyNow = "Не может быть ниже резерва";
    }
  }
  return e;
}

/** Payload for POST/PATCH /listings. */
export function toPayload(values: ListingValues, photos: PhotoDraft[], ai: AiState, aiModel?: string) {
  const num = (s: string) => (s.trim() ? Number(s) : null);
  const negotiable = values.saleType === "FIXED" && values.priceNegotiable;
  const measurements = Object.fromEntries(Object.entries(values.measurements).map(([k, v]) => [k, v ? Number(v) : null]));
  return {
    photos: photos.filter((p) => p.status === "done" && p.id).map((p) => ({ id: p.id!, isDefect: p.isDefect })),
    title: values.title.trim(),
    category: values.category,
    subcategory: values.subcategory,
    sizeSystem: values.sizeValue ? values.sizeSystem : null,
    sizeValue: values.sizeValue,
    condition: values.condition,
    defectsPresent: values.defectsPresent,
    defectsDescription: values.defectsPresent ? values.defectsDescription.trim() : null,
    brand: values.brand.trim() || null,
    color: values.color,
    material: values.material,
    measurements: Object.values(measurements).some((v) => v) ? measurements : null,
    description: values.description.trim() || null,
    city: values.city,
    deliveryOptions: values.deliveryOptions,
    price: negotiable ? null : num(values.price),
    priceNegotiable: negotiable,
    acceptsOffers: values.saleType === "FIXED" && (values.acceptsOffers || negotiable),
    minOfferPrice: values.saleType === "FIXED" && values.acceptsOffers ? num(values.minOfferPrice) : null,
    autoAcceptPrice: values.saleType === "FIXED" && values.acceptsOffers ? num(values.autoAcceptPrice) : null,
    originalPrice: num(values.originalPrice),
    gender: values.gender,
    extraSizes: values.saleType === "FIXED" && values.sizeValue ? values.extraSizes.filter((s) => s !== values.sizeValue) : [],
    videoId: values.video?.id ?? null,
    saleType: values.saleType,
    auctionStep: values.saleType === "AUCTION" ? num(values.auctionStep) : null,
    auctionReserve: values.saleType === "AUCTION" ? num(values.auctionReserve) : null,
    auctionHours: values.saleType === "AUCTION" ? values.auctionHours : null,
    auctionBuyNow: values.saleType === "AUCTION" ? num(values.auctionBuyNow) : null,
    styleTags: values.styleTags,
    ...(Object.keys(ai).length ? { aiAttributes: ai, aiModelVersion: aiModel ?? null } : {}),
  };
}
