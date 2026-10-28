"""
Сбор, проверка и приоритизация белорусских брендов одежды для ichiba.by.

Шаги (каждый можно запускать отдельно, `all` — всё подряд):
  ingest    — свести найденные бренды из data/seeds/*.json в мастер-базу data/brands.json
              (повторный запуск не плодит дубли: склейка по домену, Instagram, Telegram и названию)
  discover  — обойти страницы-подборки из data/seeds/source_pages.txt и выписать новых кандидатов
              (ссылки на Instagram/Telegram/сайты, которых ещё нет в базе) в data/leads_discovered.csv
  verify    — проверить сайты (доступность, email/телефон/соцсети на официальных страницах)
              и публичные Telegram-каналы (название, подписчики, дата последнего поста)
  score     — оценка 0–100 и группы A/B/C (критерии — в SCORING.md)
  export    — CSV и XLSX: основная база, доп. проверка, исключённые, топ-20, CRM, источники

Instagram и TikTok скрипт не открывает: их правила запрещают автоматический сбор. Ссылки на них
берутся с официальных сайтов брендов (это и есть подтверждение) или из seed-файлов с указанием источника.

Запуск:  python brand-acquisition/scripts/pipeline.py all
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.robotparser
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SEEDS = DATA / "seeds"
CACHE = DATA / "cache"
DB_PATH = DATA / "brands.json"
CRM_PATH = DATA / "crm.csv"
OVERRIDES_PATH = DATA / "overrides.json"
CORRECTIONS_PATH = DATA / "corrections.json"
TOP_PATH = DATA / "top20.json"
LEADS_PATH = DATA / "leads_discovered.csv"
OUT = ROOT / "output"

UA = "IchibaBrandResearch/1.0 (+https://ichiba.by; partner search, contact: c4erkaoui@gmail.com)"
TODAY = dt.date.today().isoformat()
CACHE_DAYS = 7
PER_HOST_DELAY = 1.5  # секунд между запросами к одному хосту

# Сети, которые не открываем автоматически (запрет в правилах/robots.txt).
NO_FETCH_HOSTS = ("instagram.com", "tiktok.com", "facebook.com", "vk.com", "ok.ru")

# Поля мастер-базы, которые приходят из seed-файлов.
SEED_FIELDS = [
    "name", "aliases", "category", "style", "gender", "description", "city", "website", "instagram", "tiktok",
    "telegram", "other_socials", "email", "contact_form", "phone", "contact_sources", "own_product_status",
    "own_product_evidence", "own_product_evidence_url", "sales_channels", "scale_estimate", "scale_basis",
    "followers", "last_activity", "last_activity_source", "found_via", "found_via_url", "notes", "unverified",
    "exclude_reason", "hook", "why_ichiba", "flags",
]

# ---------------------------------------------------------------- нормализация

def norm_text(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().replace("ё", "е")
    return re.sub(r"[^0-9a-zа-я]+", "", s)


def norm_url(u: str | None) -> str | None:
    if not u or not isinstance(u, str):
        return None
    u = u.strip()
    if not u or u.lower() in {"null", "none", "-"}:
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", u, re.I):
        u = "https://" + u.lstrip("/")
    p = urllib.parse.urlsplit(u)
    host = p.netloc.lower().removeprefix("www.").removeprefix("m.")
    path = re.sub(r"/+$", "", p.path)
    return urllib.parse.urlunsplit(("https", host, path, p.query, ""))


def domain(u: str | None) -> str | None:
    u = norm_url(u)
    return urllib.parse.urlsplit(u).netloc if u else None


SOCIAL_PATTERNS = {
    "instagram": re.compile(r"instagram\.com/(?!p/|reel/|explore/|stories/|accounts/)([A-Za-z0-9_.]{2,30})", re.I),
    "tiktok": re.compile(r"tiktok\.com/@([A-Za-z0-9_.]{2,30})", re.I),
    "telegram": re.compile(r"(?:t\.me|telegram\.me)/(?:s/)?(?!joinchat|share|\+)([A-Za-z0-9_]{4,32})", re.I),
}


def handle(net: str, u: str | None) -> str | None:
    if not u:
        return None
    if net in ("instagram", "tiktok", "telegram") and re.fullmatch(r"@?[A-Za-z0-9_.]{2,32}", u.strip()):
        return u.strip().lstrip("@").lower()
    m = SOCIAL_PATTERNS[net].search(u)
    return m.group(1).lower().rstrip(".") if m else None


def social_url(net: str, h: str | None) -> str | None:
    if not h:
        return None
    return {"instagram": f"https://instagram.com/{h}", "tiktok": f"https://tiktok.com/@{h}", "telegram": f"https://t.me/{h}"}[net]


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
EMAIL_JUNK = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js)$|example\.|sentry|wixpress|@2x|domain\.|yourmail|email\.com$", re.I)
# Белорусские номера: +375 (29) 123-45-67, 8 029 123 45 67, 8017...
PHONE_RE = re.compile(r"(?:\+?375|\b8\s*0)[\s\-()]*(?:17|25|29|33|44|15\d|16\d|21\d|22\d|23\d|80\d)[\s\-()]*\d{1,3}[\s\-]?\d{2}[\s\-]?\d{2}\b")


def norm_phone(p: str | None) -> str | None:
    if not p:
        return None
    d = re.sub(r"\D", "", p)
    if d.startswith("80") and len(d) == 11:
        d = "375" + d[2:]
    if d.startswith("375") and len(d) == 12:
        return f"+375 {d[3:5]} {d[5:8]}-{d[8:10]}-{d[10:]}"
    return p.strip() or None


def clean_email(e: str | None) -> str | None:
    if not e or not isinstance(e, str):
        return None
    e = e.strip().lower().removeprefix("mailto:").split("?")[0]
    return e if EMAIL_RE.fullmatch(e) and not EMAIL_JUNK.search(e) else None


def as_list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]

# ---------------------------------------------------------------- хранилище

def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def keys_of(b: dict) -> set[str]:
    """Признаки, по которым две записи считаются одним брендом."""
    ks = set()
    d = domain(b.get("website"))
    if d and not any(s in d for s in ("instagram.com", "t.me", "taplink", "linktr.ee", "wildberries", "ozon", "lamoda", "vk.com", "tilda.ws")):
        ks.add("d:" + d)
    for net in ("instagram", "telegram", "tiktok"):
        h = handle(net, b.get(net))
        if h:
            ks.add(f"{net[:2]}:{h}")
    n = norm_text(b.get("name"))
    if len(n) >= 3:
        ks.add("n:" + n)
    for a in as_list(b.get("aliases")):
        a = norm_text(a)
        if len(a) >= 4:
            ks.add("n:" + a)
    return ks


def brand_id(b: dict) -> str:
    base = norm_text(b.get("name")) or "brand"
    base = re.sub(r"[^a-z0-9а-я]", "", base)[:24]
    tail = hashlib.sha1((domain(b.get("website")) or handle("instagram", b.get("instagram")) or base).encode()).hexdigest()[:6]
    return f"{base}-{tail}"


def merge_into(dst: dict, src: dict, source_file: str):
    """Дополняет запись: пустые поля заполняются, списки объединяются; заполненные поля не перетираются,
    расхождения пишутся в conflicts — разбирает человек."""
    for f in SEED_FIELDS:
        v = src.get(f)
        if v in (None, "", [], {}):
            continue
        cur = dst.get(f)
        if cur in (None, "", [], {}):
            dst[f] = v
        elif isinstance(cur, list):
            dst[f] = cur + [x for x in as_list(v) if x not in cur]
        elif isinstance(cur, dict) and isinstance(v, dict):
            for k, x in v.items():
                cur.setdefault(k, x)
        elif f in ("website", "instagram", "telegram", "tiktok", "email", "phone") and str(cur).lower() != str(v).lower():
            same = (f in ("instagram", "telegram", "tiktok") and handle(f, cur) == handle(f, v)) or (f == "website" and domain(cur) == domain(v))
            if not same:
                dst.setdefault("conflicts", []).append({"field": f, "kept": cur, "other": v, "from": source_file})
    if source_file not in dst.setdefault("seed_files", []):
        dst["seed_files"].append(source_file)


def tidy(b: dict):
    b["website"] = norm_url(b.get("website"))
    for net in ("instagram", "telegram", "tiktok"):
        b[net] = social_url(net, handle(net, b.get(net))) if b.get(net) else None
    b["email"] = clean_email(b.get("email"))
    b["phone"] = norm_phone(b.get("phone"))
    b["contact_form"] = norm_url(b.get("contact_form"))
    b["other_socials"] = sorted({norm_url(x) for x in as_list(b.get("other_socials")) if norm_url(x)})
    st = (b.get("own_product_status") or "unknown").strip().lower()
    b["own_product_status"] = st if st in ("confirmed", "likely", "reseller", "unknown") else "unknown"
    b["sales_channels"] = sorted({str(x).strip().lower() for x in as_list(b.get("sales_channels")) if x})
    b["aliases"] = sorted({a for a in as_list(b.get("aliases")) if a and a != b.get("name")})


def cmd_ingest(args) -> None:
    db: dict[str, dict] = load_json(DB_PATH, {})
    index: dict[str, str] = {}
    for bid, b in db.items():
        for k in keys_of(b):
            index[k] = bid
    added = merged = 0
    for path in sorted(SEEDS.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"! {path.name}: не JSON ({e})", file=sys.stderr)
            continue
        for raw in items:
            if not isinstance(raw, dict) or not raw.get("name"):
                continue
            rec = {f: raw.get(f) for f in SEED_FIELDS}
            tidy(rec)
            hit = next((index[k] for k in keys_of(rec) if k in index), None)
            if hit:
                merge_into(db[hit], rec, path.name)
                tidy(db[hit])
                merged += 1
                bid = hit
            else:
                bid = brand_id(rec)
                while bid in db:
                    bid += "x"
                rec.update({"id": bid, "first_seen": TODAY, "seed_files": [path.name]})
                db[bid] = rec
                added += 1
            for k in keys_of(db[bid]):
                index.setdefault(k, bid)
    corrected = apply_corrections(db)
    save_json(DB_PATH, db)
    print(f"ingest: новых {added}, совпали с базой {merged}, исправлено вручную {corrected}, всего в базе {len(db)}")


def apply_corrections(db: dict) -> int:
    """data/corrections.json — проверенные вручную факты: {"ID или название": {"поле": значение}}. В отличие от
    seed-файлов, перезаписывают поля (null — очищает). Применяются при каждом ingest, поэтому не теряются."""
    fixes = load_json(CORRECTIONS_PATH, {})
    by_name = {norm_text(b.get("name")): bid for bid, b in db.items()}
    n = 0
    for key, patch in fixes.items():
        if key.startswith("_"):
            continue
        bid = key if key in db else by_name.get(norm_text(key))
        if not bid:
            print(f"! corrections: не найден бренд «{key}»", file=sys.stderr)
            continue
        db[bid].update(patch)
        tidy(db[bid])
        n += 1
    return n

# ---------------------------------------------------------------- HTTP с кешем, robots.txt и паузами

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept-Language": "ru,be;q=0.9,en;q=0.8"})
_last_hit: dict[str, float] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str) -> bool:
    host = urllib.parse.urlsplit(url).netloc
    if any(h in host for h in NO_FETCH_HOSTS):
        return False
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _session.get(f"https://{host}/robots.txt", timeout=10)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except requests.RequestException:
            rp.parse([])
        _robots[host] = rp
    rp = _robots[host]
    return rp.can_fetch(UA, url) if rp else True


def fetch(url: str) -> dict:
    """{'url','final_url','status','text','error'}; ответы кешируются на CACHE_DAYS дней."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if key.exists() and time.time() - key.stat().st_mtime < CACHE_DAYS * 86400:
        return json.loads(key.read_text(encoding="utf-8"))
    if not allowed(url):
        return {"url": url, "final_url": url, "status": None, "text": "", "error": "robots/запрет на автосбор"}
    host = urllib.parse.urlsplit(url).netloc
    wait = PER_HOST_DELAY - (time.time() - _last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    res = {"url": url, "final_url": url, "status": None, "text": "", "error": None}
    try:
        r = _session.get(url, timeout=20, allow_redirects=True)
        if not r.encoding or r.encoding.lower() == "iso-8859-1":  # requests так «угадывает», когда charset не указан
            r.encoding = r.apparent_encoding
        res.update(final_url=r.url, status=r.status_code)
        if "text/html" in r.headers.get("content-type", "") or r.text.lstrip().startswith("<"):
            res["text"] = r.text[:600_000]
    except requests.RequestException as e:
        res["error"] = type(e).__name__
    _last_hit[host] = time.time()
    if not res["error"]:  # таймауты и обрывы не кешируем — при следующем запуске попробуем снова
        key.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    return res

# ---------------------------------------------------------------- извлечение с официальных страниц

CONTACT_HINTS = re.compile(r"contact|kontakt|контакт|about|o-?nas|о-нас|онас|cooperat|сотруднич|partner|партн|opt|опт|wholesale|b2b|info", re.I)


def decode_cfemail(hexstr: str) -> str:
    b = bytes.fromhex(hexstr)
    return "".join(chr(x ^ b[0]) for x in b[1:])


def extract(html: str, base: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    out = {"emails": set(), "phones": set(), "instagram": set(), "telegram": set(), "tiktok": set(), "contact_links": set(), "title": None}
    if soup.title and soup.title.string:
        out["title"] = soup.title.string.strip()[:140]
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            e = clean_email(href)
            if e:
                out["emails"].add(e)
        elif href.lower().startswith("tel:"):
            p = norm_phone(href[4:])
            if p and p.startswith("+375"):
                out["phones"].add(p)
        else:
            absu = urllib.parse.urljoin(base, href)
            for net in ("instagram", "telegram", "tiktok"):
                h = handle(net, absu)
                if h and h not in ("share", "home", "explore"):
                    out[net].add(h)
            if urllib.parse.urlsplit(absu).netloc == urllib.parse.urlsplit(base).netloc and CONTACT_HINTS.search(absu + " " + a.get_text(" ")):
                out["contact_links"].add(absu.split("#")[0])
    for el in soup.select("[data-cfemail]"):
        e = clean_email(decode_cfemail(el["data-cfemail"]))
        if e:
            out["emails"].add(e)
    text = soup.get_text(" ")
    # Конструкторы сайтов (Tilda, Wix…) часто держат контакты в JSON внутри <script>, где «>» записан как >.
    raw = re.sub(r"\\u003[ce]|\\u0040|\\/", lambda m: {"\\u0040": "@", "\\/": "/"}.get(m.group(0), " "), html)
    for e in EMAIL_RE.findall(text) + EMAIL_RE.findall(raw):
        e = clean_email(e)
        if e:
            out["emails"].add(e)
    for p in PHONE_RE.findall(text):
        p = norm_phone(p)
        if p and p.startswith("+375"):
            out["phones"].add(p)
    return out


def verify_site(b: dict) -> dict:
    site = b.get("website")
    v = {"checked": TODAY, "site_status": None, "site_final_url": None, "site_title": None, "pages": [],
         "emails": {}, "phones": {}, "instagram": {}, "telegram": {}, "tiktok": {}}
    if not site or domain(site) in (None,) or any(h in domain(site) for h in NO_FETCH_HOSTS):
        return v
    home = fetch(site)
    v["site_status"] = home["status"] if not home["error"] else home["error"]
    v["site_final_url"] = home["final_url"]
    if not home["text"]:
        return v
    first = extract(home["text"], home["final_url"])
    v["site_title"] = first["title"]
    pages = [(home["final_url"], first)]
    for link in sorted(first["contact_links"])[:4]:
        r = fetch(link)
        if r["text"]:
            pages.append((r["final_url"], extract(r["text"], r["final_url"])))
    for url, ex in pages:
        v["pages"].append(url)
        for kind in ("emails", "phones", "instagram", "telegram", "tiktok"):
            for x in ex[kind]:
                v[kind].setdefault(x, url)
    return v


def parse_count(text: str) -> int | None:
    """«1.2K», «12 345 subscribers», «3M» → число."""
    m = re.search(r"(\d[\d\s.,]*)\s*([KkMМм])?\b", text)
    if not m:
        return None
    num, suffix = m.group(1).replace(" ", "").replace(" ", ""), (m.group(2) or "").lower()
    if suffix:
        return int(float(num.replace(",", ".")) * (1000 if suffix == "k" else 1_000_000))
    return int(re.sub(r"[.,]", "", num) or 0)


def verify_telegram(h: str) -> dict:
    """Публичная страница канала t.me/s/<handle>: название, подписчики, дата последнего поста."""
    r = fetch(f"https://t.me/s/{h}")
    res = {"checked": TODAY, "exists": False, "title": None, "subscribers": None, "last_post": None}
    if r["status"] != 200 or not r["text"]:
        r = fetch(f"https://t.me/{h}")
    if r["status"] != 200 or not r["text"]:
        return res
    soup = BeautifulSoup(r["text"], "html.parser")
    og = soup.find("meta", property="og:title")
    title = og["content"].strip() if og and og.get("content") else None
    if title and not title.lower().startswith("telegram: contact"):
        res.update(exists=True, title=title)
    counter = soup.select_one(".tgme_channel_info_counter .counter_value") or soup.select_one(".tgme_page_extra")
    if counter:
        res["subscribers"] = parse_count(counter.get_text(" "))
    times = [t.get("datetime") for t in soup.select(".tgme_widget_message_date time[datetime]")]
    if times:
        res["last_post"] = max(times)[:10]
        res["exists"] = True
    return res


ROLE_EMAIL = re.compile(r"^(info|hello|hi|sales|opt|partner|partners|pr|marketing|collab|cooperation|shop|store|order|orders|contact|contacts|mail|office|brand)\b", re.I)


def best_email(emails: dict, site_domain: str | None) -> str:
    """Общий деловой адрес (info@, sales@, partner@…) на домене бренда, затем любой на домене, затем остальные."""
    def rank(e: str):
        local, _, host = e.partition("@")
        return (not ROLE_EMAIL.match(local), not (site_domain and host.endswith(site_domain)), "manager" in local, e)
    return sorted(emails, key=rank)[0]


def cmd_verify(args) -> None:
    db = load_json(DB_PATH, {})
    todo = [b for b in db.values() if args.force or (b.get("verify") or {}).get("checked") != TODAY]
    if args.limit:
        todo = todo[: args.limit]
    for i, b in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {b['name']}", flush=True)
        v = verify_site(b)
        tg = handle("telegram", b.get("telegram"))
        if not tg and len(v["telegram"]) == 1:
            tg = next(iter(v["telegram"]))
        v["telegram_channel"] = verify_telegram(tg) | {"handle": tg} if tg else None
        b["verify"] = v
        # Ссылки на соцсети с официального сайта — подтверждённые, ими дополняем пустые поля.
        for net in ("instagram", "telegram", "tiktok"):
            found = v[net]
            if not b.get(net) and len(found) == 1:
                h, url = next(iter(found.items()))
                b[net] = social_url(net, h)
                b.setdefault("contact_sources", {})[net] = url
        # Адрес с официального сайта надёжнее найденного в статье или сниппете: он становится основным,
        # прежний сохраняется в email_alt.
        if v["emails"] and b.get("email") not in v["emails"]:
            # Адрес, который исследователь нашёл, но счёл спорным (conflicts), выигрывает, если он есть на сайте.
            others = [c["other"] for c in b.get("conflicts", []) if c["field"] == "email" and c["other"] in v["emails"]]
            e = others[0] if others else best_email(v["emails"], domain(b.get("website")))
            if b.get("email"):
                b["email_alt"] = b["email"]
            b["email"] = e
            b.setdefault("contact_sources", {})["email"] = v["emails"][e]
        if not b.get("phone") and v["phones"]:
            p, url = sorted(v["phones"].items())[0]
            b["phone"] = p
            b.setdefault("contact_sources", {})["phone"] = url
        save_json(DB_PATH, db)
    print(f"verify: проверено {len(todo)}")

# ---------------------------------------------------------------- поиск новых кандидатов по подборкам

# Не бренды: поисковики, соцсети, СМИ, маркетплейсы, магазины техники, CDN и справки браузеров.
DISCOVER_SKIP = re.compile(
    r"google|yandex|facebook|vk\.com|youtube|twitter|x\.com|apple|onliner|tut\.by|wikipedia|ok\.ru|mozilla|opera\.com|"
    r"microsoft|cloudfront|feedburner|wildberries|ozon|lamoda|belbazar|kufar|mts\.by|a1\.by|5element|21vek|myfin|"
    r"nashaniva|citydog|kyky|relax\.by|34mag|bel\.ru|zerkalo|smartpress|belta|t-j\.ru|sputnik|telegra\.ph|linktr\.ee|taplink"
)


def cmd_discover(args) -> None:
    src = SEEDS / "source_pages.txt"
    if not src.exists():
        print("discover: нет data/seeds/source_pages.txt — добавьте URL подборок, по одному на строку")
        return
    db = load_json(DB_PATH, {})
    known = set().union(*(keys_of(b) for b in db.values())) if db else set()
    seen_rows = set()
    rows = []
    if LEADS_PATH.exists():
        with LEADS_PATH.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                rows.append(r)
                seen_rows.add(r["key"])
    for line in src.read_text(encoding="utf-8").splitlines():
        url = line.split("#")[0].strip()
        if not url:
            continue
        r = fetch(url)
        if not r["text"]:
            print(f"- {url}: {r['error'] or r['status']}")
            continue
        soup = BeautifulSoup(r["text"], "html.parser")
        # Только основной текст: меню, шапка, подвал и боковые колонки — это ссылки самого издания.
        for junk in soup.select("nav, header, footer, aside, form, script, style"):
            junk.decompose()
        body = soup.select_one("article") or soup.select_one("main") or soup.body or soup
        own = norm_text((domain(url) or "").split(".")[0])
        n = 0
        for a in body.find_all("a", href=True):
            href = a["href"].strip()
            if re.match(r"^(mailto|tel|javascript|#)", href, re.I):
                continue
            absu = urllib.parse.urljoin(r["final_url"], href)
            label = a.get_text(" ", strip=True)[:80]
            cand = None
            for net, pref in (("instagram", "in"), ("telegram", "te"), ("tiktok", "ti")):
                h = handle(net, absu)
                if h and own not in norm_text(h):
                    cand = (f"{pref}:{h}", net, social_url(net, h))
            if not cand and not re.search(r"instagram\.com|t\.me|tiktok\.com|threads\.(net|com)", absu):
                d = domain(absu)
                if d and d != domain(url) and not DISCOVER_SKIP.search(d):
                    cand = (f"d:{d}", "website", f"https://{d}")
            if cand and cand[0] not in known and cand[0] not in seen_rows:
                seen_rows.add(cand[0])
                rows.append({"key": cand[0], "type": cand[1], "url": cand[2], "anchor_text": label, "found_on": url, "found_at": TODAY, "status": "new"})
                n += 1
        print(f"+ {url}: новых кандидатов {n}")
    with LEADS_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["key", "type", "url", "anchor_text", "found_on", "found_at", "status"])
        w.writeheader()
        w.writerows(rows)
    print(f"discover: всего кандидатов в {LEADS_PATH.name}: {len(rows)} (разбираются вручную: status = brand/not_brand)")

# ---------------------------------------------------------------- оценка

FIT_STYLES = re.compile(r"street|стрит|уличн|оверсайз|oversize|casual|кэжуал|minimal|минимал|unisex|унисекс|alternative|альтернатив|graphic|граф|y2k|techwear|denim|деним|худи|hoodie|skate|скейт|upcycl|апсайкл|трикотаж|вязан|knit|grunge|гранж|авангард|avant", re.I)
COLLECTION_HINTS = re.compile(r"коллекц|collection|ss\d{2}|fw\d{2}|aw\d{2}|дроп|drop|лукбук|lookbook|капсул|сезон|линейк|релиз", re.I)
PRODUCTION_HINTS = re.compile(r"пошив|шьём|шьем|производ|ателье|цех|собственн|своё производ|сво[её] производ|дизайнер|авторск|ручн|handmade|made in belarus|сделано в беларуси", re.I)


def months_ago(ym: str | None) -> float | None:
    if not ym:
        return None
    m = re.match(r"(\d{4})-(\d{2})", ym)
    if not m:
        return None
    t = dt.date.today()
    return (t.year - int(m.group(1))) * 12 + (t.month - int(m.group(2)))


def latest_activity(b: dict) -> str | None:
    dates = [b.get("last_activity")]
    tg = (b.get("verify") or {}).get("telegram_channel") or {}
    dates.append(tg.get("last_post"))
    dates = [d for d in dates if d and re.match(r"\d{4}-\d{2}", d)]
    return max(dates)[:7] if dates else None


def contact_status(b: dict) -> tuple[str, str]:
    """(статус проверки контактов, предпочтительный канал)."""
    v = b.get("verify") or {}
    email_on_site = b.get("email") and b["email"] in (v.get("emails") or {})
    phone_on_site = b.get("phone") and b["phone"] in (v.get("phones") or {})
    ig_on_site = handle("instagram", b.get("instagram")) in (v.get("instagram") or {})
    tg = v.get("telegram_channel") or {}
    if email_on_site or phone_on_site:
        status = "проверен на официальном сайте"
    elif ig_on_site or tg.get("exists"):
        status = "соцсеть подтверждена (ссылка с сайта / живой канал)"
    elif b.get("email") or b.get("phone") or b.get("instagram") or b.get("telegram"):
        status = "из стороннего источника — проверить вручную"
    else:
        status = "контакт не найден"
    if b.get("email"):
        channel = "email"
    elif b.get("telegram"):
        channel = "Telegram"
    elif b.get("instagram"):
        channel = "Instagram Direct"
    elif b.get("contact_form"):
        channel = "форма на сайте"
    elif b.get("phone"):
        channel = "телефон / мессенджер"
    else:
        channel = "—"
    return status, channel


def score(b: dict) -> dict:
    parts = {}
    own = b.get("own_product_status")
    blob = " ".join(str(b.get(f) or "") for f in ("category", "style", "description", "own_product_evidence", "notes"))
    # 1. Соответствие концепции: собственный продукт — главное условие (25)
    parts["Свой продукт"] = {"confirmed": 25, "likely": 12}.get(own, 0)
    # 2. Свежесть активности (10)
    m = months_ago(latest_activity(b))
    parts["Активность"] = 0 if m is None else 10 if m <= 3 else 8 if m <= 6 else 5 if m <= 12 else 1
    # 3. Аудитория: «сладкая зона» — живая, но не гигантская (10)
    fol = b.get("followers") or {}
    tg = ((b.get("verify") or {}).get("telegram_channel") or {}).get("subscribers")
    n = max([x for x in [fol.get("instagram"), fol.get("tiktok"), fol.get("telegram"), tg] if isinstance(x, (int, float))] or [0])
    parts["Аудитория"] = 3 if n == 0 else 4 if n < 1000 else 10 if n <= 30000 else 8 if n <= 100000 else 5
    # 4. Ассортимент и регулярные коллекции (10)
    a = 0
    if COLLECTION_HINTS.search(blob):
        a += 5
    if PRODUCTION_HINTS.search(blob):
        a += 3
    if len(b.get("sales_channels") or []) >= 2:
        a += 2
    parts["Ассортимент"] = min(a, 10)
    # 5. Признаки действующего бизнеса (10)
    v = b.get("verify") or {}
    site_ok = v.get("site_status") == 200
    biz = (5 if site_ok else 2 if b.get("website") else 0) + (3 if (v.get("emails") or v.get("phones")) else 0) + (2 if b.get("city") else 0)
    parts["Действующий бизнес"] = min(biz, 10)
    # 6. Потребность в дополнительном канале (10): у кого мало своих каналов продаж — тому площадка нужнее
    ch = set(b.get("sales_channels") or [])
    mp = ch & {"wildberries", "ozon", "lamoda"}
    need = 10 if not site_ok and not mp else 8 if not mp else 5
    parts["Нужен доп. канал"] = need
    # 7. Доступность контакта для делового предложения (10)
    status, _ = contact_status(b)
    parts["Контакт"] = 10 if status.startswith("проверен") else 8 if status.startswith("соцсеть") else 5 if status.startswith("из сторон") else 0
    # 8. Сложность привлечения, обратная шкала по масштабу (5)
    parts["Лёгкость"] = {"micro": 5, "small": 5, "medium": 3, "large": 0}.get(b.get("scale_estimate") or "", 3)
    # 9. Ценность для аудитории ichiba: стиль совпадает с тем, что ищут на площадке (10)
    parts["Ценность для ichiba"] = 10 if FIT_STYLES.search(blob) else 6
    total = sum(parts.values())
    if own == "reseller" or b.get("exclude_reason"):
        tier = "X"
    elif own == "confirmed" and total >= 80 and parts["Активность"] >= 8 and parts["Контакт"] >= 8 and b.get("scale_estimate") != "large":
        tier = "A"
    elif own == "confirmed" and total >= 65:
        tier = "B"
    else:
        tier = "C"
    return {"score": total, "tier": tier, "parts": parts}


def why_ichiba(b: dict) -> str:
    ch = set(b.get("sales_channels") or [])
    site_ok = (b.get("verify") or {}).get("site_status") == 200
    reasons = []
    if not site_ok and ch <= {"instagram", "telegram", "tiktok", "showroom"}:
        reasons.append("продаёт через соцсети без своего магазина — получит витрину с каталогом, поиском, фильтрами по размеру и чатом")
    elif not ch & {"wildberries", "ozon", "lamoda"}:
        reasons.append("нет на крупных маркетплейсах — ichiba как дополнительная витрина без демпинга масс-маркета")
    else:
        reasons.append("уже мультиканальный — ещё одна витрина именно для локальных брендов, отдельно от масс-маркета")
    if b.get("telegram"):
        reasons.append("каталог можно перенести из Telegram-канала силами команды ichiba")
    elif site_ok:
        reasons.append("каталог можно перенести с сайта силами команды ichiba")
    if FIT_STYLES.search(" ".join(str(b.get(f) or "") for f in ("category", "style", "description"))):
        reasons.append("стиль совпадает с аудиторией площадки (молодёжь, streetwear/casual)")
    return "; ".join(reasons)


def cmd_score(args) -> None:
    db = load_json(DB_PATH, {})
    for b in db.values():
        b["scoring"] = score(b)
        b["why_ichiba_auto"] = why_ichiba(b)
        b["contact_status"], b["preferred_channel"] = contact_status(b)
    save_json(DB_PATH, db)
    tiers = {}
    for b in db.values():
        tiers[b["scoring"]["tier"]] = tiers.get(b["scoring"]["tier"], 0) + 1
    print("score:", ", ".join(f"{k}={v}" for k, v in sorted(tiers.items())))

# ---------------------------------------------------------------- экспорт

COLUMNS = [
    ("id", "ID"), ("name", "Бренд"), ("category", "Категория"), ("style", "Стиль"), ("gender", "Для кого"),
    ("description", "Описание"), ("city", "Город"), ("website", "Сайт"), ("_site", "Сайт: проверка"),
    ("instagram", "Instagram"), ("tiktok", "TikTok"), ("telegram", "Telegram"), ("_tg", "Telegram: проверка"),
    ("_other", "Другие соцсети / маркетплейсы"), ("email", "Email"), ("email_alt", "Email (другой источник)"), ("contact_form", "Форма / страница сотрудничества"),
    ("phone", "Телефон"), ("_sources", "Источники контактов"), ("_own", "Собственный продукт"),
    ("own_product_evidence", "Чем подтверждено"), ("own_product_evidence_url", "Ссылка на подтверждение"),
    ("_channels", "Каналы продаж"), ("scale_estimate", "Масштаб"), ("scale_basis", "Основание оценки масштаба"),
    ("_activity", "Последняя активность"), ("_why", "Почему ichiba"), ("hook", "Аргумент для первого сообщения"),
    ("_score", "Балл"), ("_tier", "Группа"), ("_parts", "Разбивка балла"), ("contact_status", "Статус проверки контактов"),
    ("preferred_channel", "Канал первого контакта"), ("found_via", "Как найден"), ("found_via_url", "Источник находки"),
    ("first_seen", "Дата обнаружения"), ("_checked", "Дата проверки"), ("_unverified", "Не подтверждено"), ("flags", "Риски / проверить вручную"), ("exclude_reason", "Причина исключения"), ("notes", "Заметки"),
]
OWN_RU = {"confirmed": "подтверждённый собственный бренд", "likely": "вероятный собственный бренд", "reseller": "реселлер / мультибренд", "unknown": "не удалось проверить"}


def row_of(b: dict, overrides: dict) -> dict:
    v = b.get("verify") or {}
    tg = v.get("telegram_channel") or {}
    sc = b.get("scoring") or {}
    o = overrides.get(b["id"], {})
    r = {}
    for key, title in COLUMNS:
        if key == "_site":
            st = v.get("site_status")
            val = "" if not b.get("website") else f"{st}" + (f" · {v.get('site_title')}" if v.get("site_title") else "") if st else "не проверялся"
        elif key == "_tg":
            val = "" if not tg else ("канал есть" if tg.get("exists") else "не найден") + (f" · {tg['subscribers']} подп." if tg.get("subscribers") else "") + (f" · пост {tg['last_post']}" if tg.get("last_post") else "")
        elif key == "_other":
            val = "\n".join(b.get("other_socials") or [])
        elif key == "_sources":
            val = "\n".join(f"{k}: {u}" for k, u in (b.get("contact_sources") or {}).items() if u)
        elif key == "_own":
            val = OWN_RU[b.get("own_product_status", "unknown")]
        elif key == "_channels":
            val = ", ".join(b.get("sales_channels") or [])
        elif key == "_activity":
            val = latest_activity(b) or ""
        elif key == "_why":
            val = b.get("why_ichiba") or b.get("why_ichiba_auto") or ""
        elif key == "_score":
            val = sc.get("score", "")
        elif key == "_tier":
            val = sc.get("tier", "")
        elif key == "_parts":
            val = ", ".join(f"{k} {x}" for k, x in (sc.get("parts") or {}).items())
        elif key == "_checked":
            val = v.get("checked", "")
        elif key == "_unverified":
            val = ", ".join(b.get("unverified") or [])
        else:
            val = b.get(key)
            if isinstance(val, (list, dict)):
                val = json.dumps(val, ensure_ascii=False)
        r[title] = o.get(title, val if val is not None else "")
    return r


CRM_FIELDS = ["ID", "Бренд", "Группа", "Канал связи", "Контакт", "Ответственный", "Статус", "Дата первого сообщения",
              "Дата следующего касания", "Касание №", "Ответ", "Возражения", "Следующий шаг", "Дата подключения",
              "Товаров на ichiba", "Заметки"]
CRM_STATUSES = ["не начато", "написали", "follow-up 1", "follow-up 2", "ответили", "созвон/демо", "заявка подана",
                "подключён", "первые товары", "отказ", "не сейчас (вернуться)", "нет контакта"]


def sync_crm(rows: list[dict]) -> list[dict]:
    """CRM ведётся в data/crm.csv руками; скрипт только добавляет новые бренды и никогда не трогает заполненные строки."""
    crm = []
    if CRM_PATH.exists():
        with CRM_PATH.open(encoding="utf-8-sig") as f:
            crm = list(csv.DictReader(f))
    have = {r["ID"] for r in crm}
    for r in rows:
        if r["ID"] not in have and r["Группа"] in ("A", "B"):
            contact = r["Email"] or r["Telegram"] or r["Instagram"] or r["Форма / страница сотрудничества"] or r["Телефон"]
            crm.append({"ID": r["ID"], "Бренд": r["Бренд"], "Группа": r["Группа"], "Канал связи": r["Канал первого контакта"],
                        "Контакт": contact, "Ответственный": "", "Статус": "не начато" if contact else "нет контакта"})
    with CRM_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CRM_FIELDS)
        w.writeheader()
        for r in crm:
            w.writerow({k: r.get(k, "") for k in CRM_FIELDS})
    return crm


def cmd_export(args) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    db = load_json(DB_PATH, {})
    overrides = load_json(OVERRIDES_PATH, {})
    brands = sorted(db.values(), key=lambda b: -(b.get("scoring") or {}).get("score", 0))
    rows = [row_of(b, overrides) for b in brands]
    out_ = lambda b: b["own_product_status"] == "reseller" or b.get("exclude_reason")
    main = [r for r, b in zip(rows, brands) if b["own_product_status"] == "confirmed" and not out_(b)]
    review = [r for r, b in zip(rows, brands) if b["own_product_status"] in ("likely", "unknown") and not out_(b)]
    excluded = [r for r, b in zip(rows, brands) if out_(b)]
    # Топ-20 — ручной выбор (data/top20.json: список ID по порядку), иначе первые 20 группы A по баллу.
    by_id = {r["ID"]: r for r in rows}
    curated = [i for i in load_json(TOP_PATH, []) if i in by_id]
    top = [by_id[i] for i in curated] if curated else [r for r in main if r["Группа"] == "A"][:20]
    crm = sync_crm(main)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (("brands_main", main), ("brands_to_review", review), ("brands_excluded", excluded), ("top20", top)):
        with (OUT / f"{name}.csv").open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=[t for _, t in COLUMNS])
            w.writeheader()
            w.writerows(data)

    wb = Workbook()
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="1F2937")
    tier_fill = {"A": "D1FAE5", "B": "FEF3C7", "C": "F3F4F6", "X": "FEE2E2"}

    def sheet(title, data, fields):
        ws = wb.create_sheet(title)
        ws.append(fields)
        for c in ws[1]:
            c.font, c.fill = head, fill
            c.alignment = Alignment(wrap_text=True, vertical="top")
        for r in data:
            ws.append([r.get(f, "") for f in fields])
        ws.freeze_panes = "C2"
        ws.auto_filter.ref = ws.dimensions
        for i, f in enumerate(fields, 1):
            width = 14 if f in ("ID", "Группа", "Балл", "Масштаб", "Город") else 34 if f in ("Описание", "Почему ichiba", "Чем подтверждено", "Заметки", "Аргумент для первого сообщения", "Разбивка балла", "Источники контактов") else 22
            ws.column_dimensions[ws.cell(1, i).column_letter].width = width
        if "Группа" in fields:
            gi = fields.index("Группа") + 1
            for row in ws.iter_rows(min_row=2):
                t = row[gi - 1].value
                if t in tier_fill:
                    for c in row:
                        c.fill = PatternFill("solid", fgColor=tier_fill[t])
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
        return ws

    titles = [t for _, t in COLUMNS]
    wb.remove(wb.active)
    sheet("Топ-20", top, titles)
    sheet("База (свой продукт)", main, titles)
    sheet("На доп. проверку", review, titles)
    sheet("Исключены", excluded, titles)
    ws = sheet("CRM", crm, CRM_FIELDS)
    dv = DataValidation(type="list", formula1='"' + ",".join(CRM_STATUSES) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"G2:G{max(len(crm) + 200, 300)}")
    crit = wb.create_sheet("Критерии оценки")
    crit.append(["Критерий", "Макс.", "Как считается"])
    for row in SCORING_TABLE:
        crit.append(row)
    for c in crit[1]:
        c.font, c.fill = head, fill
    crit.column_dimensions["A"].width, crit.column_dimensions["B"].width, crit.column_dimensions["C"].width = 26, 8, 110
    path = OUT / "ichiba_brands.xlsx"
    wb.save(path)
    print(f"export: основная база {len(main)}, на проверку {len(review)}, исключено {len(excluded)}, топ {len(top)} → {path}")


SCORING_TABLE = [
    ["Свой продукт", 25, "confirmed — 25, likely — 12, unknown — 0; реселлер — исключается (группа X)"],
    ["Активность", 10, "последняя подтверждённая активность (пост, коллекция, новость, пост в Telegram): ≤3 мес — 10, ≤6 — 8, ≤12 — 5, старше — 1, нет данных — 0"],
    ["Аудитория", 10, "макс. подписчиков в соцсетях: 1–30 тыс. — 10, 30–100 тыс. — 8, >100 тыс. — 5, <1 тыс. — 4, неизвестно — 3"],
    ["Ассортимент", 10, "есть коллекции/дропы/лукбуки — 5; явное собственное производство/дизайнер — 3; ≥2 канала продаж — 2"],
    ["Действующий бизнес", 10, "сайт отвечает 200 — 5 (есть, но не отвечает — 2); контакты на сайте — 3; указан город — 2"],
    ["Нужен доп. канал", 10, "нет своего сайта и маркетплейсов — 10; есть сайт, нет маркетплейсов — 8; уже на WB/Ozon/Lamoda — 5"],
    ["Контакт", 10, "email/телефон подтверждён на официальном сайте — 10; соцсеть подтверждена — 8; контакт только из стороннего источника — 5; нет — 0"],
    ["Лёгкость", 5, "масштаб micro/small — 5, medium — 3, large — 0, неизвестно — 3"],
    ["Ценность для ichiba", 10, "стиль streetwear/casual/минимализм/унисекс/альтернатива/трикотаж — 10, другой — 6"],
    ["Группы", "", "A: свой продукт подтверждён, ≥80 баллов, активность за последние 6 мес. подтверждена (≥8), контакт проверен (≥8), не крупный; B: подтверждён, ≥65; C: остальное (в т.ч. все likely/unknown); X: реселлеры и исключённые вручную"],
]


def main():
    # Консоль Windows по умолчанию в cp1251 — названия брендов на латинице с диакритикой её роняют.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["ingest", "discover", "verify", "score", "export", "all"])
    p.add_argument("--force", action="store_true", help="verify: перепроверить даже проверенные сегодня")
    p.add_argument("--limit", type=int, default=0, help="verify: проверить не больше N брендов")
    args = p.parse_args()
    steps = ["ingest", "verify", "score", "export"] if args.step == "all" else [args.step]
    for s in steps:
        globals()[f"cmd_{s}"](args)


if __name__ == "__main__":
    main()
