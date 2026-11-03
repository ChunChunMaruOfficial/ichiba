import { qs } from "./api";

/** The wardrobes list's requests, shared by the server page (first page in the HTML) and the client list. */
export const WARDROBES_PAGE = 12;

export const wardrobesKey = (query: string, offset: number) => `/wardrobes${qs({ q: query, offset, limit: WARDROBES_PAGE })}`;

/** The first page with no search: what a guest and a crawler open. */
export const WARDROBES_FIRST = wardrobesKey("", 0);
