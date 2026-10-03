import type { PhotoUrls } from "./api";

export type ListingStatus = "DRAFT" | "PUBLISHED" | "RESERVED" | "SOLD" | "HIDDEN" | "BLOCKED" | "DELETED";
export type Condition = "NEW_WITH_TAGS" | "LIKE_NEW" | "GOOD" | "VISIBLE_WEAR";
export type DeliveryMethod = "IN_PERSON" | "PICKUP" | "DELIVERY";
export type SizeSystem = "ALPHA" | "SHOE_EU" | "JEANS_W" | "OTHER";
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
  email: string | null;
  phone: string | null;
  city: string | null;
  bio: string | null;
  role: "USER" | "ADMIN";
  onboardedAt: string | null;
  createdAt: string;
  unreadNotifications: number;
  pendingSales: number;
  pendingOffers: number;
  cartCount: number;
  unreadMessages: number;
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
  winnerIsMe: boolean;
  requestId: string | null;
  bids: Array<{ bidder: string; amount: number; at: string; mine: boolean }>;
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
  measurements: Partial<Record<"shoulders" | "chest" | "waist" | "length" | "sleeve" | "foot_length", number | null>> | null;
  description: string | null;
  descriptionByAi: boolean;
  city: string | null;
  deliveryOptions: DeliveryMethod[];
  acceptsOffers: boolean;
  gender: "MALE" | "FEMALE" | "UNISEX" | null;
  styleTags: string[];
  viewsCount: number;
  favoritesCount: number;
  publishedAt: string | null;
  createdAt: string;
  blockedReason: string | null;
  photos: Photo[];
  seller: SellerSummary;
  isOwner: boolean;
  isFavorite: boolean;
  inCart: boolean;
  saleType: "FIXED" | "AUCTION";
  auction: AuctionView | null;
  myRequest: { id: string; status: RequestStatus; number: number } | null;
  owner: { pendingRequests: number; pendingOffers: number; appealOpen: boolean; auctionStep: number | null; auctionReserve: number | null; auctionHours: number | null; minOfferPrice: number | null; aiAttributes: Record<string, AiAttr> | null; sizeSystem: SizeSystem | null } | null;
}

export type ListingResponse = ListingDetail | { unavailable: "hidden" | "blocked"; id: string; seller: { username: string } };

export interface Deal {
  id: string;
  number: number;
  role: "buyer" | "seller";
  status: RequestStatus;
  priceTotal: number;
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
  events?: Array<{ status: RequestStatus; at: string; reason: string | null; byMe: boolean }>;
}

export interface Category {
  slug: string;
  label: string;
  section: "top" | "bottom" | "shoes" | "accessories";
  group: "clothing" | "shoes" | "accessories" | "bags";
  sizeSystems: SizeSystem[];
  subcategories: Array<{ slug: string; label: string }>;
}

export interface Meta {
  categories: Category[];
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

export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "COUNTERED" | "EXPIRED" | "CANCELLED";

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
  counterRange: { min: number; max: number } | null;
  history: Array<{ round: number; amount: number; from: "BUYER" | "SELLER"; status: OfferStatus; createdAt: string }>;
}

export interface CartGroup {
  seller: { id: string; username: string; city: string | null };
  items: Card[];
  deliveryOptions: DeliveryMethod[];
  total: number;
  availableCount: number;
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
}

export interface ChatMessage {
  id: string;
  body: string;
  mine: boolean;
  createdAt: string;
  pending?: boolean;
}

export interface CollectionSummary {
  id: string;
  name: string;
  count: number;
  covers: (string | null)[];
  hasItem?: boolean;
}
