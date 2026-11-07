/**
 * Sections that show one visitor's own data (account, deals, chats, admin). Their pages are never kept
 * by a browser or proxy cache and never indexed; next.config.ts and robots.ts both read this list.
 */
export const PRIVATE_SECTIONS = [
  "admin",
  "sell",
  "settings",
  "cart",
  "messages",
  "deals",
  "buy",
  "purchases",
  "sales",
  "notifications",
  "welcome",
  "favorites",
  "following",
  "wardrobe",
] as const;

/**
 * Listed in robots.txt as well; the admin panel is left out there so the file doesn't point to it (noindex covers it).
 * Each section is closed exactly — the page itself, its subpages and its query strings — never as a bare prefix:
 * robots.txt rules are prefixes, and «/wardrobe» alone also closed the public «/wardrobes» list.
 */
export const ROBOTS_DISALLOW = [
  "/api/",
  ...PRIVATE_SECTIONS.filter((s) => s !== "admin").flatMap((s) => [`/${s}$`, `/${s}/`, `/${s}?`]),
  "/item/*/edit",
  "/journal/write",
  "/journal/mine",
];
