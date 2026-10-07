/**
 * Theme choice (settings): "system" follows the OS; applied before paint by a script in layout.tsx.
 * The dark theme «Ёру» is finished but hidden: flip this to bring back the settings switch and the OS-driven dark mode.
 */
export const DARK_THEME_ENABLED = false;

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "ichiba-theme";

export function getTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: ThemeChoice) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
  document.documentElement.dataset.theme = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
}

/** Inline script for <head>: resolves the theme before the first paint (no flash). Empty while the dark theme is hidden. */
export const THEME_SCRIPT = DARK_THEME_ENABLED
  ? `try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`
  : "";
