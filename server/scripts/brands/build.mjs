// Builds src/catalog/brands.data.ts from three sources:
//   sources/curated.txt  hand-picked brands with Cyrillic aliases and ranking tiers;
//   sources/wikidata.tsv fashion houses, fashion labels and clothing/footwear companies from Wikidata (CC0);
//   sources/nsi.tsv      clothes/shoes/bag/jewelry/sports shop brands from OpenStreetMap's name-suggestion-index (BSD-3).
// Run: node scripts/brands/build.mjs (from server). The output is committed, the API never reads the sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, 'sources', f), 'utf8');

/** Same normalisation as brandKey() in src/catalog/brands.ts. */
const key = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9а-я]/g, '');

const LEGAL = /[,\s]+(inc\.?|ltd\.?|llc|l\.l\.c\.|s\.?p\.?a\.?|s\.a\.?|ag|gmbh|&\s*co\.?|co\.?|company|limited|plc|corp\.?|corporation|group|holdings?|international|ab|a\/s|oy|oyj|b\.?v\.?|n\.?v\.?|s\.r\.l\.|srl|sas|s\.a\.s\.|k\.k\.|pty|ооо|оао|зао|ао)$/i;
const NOT_A_BRAND = /\b(museum|week|awards?|magazine|festival|association|council|school|institute|university|college|factory|mills?|textiles?|kombinat|holding|federation|union|bank|airlines?|pharma|chemicals?|shopping|mall|department stores?|records|film|television|foundation|society|stores?|outlets?|clearance|boutiques?|магазин|exhibition|trade fair|fashion show|district|street|комбинат|фабрика|объединение|концерн|ярмарка)\b/i;
// Holding companies and generic words that come with the industry queries but are not labels shoppers pick.
const DENY = new Set(
  [
    'inditex', 'lvmh', 'kering', 'tapestry', 'capri', 'pvh', 'vf', 'richemont', 'tendam', 'fast retailing', 'lpp', 'otb',
    'fashion', 'clothing', 'footwear', 'sportswear', 'textile', 'apparel', 'retail', 'puig', 'aeffe', 'arcadia', 'mulliez',
    'melon fashion group', 'sportmaster', 'спортмастер', 'humana', 'мегахенд', 'смешные цены', 'московская ярмарка', 'планета',
    'second hand', 'секонд хенд', 'восток-сервис', 'familia', 'lamoda', 'wildberries', 'ozon', 'megasport', 'sneakerbox',
    'street beat', 'purebaby', 'brandshop', 'kix', 'hmv', 'asos plc', 'zalando', 'farfetch', 'yoox', 'net-a-porter', 'mytheresa', 'ssense',
  ].map(key),
);

const tiers = { top: 3000, popular: 600, normal: 200 };
const brands = new Map(); // key -> { name, score, aliases:Set, rank }
const aliasOf = new Map(); // alias key -> canonical key

function clean(raw) {
  let n = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) n = n.replace(LEGAL, '').trim();
  return n;
}
// ichiba has no children's section: children's lines and kids' shops are left out.
const KIDS = /(^|[^\p{L}])(kids?|kid's|baby|babies|bebe|bébé|junior|infant|toddler|enfant|bambini|niños|kinder|детск\p{L}*|малыш\p{L}*)($|[^\p{L}])/iu;
function acceptable(n) {
  const k = key(n);
  if (KIDS.test(n)) return false;
  return k.length >= 2 && n.length <= 40 && !/^Q\d+$/.test(n) && !NOT_A_BRAND.test(n) && !DENY.has(k) && !/^\d+$/.test(k);
}
function add(name, score, rank, aliases = []) {
  const k = key(name);
  const target = brands.get(k) ? k : aliasOf.get(k);
  const entry = target && brands.get(target);
  if (entry) {
    // Duplicates (a company and its label, a shop chain and its brand) confirm a brand but are not summed,
    // so a label with many Wikidata items does not outrank the hand-picked order.
    entry.score = Math.max(entry.score, score) + 5;
    for (const a of aliases) addAlias(target, a);
    return;
  }
  brands.set(k, { name, score, rank, aliases: new Set() });
  for (const a of aliases) addAlias(k, a);
}
function addAlias(canonical, alias) {
  const a = alias.trim();
  const ak = key(a);
  if (!ak || ak === canonical || brands.has(ak) || aliasOf.has(ak)) return;
  aliasOf.set(ak, canonical);
  brands.get(canonical).aliases.add(a.toLowerCase());
}

// 1. Curated list: order inside the top tier matters (earlier = more common).
let tier = 'normal';
let pos = 0;
for (const line of read('curated.txt').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  if (t.startsWith('@')) {
    tier = t.slice(1);
    pos = 0;
    continue;
  }
  const [name, aliases = ''] = t.split('|').map((s) => s.trim());
  add(name, tiers[tier] - (tier === 'top' ? pos * 2 : 0), 0, aliases.split(',').filter(Boolean));
  pos++;
}

// 2. OpenStreetMap shop brands: names as they are written on shop signs.
const tsv = (f) => {
  const [head, ...rows] = read(f).trim().split(/\r?\n/);
  const cols = head.split('\t');
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v])));
};
const wikidataSeen = new Set();
for (const r of tsv('nsi.tsv')) {
  const name = clean(r.name);
  if (!acceptable(name) || /[^\u0000-ɏЀ-ӿ0-9°]/.test(name)) continue; // eslint-disable-line no-control-regex
  add(name, 40, 1, r.ru && r.ru !== name ? [r.ru] : []);
  if (r.wikidata) wikidataSeen.add(r.wikidata);
}

// 3. Wikidata: sitelinks (number of Wikipedia articles) is a fair proxy for how known a label is.
const ruOk = (s) => s && /[а-я]/i.test(s) && s.split(' ').length <= 3 && !/(марка|компания|дом моды|бренд|фирма)/i.test(s);
for (const r of tsv('wikidata.tsv')) {
  const name = clean(r.en || r.ru || '');
  // Lower-case English labels are concepts ("cobbler", "fashion"), not brands.
  if (/^[a-z]/.test(name)) continue;
  if (!acceptable(name) || /[^\u0000-ɏЀ-ӿ0-9°]/.test(name)) continue; // eslint-disable-line no-control-regex
  const ru = clean(r.ru || '');
  const bonus = wikidataSeen.has(r.id) ? 20 : 0;
  add(name, Math.min(Number(r.sitelinks) || 0, 80) * 3 + 10 + bonus, 2, ruOk(ru) && ru !== name ? [ru] : []);
}

const list = [...brands.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
const esc = (s) => s.replace(/[|;\n\\`$]/g, ' ').trim();
const lines = list.map((b) => [esc(b.name), Math.round(b.score), [...b.aliases].map(esc).join(';')].join('|').replace(/\|$/, ''));

const out = `// Generated by scripts/brands/build.mjs from Wikidata (CC0), OpenStreetMap name-suggestion-index (BSD-3)
// and a hand-picked list. Do not edit by hand: change scripts/brands/sources and rebuild.
// Format: one brand per line, "Name|score|alias;alias", sorted by score.
export const BRAND_DATA = \`${lines.join('\n')}\`;
`;
fs.writeFileSync(path.join(here, '../../src/catalog/brands.data.ts'), out);
console.log(`${list.length} brands, ${aliasOf.size} aliases, ${(out.length / 1024).toFixed(0)} KB`);
