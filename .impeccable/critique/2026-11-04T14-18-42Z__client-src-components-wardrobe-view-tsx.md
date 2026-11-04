---
target: витрина магазина
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\ichiba\\client\\src\\components\\wardrobe-view.tsx"
target_fingerprint: "sha256:2f271e5869c949bad13d1cce0969023686008fe061fbec6dd786ece5cac2ef6c"
target_path: "D:\\ichiba\\client\\src\\components\\wardrobe-view.tsx"
timestamp: 2026-11-04T14-18-42Z
slug: client-src-components-wardrobe-view-tsx
---
Method: dual-agent (A: subagent «Critique A: shop wardrobe page» · B: subagent «Critique B: detector and browser»)

# Critique: витрина магазина (client/src/components/wardrobe-view.tsx) — https://ichiba.by/u/mirarwearfck

Режим: Experience (витрина-лукбук бренда) с элементами каталога.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Чипы без счётчиков, хотя data.counts есть |
| 2 | Match System / Real World | 2 | В h1 хэндл «mirarwearfck», имя бренда только в био; «Купить» при «Договорной» |
| 3 | User Control and Freedom | 3 | Фильтры в URL, «← Вещи» на отзывах |
| 4 | Consistency and Standards | 2 | JSON-LD Person на /u против Organization на карточке вещи |
| 5 | Error Prevention | 3 | Пустые разделы скрыты; договорная «Купить» ведёт на страницу вещи |
| 6 | Recognition Rather Than Recall | 2 | На десктопе названия только при наведении; на телефоне подписи обрезаны на «MIRARWEAR …» |
| 7 | Flexibility and Efficiency | 2 | Нет фильтра по размеру/цене и поиска внутри; «Дешевле» сортировал по разделам (исправлено) |
| 8 | Aesthetic and Minimalist Design | 3 | Цельно; шумят нули в счётчиках и 34 «Договорная» |
| 9 | Error Recovery | 3 | ErrorState с повтором; у пустого раздела нет сброса фильтра |
| 10 | Help and Documentation | 1 | Ни слова про оплату при получении, доставку, торг, значение печатей |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

LLM: визуальный язык авторский (обложка айдзомэ с сэйгайха, нэфуда, печати 人気/正規), но смысл страницы одинаков для бренда, реселлера и частника: шаблон «Гардероб @ник»; seller.brand в wardrobe-view.tsx не читается.

Deterministic scan: CLI 0. Рендер (десктоп 8, телефон 7): nested-cards подтверждено — блок статистики dl внутри обложки (wardrobe-view.tsx:309); content-hidden-at-rest ложное (.reveal); общие находки по футеру (dark-glow, low-contrast 4.2:1), cream-palette, bounce-easing.

Visual overlays: не внедрены (CSP).

## Priority Issues

- [P1] Витрина не знает, что это бренд — h1 = username, title «Гардероб @mirarwearfck», JSON-LD Person, нет печати «Бренд» и ссылки на канал. Fix: имя бренда в h1, ник мелко, печать, title «MIRARWEAR на ichiba», Organization. → /impeccable shape
- [P1] Не объяснено, как купить, нет опоры доверия — у нового бренда слот доверия заполняют нули. Fix: скрывать нулевые счётчики, полоса «Оплата при получении · Доставка по Беларуси · Цену можно обсудить». → /impeccable clarify
- [P2] Цена и размер как на барахолке — «Договорная» на 34 из 42, «Уточняйте». Fix: «Цена по запросу» и «Узнать цену». → /impeccable clarify
- [P2] Первый экран телефона — обложка ~80% высоты, вещи с ~660 px. Fix: компактная обложка, био в 2 строки. → /impeccable adapt
- [P2] Фильтры и сортировка — «Дешевле» сортировал внутри разделов, а «Все» показывал весь верх, потом весь низ. ИСПРАВЛЕНО 2026-11-04 (сервер отдаёт items в нужном порядке). Остаётся: «Продаётся» = «Все» при 0 продано, «Новинки» дублирует сортировку. → /impeccable distill

## Persona Red Flags

- Casey: первый экран занят обложкой; «Поделиться» вне досягаемости; цену видно только внутри вещи.
- Jordan: «Купить» при «Договорной», непонятные 人気/正規, «Гардероб» у бренда.
- Riley: «Продаётся» = «Все»; печать «ОРИГИНАЛ» у вещей под заказ без объяснения.
- Владелец бренда: хэндл с «fck» вместо бренда, публичные «0 продано», та же вёрстка, что у частника; футер зовёт «продавать то, что не носите».

## Minor Observations

Точка киновари на активном чипе против правила «киноварь только печать»; нет h2 «Вещи»; «на ichiba с октября 2026» без ценности; долгие скелетоны после быстрой прокрутки.

## Questions to Consider

- Что если у бренда в первом экране будут вещи, а не счётчики?
- Должен ли бренд жить по адресу «Гардероб @ник» или ему нужно своё слово («лавка», «магазин»)?
- Если 80% цен «Договорная», это проблема рендера или онбординга бренда?
