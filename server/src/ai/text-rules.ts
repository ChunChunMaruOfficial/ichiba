import { knownBrand } from '../catalog/brands.js';

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
];
/**
 * English words are matched whole (with their obvious forms): a prefix match took «Dickies 874» and «Dickson» for
 * swearing. Words that are themselves brands in the catalogue are never checked.
 */
const PROFANITY_EN = /^(?:fuck(?:s|ed|er|ers|ing|in)?|shit(?:s|ty)?|bullshit|bitch(?:es|y)?|cunts?|dick(?:s|head|heads)?)$/;
const MASKED_WORDS = ['хуй', 'хуя', 'хуе', 'нахуй', 'пизда', 'пиздец', 'блять', 'блядь', 'ебать', 'сука'];

export function hasProfanity(text: string): boolean {
  // A brand field holding a catalogue brand («Fucking Awesome» is a skate brand) is a name, not a word.
  if (knownBrand(text.trim())) return false;
  for (const w of normalizeForProfanity(text)) {
    if (PROFANITY.some((re) => re.test(w))) return true;
    if (PROFANITY_EN.test(w) && !knownBrand(w)) return true;
    // "х*й", "п**да": a star stands for any letter.
    if (w.includes('*') && w.length >= 3) {
      const re = new RegExp(`^${w.replace(/[^а-яa-z*]/g, '').replace(/\*/g, '.')}$`);
      if (MASKED_WORDS.some((m) => re.test(m))) return true;
    }
  }
  return false;
}

// ---------- contacts / links ----------

/**
 * A phone number: a Belarusian one (+375 / 80 and an operator code), any number written with a leading «+», or digits
 * right after a phone word. Just ten digits in a row is not enough: «Замеры 52 55 70 61 24 см» is a size list.
 */
const PHONE = U(
  /(?:\+?\s*375|\b8\s*0)[\s()-]*(?:17|25|29|33|44)[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|\+\s*\d(?:[\s()-]{0,2}\d){9,}|(?:\bтел|\bтелефон|\bзвон\w*|\bмоб\w*|\bphone|\btel)\b\W{0,15}(?:\d[\s()-]{0,2}){7,}/i,
);
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

// ---------- hiding contacts in chat ----------

/** Digits written as words: «восемь ноль двадцать девять…». Tens and a following unit add up («двадцать девять» → 29). */
const UNITS: Record<string, number> = { ноль: 0, нуль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9 };
const TEENS: Record<string, number> = { десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19 };
const TENS: Record<string, number> = { двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90 };
const NUMBER_WORD = [...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS)].join('|');
/** A run of digits and number words with separators between them, at least seven pieces long. */
const NUMBER_RUN = U(new RegExp(String.raw`(?:\+\s*)?(?:(?:\d+|(?:${NUMBER_WORD})\b)[\s.,()\-–—/]*){7,}`, 'gi'));

/** The digits a run spells out: «восемь ноль 29» → «8029». */
function spelledDigits(run: string): string {
  let out = '';
  let tens: number | null = null;
  const flush = () => {
    if (tens != null) out += String(tens);
    tens = null;
  };
  for (const piece of run.toLowerCase().match(new RegExp(String.raw`\d+|[а-яё]+`, 'g')) ?? []) {
    if (/^\d+$/.test(piece)) {
      flush();
      out += piece;
    } else if (piece in TENS) {
      flush();
      tens = TENS[piece];
    } else if (piece in UNITS) {
      out += tens != null ? String(tens + UNITS[piece]) : String(UNITS[piece]);
      tens = null;
    } else if (piece in TEENS) {
      flush();
      out += String(TEENS[piece]);
    }
  }
  flush();
  return out;
}

/**
 * A phone number once only its digits are left: a Belarusian one (375 / 80 and an operator code) or a Russian mobile
 * (7 / 8 and 9…). Any other run counts only with a leading «+»: «70 61 52 48 …» is a list of sizes.
 */
const isPhoneDigits = (digits: string, plus: boolean) =>
  /^(?:375|80)(?:17|25|29|33|44)\d{7}$/.test(digits) || /^[78]9\d{9}$/.test(digits) || (plus && /^\d{10,15}$/.test(digits));

const PHONE_G = new RegExp(PHONE.source, `${PHONE.flags}g`);
const EMAIL_G = new RegExp(EMAIL.source, 'gi');
/** t.me/name, «t . me / name», wa.me/…, vk.com/…: the one-letter domains the generic link pattern doesn't cover. */
const SHORT_LINK = /\b(?:t|wa)\s*[.,]\s*me\s*\/\s*[\w+]+|\bvk\s*[.,]\s*com\s*\/\s*[\w.]+|\binstagram\s*[.,]\s*com\s*\/\s*[\w.]+/gi;
/** A name right after a messenger word: «тг mirar_wear», «инст: nenet.store», «телеграм @shop». */
const NAME_AFTER_MESSENGER = U(/(\b(?:тг|tg|телеграм\w*|телег[аеиу]|telegram|инст[аеуы]?|инстаграм\w*|insta|instagram|вайбер\w*|viber|ватсап\w*|вотсап\w*|whatsapp|ник)\b\s*[:\-–—]?\s*)@?([a-z][a-z0-9_.]{3,})/gi);
const HANDLE_G = /(^|\s)@[a-z0-9_]{4,}/gi;

export type ContactKind = ContactHit['kind'];

/**
 * Removes contacts from a chat message before it is stored: phone numbers (also spelled out in words or split by
 * spaces), e-mails, links, @names and names after a messenger word. The other side sees the message without them,
 * with no mark where they were. Links to our own site and to delivery services (a tracking page) stay. Returns the
 * text to store (possibly empty) and which kinds were removed.
 */
export function hideContacts(text: string, allowedHosts: string[] = []): { text: string; hidden: ContactKind[] } {
  const hidden = new Set<ContactKind>();
  const allowed = [...allowedHosts, ...OFFICIAL_DOMAINS];
  let out = text;
  out = out.replace(EMAIL_G, () => (hidden.add('email'), ''));
  out = out.replace(URL, (link) => {
    const host = link.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
    if (allowed.some((d) => host === d || host.endsWith(`.${d}`))) return link;
    hidden.add('link');
    return '';
  });
  out = out.replace(SHORT_LINK, () => (hidden.add('link'), ''));
  // «звоните 8029…»: the phone word in front of the number stays, only the number goes.
  out = out.replace(PHONE_G, (m) => (hidden.add('phone'), m.match(/^\p{L}[^\d+]*/u)?.[0] ?? ''));
  out = out.replace(NUMBER_RUN, (run) => {
    const digits = spelledDigits(run);
    if (!isPhoneDigits(digits, run.trimStart().startsWith('+'))) return run;
    hidden.add('phone');
    // Keep the separator the run swallowed, so the next word doesn't stick to the previous one.
    return /\s$/.test(run) ? ' ' : '';
  });
  out = out.replace(NAME_AFTER_MESSENGER, (_m, word: string) => (hidden.add('handle'), word));
  out = out.replace(HANDLE_G, (_m, lead: string) => (hidden.add('handle'), lead));
  if (!hidden.size) return { text, hidden: [] };
  // What a removed contact leaves behind: double spaces, a space before punctuation, empty lines.
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?:;])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, hidden: [...hidden] };
}

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
  'дублен', 'шуб', 'туник', 'леггинс', 'лосин', 'легинс', 'боди', 'корсет', 'халат', 'пижам', 'купальн', 'кофт', 'кофточк', 'олимпийк', 'жилетк', 'часы', 'часик', 'визитниц', 'тапк', 'тапоч', 'брелок', 'брелк',
  'jacket', 'coat', 'parka', 'puffer', 'trench', 'vest', 'shirt', 'tee', 't-shirt', 'tshirt', 'polo', 'blouse', 'sweater', 'hoodie', 'sweatshirt', 'cardigan', 'trousers', 'pants', 'cargo', 'jogger',
  'jeans', 'denim', 'shorts', 'skirt', 'dress', 'jumpsuit', 'suit', 'blazer', 'sneaker', 'trainer', 'boot', 'shoe', 'sandal', 'loafer', 'heels', 'bag', 'backpack', 'tote', 'crossbody', 'clutch',
  'wallet', 'hat', 'cap', 'beanie', 'scarf', 'belt', 'ring', 'necklace', 'bracelet', 'earring', 'glasses', 'sunglasses', 'gloves', 'tie', 'socks', 'top', 'jumper', 'pullover', 'bomber', 'windbreaker',
  'anorak', 'leggings', 'bodysuit', 'watch', 'keychain',
];

export function mentionsItem(text: string): boolean {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  // «зип-худи», «t-shirt»: the whole word and each of its parts count.
  const words = lower.split(/[^a-zа-я-]+/).flatMap((w) => [w, ...(w.includes('-') ? w.split('-') : [])]);
  return words.some((w) => w.length >= 2 && ITEM_STEMS.some((s) => w.startsWith(s)));
}

// ---------- prohibited goods / counterfeit ----------

const PROHIBITED = U(/оружи|пистолет|револьвер|травмат|патрон|кастет|электрошок|наркот|марихуан|канабис|каннабис|\bвейп|электронн\w* сигарет|\bснюс|алкогол|\bводк|лекарств|таблетк|рецептурн|\bгаз(?:овый)? баллон/i);
const COUNTERFEIT_STRONG = U(/реплик|replica|\b1\s*[:к]\s*1\b|люкс\s*копи|lux\s*copy|не\s*оригинал|копия\s*бренд|\bпалён|\bпален/i);
const COUNTERFEIT_WEAK = U(/\bкопи[яи]\b|\bпаль\b|\bфейк|\bfake\b|\bлюкс\b/i);

export const mentionsProhibited = (text: string) => PROHIBITED.test(text);

/**
 * Text that talks to the moderating model («system: …», «ignore …», «модератор, верни allow»): user data trying to
 * steer the verdict. Such a listing is never allowed automatically; a person looks at it.
 */
const INJECTION = /(систем|инструкц|ignore|модератор|assistant)\W.{0,40}(true|false|risk|allow)/i;
export const looksLikeInjection = (text: string) => INJECTION.test(text);
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
const OFFICIAL_DOMAINS = ['kufar.by', 'onliner.by', 'belpost.by', 'evropochta.by', 'cdek.by', 'boxberry.by', 'autolight.by', 'dpd.by', 'e-dostavka.by', 'edostavka.by', 'euroopt.by'];
/**
 * Words a fake «delivery / safe deal» site puts in its name (kufar-dostavka.online, evropochta-by.site). Matched
 * against whole labels of the host (split on «.» and «-»): as substrings they also hit real shops (euroopt.by,
 * e-dostavka.by). A match is a strong signal, not proof — only link shorteners are certain on their own.
 */
const BRAND_LABELS = new Set([
  'evro', 'euro', 'europ', 'evropochta', 'europochta', 'belpost', 'belpochta', 'kufar', 'onliner', 'cdek', 'sdek', 'boxberry', 'avito', 'olx',
  'dostavka', 'dostavki', 'delivery', 'oplata', 'oplaty', 'payment', 'payments', 'pay', 'safe', 'secure', 'bezopasno', 'bezopasnaya', 'garant', 'sdelka', 'deal', 'safedeal',
]);
const brandInDomain = (host: string) => host.split(/[.-]/).some((label) => BRAND_LABELS.has(label));

const RULES: Array<{ re: RegExp; category: FraudCategory; weight: number }> = [
  { re: U(/cvv|cvc|cvс|три цифры (?:на|с) обороте|срок действия карты|данные (?:вашей |своей )?карты|реквизиты карты/i), category: 'card_data', weight: 3 },
  { re: U(/код из (?:смс|sms|сообщения)|(?:продиктуй|назови|скажи|скинь|пришли|сообщи)\w* код|код подтверждения/i), category: 'sms_code', weight: 3 },
  { re: U(/безопасн\w* сделк|гарант\w* сделк|оплат\w* по ссылке|ссылк\w* (?:на|для) оплат|получи\w* (?:деньги|оплату|средства) по ссылке|форм\w* (?:для )?получени\w* (?:денег|оплаты)/i), category: 'phishing_link', weight: 3 },
  { re: U(/оформ\w* доставк\w* по ссылке|курьер\w* (?:сам )?заберет.*ссылк|доставк\w* через (?:сайт|ссылку)/i), category: 'fake_delivery', weight: 3 },
  { re: U(/предоплат|переведи\w*|перевод\w* на карт|скинь\w* (?:деньги|денег|на карту)|кин\w* на карт|задат(?:ок|ка)|оплат\w* на карт|на номер карты/i), category: 'prepayment', weight: 2 },
  { re: U(/телеграм|телег[аеиу]\b|\bтг\b|telegram|вайбер|viber|ватсап|вотсап|вацап|whatsapp|инстаграм|instagram|\bинст[аеуы]?\b|\binsta\b|\bt\.me\b|\bwa\.me\b|\bпиши\w* (?:мне )?в (?:лс|личку)/i), category: 'off_platform', weight: 1 },
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
    if (SHORTENERS.test(host)) {
      categories.add('phishing_link');
      score += 3;
      certain = true;
    } else if (!official && brandInDomain(host)) {
      categories.add('phishing_link');
      score += 3;
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
