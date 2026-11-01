/**
 * Who writes the journal. Named people with a role and a short bio are what search engines and AI answers read as
 * expertise (docs/SEO-JOURNAL.md): add yourself and your experts here, and name them in each article's `author`.
 * `team` is the fallback for pieces written by the editorial team as a whole.
 */
export interface Author {
  id: string;
  name: string;
  role: string;
  bio: string;
  /** Person for a human, Organization for the team. */
  kind: "person" | "team";
  /** Public pages that confirm the person: a site, Telegram, Instagram. */
  links?: Array<{ href: string; label: string }>;
  /** A square photo under public/journal/authors; omitted = an initial on kraft. */
  photo?: string;
}

export const AUTHORS: Author[] = [
  {
    id: "team",
    name: "Редакция ichiba",
    role: "команда маркетплейса",
    bio: "Мы делаем ichiba — маркетплейс открытых гардеробов Беларуси — и пишем о том, что видим в данных площадки и в разговорах с продавцами и покупателями: как продавать честно, покупать осознанно и дольше носить хорошие вещи.",
    kind: "team",
    links: [{ href: "/contacts", label: "Контакты" }],
  },
];

export const authorById = (id: string) => AUTHORS.find((a) => a.id === id);
