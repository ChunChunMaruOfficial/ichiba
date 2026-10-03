const KEY = "ichiba:recent-searches";

/** Last 5 queries, per browser (frame 05 search dropdown). Storage may be unavailable — never throw. */
export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecent(q: string) {
  const v = q.trim();
  if (!v) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([v, ...getRecent().filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 5)));
  } catch {}
}

export function removeRecent(q: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecent().filter((x) => x !== q)));
  } catch {}
}
