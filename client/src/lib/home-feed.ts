/** The home feed's chip and request, shared by the server page (first screen in the HTML) and the client feed. */

export const FIRST_SCREEN = 24;
const CHIP_KEYS = ["for_you", "new", "popular"];

/** Only a known chip goes into the feed request; otherwise «Для вас» for returning users, «Новое» for new ones. */
export const homeChip = (param: string | null, forYou: boolean) => (param && CHIP_KEYS.includes(param) ? param : forYou ? "for_you" : "new");

export const homeFeedKey = (chip: string, offset: number) => `/feed?chip=${chip}&market=brands&offset=${offset}&limit=${FIRST_SCREEN}`;
