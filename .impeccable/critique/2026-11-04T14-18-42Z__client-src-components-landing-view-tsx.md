---
target: страница бренда
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\ichiba\\client\\src\\components\\landing-view.tsx"
target_fingerprint: "sha256:4922e5bb9182ba501c39eca8bbfa1624afa6555231573b038cf3cdd4452b2ca6"
target_path: "D:\\ichiba\\client\\src\\components\\landing-view.tsx"
timestamp: 2026-11-04T14-18-42Z
slug: client-src-components-landing-view-tsx
---
Method: dual-agent (A: subagent «Critique A: brand landing page» · B: subagent «Critique B: detector and browser»)

# Critique: страница бренда (client/src/components/landing-view.tsx) — https://ichiba.by/brands/mirarwear

Режим: Persuade (SEO-лендинг: человек из поиска → покупатель; представление бренда).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | 40 вещей здесь против 42 на /u |
| 2 | Match System / Real World | 2 | «Новое — каталог брендов» звучит как жаргон; «Уточняйте»; статистический тон |
| 3 | User Control and Freedom | 3 | Выходы есть |
| 4 | Consistency and Standards | 2 | Бренд с лого и био на /u и без них на /brands; H1 ≠ крошка |
| 5 | Error Prevention | 3 | Договорные и с выбором размера уходят на страницу вещи |
| 6 | Recognition Rather Than Recall | 2 | Интро называет брюки и шорты, а чипов для них нет |
| 7 | Flexibility and Efficiency | 1 | Нет сортировки и фильтра размера; «Смотреть все» скрыт, когда всё влезло |
| 8 | Aesthetic and Minimalist Design | 2 | «@mirarwearfck», «Новое с биркой», «Похожие» ×40; пустая правая половина шапки на 1440 |
| 9 | Error Recovery | 3 | EmptyState с поиском, error boundary |
| 10 | Help and Documentation | 1 | Не сказано, что такое ichiba, как торг и оплата при получении |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict

LLM: оболочка своя (васи, Spectral, печати, футер айдзомэ), композиция взаимозаменяема — крошки → H1 → SEO-абзац → чипы → сетка, как категория любой доски; о самом бренде страница ничего не говорит.

Deterministic scan: CLI 0. Рендер (десктоп 7, телефон 5): line-length ~102 символа в интро (landing-view.tsx:109, app/brands/page.tsx:77) подтверждено; straggler «Беларуси.»; общие находки по футеру. axe: target-size у @продавец / «Похожие» — подтверждено, ИСПРАВЛЕНО 2026-11-04; color-contrast на карточках — ложное (кадр посреди анимации reveal).

Visual overlays: не внедрены (CSP).

## Priority Issues

- [P1] Бренда нет на его собственной странице — нет лого, био, «Подписаться», ссылки на витрину; в LandingData нет полей бренда (client/src/lib/landing.ts:27-45). Fix: шапка бренда, H1 = имя бренда, SEO-фраза в подзаголовок. → /impeccable shape, затем /impeccable bolder
- [P1] Цифры вводят в заблуждение — «Цены от 50 до 130 р., у половины до 60 р.» посчитано по 8 вещам с ценой из 40 (server/src/seo/landing.ts:294-297, 350-352). Fix: «Цена указана у 8 вещей: 50–130 р.; остальные — предложите свою». → /impeccable clarify
- [P2] Печати на карточках правой колонки на миг вылезают за экран телефона во время анимации seal-press (scale 1.9 → 1, ~0,5 с): страницу можно сдвинуть вбок. Агент A оценил как P1 по замеру в скрытой панели, где анимация застыла на первом кадре; в покое печать в экран помещается. Fix: overflow-x: clip на уровне страницы или старт анимации без выхода за край. → /impeccable adapt
- [P2] Тупики навигации — нет «Бренды» в крошках, нет фильтров, нет блока «что дальше». → /impeccable layout
- [P2] Внутренняя таксономия и шум — «Новое — каталог брендов», 40 одинаковых «@продавец / Новое с биркой». → /impeccable distill

## Persona Red Flags

- Jordan: не понимает, что такое ichiba; «Договорная» без объяснения торга.
- Casey: ~9 000 px без сортировки; чипы 36 px; мелкие соседние ссылки (исправлено).
- Riley: 40 против 42; «Смотрите также: …MIRARWEAR» при крошке «MIRARWEAR».
- Владелец бренда: H1 как рубрика доски; манифест и лого только на /u; чип конкурента над его вещами на /tshirts; отправит людей на /u, и SEO-страница будет конкурировать с ней.

## Minor Observations

/brands (1440): 6 брендов показаны трижды; сакура перекрывает «Vetements 15». «РАЗДЕЛЫ» — h2 12 px капсом. Интро в 15 px text-ink-2 читается как SEO-хвост.

## Questions to Consider

- Что если /brands/<бренд> станет витриной бренда, а статистика уйдёт в сноску?
- Нужны ли две страницы бренда, если Google ранжирует более слабую?
- Что если «Договорная» станет приглашением к торгу, а не дырой в цене?
