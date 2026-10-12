import type { PhotoUrls } from "./api";

export type ListingStatus = "DRAFT" | "PUBLISHED" | "RESERVED" | "SOLD" | "HIDDEN" | "BLOCKED" | "DELETED";
export type Condition = "NEW_WITH_TAGS" | "LIKE_NEW" | "GOOD" | "VISIBLE_WEAR";
export type DeliveryMethod = "IN_PERSON" | "PICKUP" | "DELIVERY";
export type SizeSystem = "ALPHA" | "SHOE_EU" | "JEANS_W" | "OTHER";
/** "Для кого"; null (or a legacy UNISEX) means the item fits anyone. */
export type Gender = "FEMALE" | "MALE";
export type MeasurementKey = "shoulders" | "chest" | "waist" | "hips" | "length" | "sleeve" | "inseam" | "foot_length";

export interface VideoView {
  id: string;
  url: string;
  mime: string;
  poster: string;
  width: number;
  height: number;
  durationMs: number;
}
export type RequestStatus =
  | "CREATED"
  | "PENDING_SELLER"
  | "ACCEPTED"
  | "DECLINED"
  | "COUNTER_OFFERED"
  | "WAITING_PAYMENT"
  | "WAITING_HANDOVER"
  | "HANDED_OVER"
  | "IN_TRANSIT"
  | "RECEIVED"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTED";

export interface Me {
  id: string;
  username: string;
  avatar?: PhotoUrls | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  bio: string | null;
  role: "USER" | "ADMIN";
  onboardedAt: string | null;
  createdAt: string;
  emailVerified: boolean;
  emailPrefs: { deals: boolean };
  sizes: PreferredSizes | null;
  bodyMeasurements: BodyMeasurements | null;
  bundleDiscounts: BundleTier[];
  unreadNotifications: number;
  pendingSales: number;
  pendingOffers: number;
  cartCount: number;
  unreadMessages: number;
  /** Has listed anything: seller tools are shown only then. */
  isSeller: boolean;
}

export interface PreferredSizes {
  clothing?: string[];
  shoes?: string[];
  jeans?: string[];
}

export interface BodyMeasurements {
  height?: number | null;
  chest?: number | null;
  waist?: number | null;
  hips?: number | null;
  footLength?: number | null;
}

export interface BundleTier {
  minItems: number;
  percent: number;
}

export interface FitHint {
  verdict: "good" | "snug" | "loose" | "small" | "large";
  title: string;
  details: string[];
  basis: "measurements" | "size";
}

export interface Cover {
  width: number;
  height: number;
  urls: PhotoUrls;
}

export interface Card {
  id: string;
  title: string;
  price: number | null;
  previousPrice: number | null;
  originalPrice?: number | null;
  hasVideo?: boolean;
  scheduledAt?: string | null;
  size: string | null;
  condition: Condition | null;
  brand: string | null;
  category: string | null;
  status: ListingStatus;
  cover: Cover | null;
  seller: { id: string; username: string };
  isFavorite: boolean;
  publishedAt: string | null;
  saleType?: "FIXED" | "AUCTION";
  auction?: { endsAt: string; currentBid: number | null; startPrice: number; bidsCount: number } | null;
}

export interface AuctionView {
  id: string;
  status: "ACTIVE" | "SOLD" | "NO_SALE" | "CANCELLED";
  startPrice: number;
  step: number;
  currentBid: number | null;
  minBid: number;
  bidsCount: number;
  bidders: number;
  endsAt: string;
  extendedTimes: number;
  reserveSet: boolean;
  reserveMet: boolean;
  reservePrice: number | null;
  leaderIsMe: boolean;
  myMaxBid: number | null;
  myAutoMax: number | null;
  buyNowPrice: number | null;
  buyNowAvailable: boolean;
  boughtOut: boolean;
  winnerIsMe: boolean;
  requestId: string | null;
  bids: Array<{ bidder: string; amount: number; at: string; mine: boolean; auto: boolean; buyNow: boolean }>;
}

export interface Photo {
  id: string;
  width: number;
  height: number;
  isCover: boolean;
  isDefect: boolean;
  order: number;
  urls: PhotoUrls;
}

export interface SellerSummary {
  id: string;
  username: string;
  city: string | null;
  bio: string | null;
  createdAt: string;
  activeCount: number;
  soldCount: number;
  followers: number;
  following: number;
  completedDeals: number;
  isFollowing: boolean;
  rating: { avg: number; count: number } | null;
  bundleDiscounts: BundleTier[];
  avatar?: PhotoUrls | null;
}

/** «Образ»: an outfit a seller put together from their own items. */
export interface Look {
  id: string;
  title: string;
  createdAt: string;
  isOwner: boolean;
  items: Card[];
  total: number;
  available: number;
  owner?: { username: string; avatar: PhotoUrls | null };
}

export interface AiAttr {
  value: unknown;
  confidence: number;
  accepted_by_user: boolean;
  edited_by_user: boolean;
}

export interface ListingDetail {
  id: string;
  status: ListingStatus;
  title: string;
  price: number | null;
  previousPrice: number | null;
  originalPrice: number | null;
  category: string | null;
  categoryLabel: string | null;
  subcategory: string | null;
  subcategoryLabel: string | null;
  sizeSystem: SizeSystem | null;
  size: string | null;
  condition: Condition | null;
  defectsPresent: boolean | null;
  defectsDescription: string | null;
  brand: string | null;
  color: string | null;
  material: string | null;
  measurements: Partial<Record<MeasurementKey, number | null>> | null;
  description: string | null;
  descriptionByAi: boolean;
  city: string | null;
  deliveryOptions: DeliveryMethod[];
  acceptsOffers: boolean;
  gender: Gender | "UNISEX" | null;
  styleTags: string[];
  viewsCount: number;
  favoritesCount: number;
  publishedAt: string | null;
  createdAt: string;
  blockedReason: string | null;
  photos: Photo[];
  video: VideoView | null;
  /** Other sizes of the same item; null when it's listed in one size. */
  sizes: Array<{ id: string; size: string | null; available: boolean; current: boolean }> | null;
  seller: SellerSummary;
  isOwner: boolean;
  isFavorite: boolean;
  inCart: boolean;
  saleType: "FIXED" | "AUCTION";
  auction: AuctionView | null;
  myRequest: { id: string; status: RequestStatus; number: number } | null;
  /** Size hint for the signed-in buyer (null for guests and when nothing is known). */
  fit: FitHint | null;
  /** Whether the viewer has saved sizes/measurements (null for guests and the owner). */
  fitProfile: boolean | null;
  owner: {
    pendingRequests: number;
    pendingOffers: number;
    appealOpen: boolean;
    auctionStep: number | null;
    auctionReserve: number | null;
    auctionHours: number | null;
    auctionBuyNow: number | null;
    minOfferPrice: number | null;
    autoAcceptPrice: number | null;
    extraSizes: string[];
    scheduledAt: string | null;
    likersOfferAt: string | null;
    aiAttributes: Record<string, AiAttr> | null;
    sizeSystem: SizeSystem | null;
    bump: { nextAt: string; available: boolean; count: number } | null;
  } | null;
}

export type ListingResponse = ListingDetail | { unavailable: "hidden" | "blocked"; id: string; seller: { username: string } };

export interface Deal {
  id: string;
  number: number;
  role: "buyer" | "seller";
  status: RequestStatus;
  priceTotal: number;
  subtotal: number | null;
  discountPercent: number;
  listPriceTotal: number;
  source: "BUY" | "OFFER" | "CART" | "AUCTION";
  deliveryMethod: DeliveryMethod;
  deliveryPoint: string | null;
  buyerComment: string | null;
  trackingNumber: string | null;
  reason: string | null;
  cancelledByMe: boolean | null;
  expiresAt: string | null;
  handedOverAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items: Array<Card & { dealPrice: number }>;
  counterpart: { id: string; username: string; phone: string | null };
  sellerCity: string | null;
  threadId: string | null;
  needsMyAction: boolean;
  review: { id: string; rating: number; text: string | null; tags: string[]; reply: string | null; createdAt: string; repliedAt: string | null; hidden: boolean; canEdit: boolean } | null;
  canReview: boolean;
  events?: Array<{ status: RequestStatus; at: string; reason: string | null; byMe: boolean }>;
}

export interface Review {
  id: string;
  rating: number;
  tags: Array<{ key: string; label: string; positive: boolean }>;
  text: string | null;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  edited: boolean;
  author: string;
  listing: { id: string; title: string } | null;
  mine: boolean;
  canEdit: boolean;
  canReply: boolean;
}

export interface ReviewsPage {
  summary: { avg: number; count: number; distribution: Array<{ stars: number; count: number }>; topTags: Array<{ key: string; label: string; count: number }> };
  items: Review[];
  hasMore: boolean;
}

interface StatTotals {
  views: number;
  favorites: number;
  carts: number;
  chats: number;
  offers: number;
  requests: number;
}

export interface StatsOverview {
  days: 7 | 30;
  totals: StatTotals & { contacts: number; sales: number; revenue: number };
  previous: StatTotals & { contacts: number; sales: number; revenue: number };
  funnel: Array<{ key: string; label: string; value: number }>;
  series: Array<{ day: string; views: number; favorites: number; contacts: number }>;
  listings: Array<{ listing: Card; period: StatTotals; allTime: { views: number; favorites: number }; bump: { nextAt: string; available: boolean } | null; tips: string[] }>;
  tips: Array<{ listingId: string; title: string; text: string }>;
}

export interface ListingStats {
  allTime: { views: number; favorites: number };
  last30: StatTotals;
  series: Array<{ day: string; views: number }>;
  bump: { nextAt: string; available: boolean; lastAt: string | null; count: number } | null;
  tips: string[];
}

interface Category {
  slug: string;
  label: string;
  section: "top" | "bottom" | "shoes" | "accessories";
  group: "clothing" | "shoes" | "accessories" | "bags";
  sizeSystems: SizeSystem[];
  genders?: Gender[];
  subcategories: Array<{ slug: string; label: string }>;
}

export interface Meta {
  categories: Category[];
  genders: Array<{ value: Gender; label: string; menu: string }>;
  sizes: { ALPHA: string[]; SHOE_EU: string[]; JEANS_W: string[] };
  conditions: Array<{ value: Condition; label: string; hint: string }>;
  colors: Array<{ value: string; label: string; hex: string }>;
  materials: string[];
  styleTags: string[];
  cities: string[];
  brands: string[];
}

export interface AiSuggestion {
  category: { value: string | null; confidence: number };
  subcategory: { value: string | null; confidence: number };
  color: { value: string | null; confidence: number };
  brand: { value: string | null; confidence: number };
  style_tags: { value: string[]; confidence: number };
  title: { value: string; confidence: number };
  description: { value: string; confidence: number };
  flags: { not_clothing: boolean; prohibited: boolean; inappropriate: boolean };
  model: string;
}

type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "COUNTERED" | "EXPIRED" | "CANCELLED";

export interface Offer {
  id: string;
  role: "buyer" | "seller";
  round: number;
  amount: number;
  from: "BUYER" | "SELLER";
  status: OfferStatus;
  expiresAt: string;
  createdAt: string;
  requestId: string | null;
  listPrice: number | null;
  listing: Card;
  counterpart: { id: string; username: string };
  myTurn: boolean;
  canCounter: boolean;
  /** A "скидка лайкнувшим" from the seller: accept or decline only. */
  fromLikers?: boolean;
  counterRange: { min: number; max: number } | null;
  history: Array<{ round: number; amount: number; from: "BUYER" | "SELLER"; status: OfferStatus; createdAt: string }>;
}

export interface CartGroup {
  seller: { id: string; username: string; city: string | null };
  items: Card[];
  deliveryOptions: DeliveryMethod[];
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  availableCount: number;
  bundleTiers: BundleTier[];
  nextTier: { needItems: number; percent: number } | null;
}

export interface ThreadSummary {
  id: string;
  role: "buyer" | "seller";
  listing: Card;
  counterpart: { id: string; username: string };
  request: { id: string; number: number; status: RequestStatus } | null;
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
  lastMessageAt: string;
  unread: boolean;
  /** When the other side last read the thread ("Прочитано" under my messages). */
  counterpartReadAt: string | null;
}

type ChatMessageKind = "TEXT" | "LOCATION" | "MEDIA";

export type ChatMedia = { type: "photo"; id: string; width: number; height: number; urls: PhotoUrls } | ({ type: "video" } & VideoView);

/** A quoted message (reply) or a pinned one, as one preview line. */
export interface ChatQuote {
  id: string;
  mine: boolean;
  deleted: boolean;
  text: string;
  kind: ChatMessageKind;
  thumb: string | null;
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatPin {
  messageId: string;
  forAll: boolean;
  createdAt: string;
  message: ChatQuote & { createdAt: string };
}

export interface ChatMessage {
  id: string;
  kind?: ChatMessageKind;
  /** Text, the caption of a media message, or the preview line of a location. */
  body: string;
  mine: boolean;
  createdAt: string;
  editedAt?: string | null;
  pending?: boolean;
  /** Not sent (outbox only): shown with "retry". */
  failed?: boolean;
  /** Upload share 0…1 while media is still uploading (outbox only). */
  progress?: number;
  /** Antifraud warning, shown to the recipient only. */
  risk?: MessageRisk | null;
  /** Shown to the sender, e.g. "card number hidden". */
  notice?: string | null;
  /** A shared point on the map (location message). */
  location?: ChatLocation | null;
  media?: ChatMedia[];
  replyTo?: ChatQuote | null;
  reactions?: ChatReaction[];
}

export interface ChatLocation {
  lat: number;
  lng: number;
  /** Metres, when the point is the sender's device fix rather than a spot picked on the map. */
  accuracy?: number | null;
}

export interface CollectionSummary {
  id: string;
  name: string;
  count: number;
  covers: (string | null)[];
  hasItem?: boolean;
}

// ---------- AI ensemble ----------

export interface PriceSuggestion {
  status: "ok" | "insufficient";
  recommended: number | null;
  low: number | null;
  high: number | null;
  quickSale: number | null;
  confidence: "high" | "medium" | "low";
  facts: string[];
  reasoning: string | null;
  basis: { comparables: number; sold: number; aiVotes: number };
  comparables: Card[];
  auction: { start: number; reserve: number } | null;
  model: string;
}

export interface NegotiationAdvice {
  action: "accept" | "counter" | "decline";
  counter: number | null;
  confidence: "high" | "medium" | "low";
  facts: string[];
  reason: string | null;
  market: { low: number; high: number; recommended: number } | null;
  model: string;
}

export interface OpeningSuggestion {
  suggested: number;
  min: number;
  chance: "high" | "medium" | "low";
  facts: string[];
}

export interface SearchInterpretation {
  status: "ok" | "skip";
  filters: {
    q: string;
    category: string[];
    subcategory: string[];
    color: string[];
    size: string[];
    condition: string[];
    brand: string[];
    style: string[];
    gender: string[];
    city: string | null;
    price_min: number | null;
    price_max: number | null;
  };
  chips: Array<{ key: string; label: string }>;
  source: "rules" | "ai";
}

export interface MessageRisk {
  level: "warn" | "high";
  categories: string[];
  text: string;
  source: "rules" | "ai";
}
