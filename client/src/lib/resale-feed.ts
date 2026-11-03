/** «Вторичка»'s feed requests, shared by the server page (first screen in the HTML) and the client feed. */

export const RESALE_PAGE = 24;

export const RESALE_CHIPS = [
  ["for_you", "Для вас"],
  ["new", "Новое"],
  ["popular", "Популярное"],
  ["auctions", "Аукционы"],
  ["under_50", "До 50 BYN"],
] as const;

/** Only a known chip goes into the feed request: anything else in the address falls back to «Новое». */
export const resaleChip = (param: string | null): string => RESALE_CHIPS.find(([key]) => key === param)?.[0] ?? "new";

export const resaleFeedKey = (chip: string, offset: number) => `/feed?chip=${chip}&market=resale&offset=${offset}&limit=${RESALE_PAGE}`;

/** The wardrobes row: a few more than it shows, since half-empty collages stay out of it. */
export const RESALE_WARDROBES = "/wardrobes?limit=12";
