// Every Japanese character in the client code must be in the brush-font subset (src/app/fonts/yuji-syuku-ichiba.*):
// a missing one is drawn in a plain serif instead of the brush. Prints the missing ones and exits 1.
//
// To add characters: put them into src/app/fonts/yuji-syuku-ichiba.txt and fetch a new subset with exactly that text
// from Google Fonts (the font is OFL), the same way as the Open Graph fonts in assets/fonts:
//   https://fonts.googleapis.com/css2?family=Yuji+Syuku&text=<the file's characters, URL-encoded>
// then save the woff2 it points to as src/app/fonts/yuji-syuku-ichiba.woff2.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const have = new Set(readFileSync(join(root, "src/app/fonts/yuji-syuku-ichiba.txt"), "utf8"));
const missing = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|css|mdx)$/.test(name))
      for (const ch of readFileSync(path, "utf8").match(/[　-ヿ㐀-鿿＀-￯]/gu) ?? [])
        if (!have.has(ch)) missing.set(ch, relative(root, path));
  }
};
walk(join(root, "src"));
walk(join(root, "content"));
if (missing.size) {
  console.error(`Not in the brush-font subset: ${[...missing].map(([ch, file]) => `${ch} (${file})`).join(", ")}`);
  process.exit(1);
}
console.log(`brush font covers all ${have.size} characters it is asked for`);
