/**
 * Deterministic text rules shared by listing moderation and chat antifraud. They run before (and
 * independently of) the AI ensemble, so obvious cases are caught instantly and even with no provider up.
 */

// ---------- normalisation ----------

/**
 * JS `\b` and `\w` are ASCII-only, so they never match around Cyrillic words. U() rewrites a pattern
 * to Unicode-aware word boundaries / word characters.
 */
const W = String.raw`[\p{L}\p{N}_]`;
const U = (re: RegExp, flags = re.flags) =>
  new RegExp(
    re.source.replaceAll(String.raw`\b`, `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`).replaceAll(String.raw`\w`, W),
    [...new Set(`${flags}u`)].join(''),
  );

const LOOKALIKES: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а', u: 'и' };

/** Lower-case, ё→е, Latin look-alikes → Cyrillic, glued single letters ("х у й", "х.у.й") joined. */
function normalizeForProfanity(text: string): string[] {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  const tokens = lower.split(/\s+/).filter(Boolean);
  const merged: string[] = [];
  let run = '';
  for (const t of tokens) {
    const letters = t.replace(/[.\-_,!?]/g, '');
    if ([...letters].length === 1) {
      run += letters;
      continue;
    }
    if (run) {
      merged.push(run);
      run = '';
    }
    merged.push(letters);
  }
  if (run) merged.push(run);
  return merged.map((w) => (/[а-я]/.test(w) ? [...w].map((ch) => LOOKALIKES[ch] ?? ch).join('') : w));
}

// ---------- profanity ----------

// Roots anchored at the word start (with common prefixes) to avoid "рубля", "страхуй", "худи", "оскорблять".
const PROFANITY = [
  /^(?:на|по|от|за|ни|до|вы|при|об|раз|с|о|а|у|из|пере)?ху[йеиюя]/,
  /пизд/,
  /^(?:вы|за|на|по|от|раз|у|съ|до|при|про)?[е]б(?:а[лнтшк]|у[тч]?$|ан|ен|ин|ну|ош|ись|ло|ля|ыр)/,
  /^бля(?:д|ть|т$|$)/,
  /^сук(?:а|и|е|у|ой)$/,
  /^муда[кч]/,
  /^пид[оа]р/,
  /^залуп/,
  /^долбо[е]?[её]?б/,
  /^гандон/,
  /^шлюх/,
  /^дроч/,
  /^херн/,
  /^(?:fuck|shit|bitch|cunt|dick)/,
];
const MASKED_WORDS = ['хуй', 'хуя', 'хуе', 'нахуй', 'пизда', 'пиздец', 'блять', 'блядь', 'ебать', 'сука'];

export function hasProfanity(text: string): boolean {
  for (const w of normalizeForProfanity(text)) {
    if (PROFANITY.some((re) => re.test(w))) return true;
    // "х*й", "п**да": a star stands for any letter.
    if (w.includes('*') && w.length >= 3) {
      const re = new RegExp(`^${w.replace(/[^а-яa-z*]/g, '').replace(/\*/g, '.')}$`);
      if (MASKED_WORDS.some((m) => re.test(m))) return true;
    }
  }
  return false;
}

// ---------- contacts / links ----------

const PHONE = /(?:\+?\s*375|\b8\s*0)[\s()-]*(?:17|25|29|33|44)[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|(?:\+?\d[\s()-]{0,2}){10,}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]{1,62}\.(?:by|ru|com|net|org|me|io|su|ua|kz|shop|store|site|online|link|ly|cc|xyz|top|pro|info|biz|app|page)\b(?:\/\S*)?/gi;
const MESSENGER = U(/\bt\.me\b|\bwa\.me\b|\bvk\.com\b|телеграм|телег[аеиу]\b|\bтг\b|\btg\b|telegram|вайбер|viber|ватсап|вотсап|вацап|whatsapp|инстаграм|instagram|\bинст[аеуы]?\b|\binsta?\b|\bвк\b|\bв личку\b|\bв лс\b|\bпишите в\b|\bзвоните\b/i);
const HANDLE = /(?:^|\s)@[a-z0-9_]{4,}/i;

export interface ContactHit {
  kind: 'phone' | 'email' | 'link' | 'messenger' | 'handle';
  match: string;
}

export function findContacts(text: string): ContactHit[] {
  const hits: ContactHit[] = [];
  const phone = text.match(PHONE);
  if (phone) hits.push({ kind: 'phone', match: phone[0] });
  const email = text.match(EMAIL);
  if (email) hits.push({ kind: 'email', match: email[0] });
  for (const m of text.match(URL) ?? []) hits.push({ kind: 'link', match: m });
  const messenger = text.match(MESSENGER);
  if (messenger) hits.push({ kind: 'messenger', match: messenger[0] });
  const handle = text.match(HANDLE);
  if (handle && !email) hits.push({ kind: 'handle', match: handle[0].trim() });
  return hits;
}

const findLinks = (text: string) => text.match(URL) ?? [];

// ---------- gibberish / "is this an item" ----------

const KEYBOARD_RUNS = ['йцук', 'цуке', 'укен', 'кенг', 'фыва', 'ывап', 'вапр', 'апро', 'ячсм', 'чсми', 'qwer', 'wert', 'erty', 'asdf', 'sdfg', 'dfgh', 'zxcv', 'xcvb'];
const VOWELS = /[аеёиоуыэюяaeiouy]/g;

/** Keyboard mashing, repeated letters, no real words. */
export function isGibberish(text: string): boolean {
  const lower = text.toLowerCase();
  const letters = lower.replace(/[^a-zа-яё]/g, '');
  if (letters.length < 3) return true;
  if (/(.)\1{3,}/.test(letters)) return true;
  if (KEYBOARD_RUNS.some((r) => letters.includes(r))) return true;
  const words = lower.split(/[^a-zа-яё]+/).filter((w) => w.length >= 2);
  if (!words.some((w) => w.length >= 3)) return true;
  const long = words.filter((w) => w.length >= 5);
  const bad = long.filter((w) => (w.match(VOWELS)?.length ?? 0) / w.length < 0.15 || /[бвгджзйклмнпрстфхцчшщ]{6,}|[bcdfghjklmnpqrstvwxz]{6,}/.test(w));
  return long.length > 0 && bad.length / long.length > 0.5;
}

/** Stems of wearable item names (RU + EN). A title without any of them is not obviously an item. */
const ITEM_STEMS = [
  'куртк', 'курточк', 'пальт', 'пуховик', 'тренч', 'плащ', 'жилет', 'футболк', 'лонгслив', 'майк', 'поло', 'рубашк', 'рубах', 'блуз', 'овершот', 'свитер', 'худи', 'толстовк', 'свитшот',
  'кардиган', 'брюк', 'штан', 'карго', 'джоггер', 'джинс', 'шорт', 'юбк', 'плать', 'сарафан', 'комбинезон', 'костюм', 'пиджак', 'жакет', 'блейзер', 'кроссов', 'кед', 'ботин', 'туфл', 'сандал',
  'лофер', 'сапог', 'сапожк', 'ботфорт', 'челси', 'мокасин', 'слипон', 'балетк', 'босонож', 'мюли', 'сабо', 'шлепан', 'сланц', 'угги', 'бутс', 'сумк', 'сумочк', 'рюкзак', 'шоппер', 'кросс-боди', 'клатч',
  'портфел', 'кошел', 'шапк', 'кепк', 'панам', 'бейсболк', 'берет', 'шляп', 'шарф', 'платок', 'палантин', 'снуд', 'ремен', 'ремн', 'пояс', 'украшен', 'серьг', 'серёж', 'сереж', 'кольц', 'браслет',
  'цепочк', 'колье', 'подвеск', 'кулон', 'бусы', 'очк', 'перчатк', 'варежк', 'галстук', 'бабочк', 'носк', 'топ', 'водолазк', 'джемпер', 'пуловер', 'бомбер', 'ветровк', 'парк', 'анорак', 'косух',
  'дублен', 'шуб', 'туник', 'леггинс', 'лосин', 'легинс', 'боди', 'корсет', 'халат', 'пижам', 'купальн', 'кофт', 'кофточк', 'олимпийк', 'жилетк', 'часы', 'часик', 'визитниц', 'тапк', 'тапоч',
  'jacket', 'coat', 'parka', 'puffer', 'trench', 'vest', 'shirt', 'tee', 't-shirt', 'tshirt', 'polo', 'blouse', 'sweater', 'hoodie', 'sweatshirt', 'cardigan', 'trousers', 'pants', 'cargo', 'jogger',
  'jeans', 'denim', 'shorts', 'skirt', 'dress', 'jumpsuit', 'suit', 'blazer', 'sneaker', 'trainer', 'boot', 'shoe', 'sandal', 'loafer', 'heels', 'bag', 'backpack', 'tote', 'crossbody', 'clutch',
  'wallet', 'hat', 'cap', 'beanie', 'scarf', 'belt', 'ring', 'necklace', 'bracelet', 'earring', 'glasses', 'sunglasses', 'gloves', 'tie', 'socks', 'top', 'jumper', 'pullover', 'bomber', 'windbreaker',
  'anorak', 'leggings', 'bodysuit', 'watch',
];

export function mentionsItem(text: string): boolean {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  return lower.split(/[^a-zа-я-]+/).some((w) => w.length >= 2 && ITEM_STEMS.some((s) => w.startsWith(s)));
}

// ---------- prohibited goods / counterfeit ----------

const PROHIBITED = U(/оружи|пистолет|револьвер|травмат|патрон|кастет|электрошок|наркот|марихуан|канабис|каннабис|\bвейп|электронн\w* сигарет|\bснюс|алкогол|\bводк|лекарств|таблетк|рецептурн|\bгаз(?:овый)? баллон/i);
const COUNTERFEIT_STRONG = U(/реплик|replica|\b1\s*[:к]\s*1\b|люкс\s*копи|lux\s*copy|не\s*оригинал|копия\s*бренд|\bпалён|\bпален/i);
const COUNTERFEIT_WEAK = U(/\bкопи[яи]\b|\bпаль\b|\bфейк|\bfake\b|\bлюкс\b/i);

export const mentionsProhibited = (text: string) => PROHIBITED.test(text);
export const counterfeitSignal = (text: string): 'strong' | 'weak' | null => (COUNTERFEIT_STRONG.test(text) ? 'strong' : COUNTERFEIT_WEAK.test(text) ? 'weak' : null);

// ---------- chat fraud signals ----------

/** Payment card numbers (Luhn-valid, 13–19 digits). */
function findCardNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(/(?:\d[ -]?){12,18}\d/g) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) out.push(m);
  }
  return out;
}

/** Replaces card numbers with "•••• 1234" before the message is stored. */
export function maskCardNumbers(text: string): { text: string; masked: boolean } {
  const cards = findCardNumbers(text);
  let out = text;
  for (const c of cards) out = out.replace(c, `•••• ${c.replace(/\D/g, '').slice(-4)}`);
  return { text: out, masked: cards.length > 0 };
}

export type FraudCategory = 'prepayment' | 'phishing_link' | 'off_platform' | 'card_data' | 'sms_code' | 'fake_delivery' | 'pressure' | 'impersonation' | 'other';

const SHORTENERS = /\b(?:bit\.ly|clck\.ru|tinyurl\.com|cutt\.ly|goo\.su|is\.gd|t\.ly|u\.to|vk\.cc|shorturl\.at|rb\.gy)\b/i;
const OFFICIAL_DOMAINS = ['kufar.by', 'onliner.by', 'belpost.by', 'evropochta.by', 'cdek.by', 'boxberry.by', 'autolight.by', 'dpd.by'];
const BRAND_IN_DOMAIN = /evro|euro|europ|belpost|bel-post|kufar|onliner|cdek|sdek|boxberry|avito|olx|dostav|delivery|oplat|payment|pay-|-pay|safe|secure|bezopas|garant|sdelka|deal/i;

const RULES: Array<{ re: RegExp; category: FraudCategory; weight: number }> = [
  { re: U(/cvv|cvc|cvс|три цифры (?:на|с) обороте|срок действия карты|данные (?:вашей |своей )?карты|реквизиты карты/i), category: 'card_data', weight: 3 },
  { re: U(/код из (?:смс|sms|сообщения)|(?:продиктуй|назови|скажи|скинь|пришли|сообщи)\w* код|код подтверждения/i), category: 'sms_code', weight: 3 },
  { re: U(/безопасн\w* сделк|гарант\w* сделк|оплат\w* по ссылке|ссылк\w* (?:на|для) оплат|получи\w* (?:деньги|оплату|средства) по ссылке|форм\w* (?:для )?получени\w* (?:денег|оплаты)/i), category: 'phishing_link', weight: 3 },
  { re: U(/оформ\w* доставк\w* по ссылке|курьер\w* (?:сам )?заберет.*ссылк|доставк\w* через (?:сайт|ссылку)/i), category: 'fake_delivery', weight: 3 },
  { re: U(/предоплат|переведи\w*|перевод\w* на карт|скинь\w* (?:деньги|денег|на карту)|кин\w* на карт|задат(?:ок|ка)|оплат\w* на карт|на номер карты/i), category: 'prepayment', weight: 2 },
  { re: U(/телеграм|телег[аеиу]\b|\bтг\b|telegram|вайбер|viber|ватсап|вотсап|вацап|whatsapp|\bt\.me\b|\bwa\.me\b|\bпиши\w* (?:мне )?в (?:лс|личку)/i), category: 'off_platform', weight: 1 },
  { re: U(/срочно|только сегодня|прямо сейчас|иначе (?:продам|отдам)|последний шанс/i), category: 'pressure', weight: 1 },
  { re: U(/служб\w* (?:безопасности|поддержки)|администраци\w* (?:сайта|площадки)|модератор\w* (?:сайта|площадки)|представител\w* банка/i), category: 'impersonation', weight: 2 },
];

export interface FraudSignals {
  score: number;
  categories: FraudCategory[];
  links: string[];
  phone: boolean;
  cards: number;
  /** Strong evidence on its own (phishing link, SMS code / card data request). */
  certain: boolean;
}

export function fraudSignals(text: string): FraudSignals {
  const categories = new Set<FraudCategory>();
  let score = 0;
  let certain = false;
  for (const r of RULES) {
    if (r.re.test(text)) {
      categories.add(r.category);
      score += r.weight;
      if (r.weight >= 3) certain = true;
    }
  }
  const links = findLinks(text);
  for (const link of links) {
    const host = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
    const official = OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
    if (SHORTENERS.test(host) || (!official && BRAND_IN_DOMAIN.test(host))) {
      categories.add('phishing_link');
      score += 3;
      certain = true;
    } else if (!official) {
      score += 1;
    }
  }
  // Card numbers would also look like long phone numbers.
  let withoutCards = text;
  for (const c of findCardNumbers(text)) withoutCards = withoutCards.replace(c, ' ');
  const phone = PHONE.test(withoutCards);
  if (phone) {
    categories.add('off_platform');
    score += 1;
  }
  const cards = findCardNumbers(text).length;
  if (cards) {
    categories.add('prepayment');
    score += 2;
  }
  return { score, categories: [...categories], links, phone, cards, certain };
}
