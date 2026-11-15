# Перенос ichiba с Railway на свой сервер

Один VPS (от 2 vCPU / 2 ГБ RAM / 15 ГБ SSD, Ubuntu 22.04 или 24.04), всё в Docker: Postgres, Redis, API, сайт, Caddy. Домен, внешний вид и все данные остаются теми же.

## Что сколько занимает

Замеры на Railway (ноябрь 2026):

| | Память | Диск |
|---|---|---|
| API (server) | 0,6 ГБ | образ ~1,2 ГБ |
| Сайт (client) | 0,5 ГБ | образ ~0,4 ГБ |
| Postgres | 0,15 ГБ | данные 0,27 ГБ + образ 0,45 ГБ |
| Redis, Caddy | ~0,05 ГБ | ~0,1 ГБ |
| Фото и видео | — | 0,67 ГБ |
| Модель поиска по фото | входит в память API | 0,09 ГБ |

Итого около 1,3 ГБ памяти и 3–4 ГБ диска вместе с образами. Ещё ~3 ГБ ОС, 3 ГБ swap и до 2,5 ГБ кэша сборки (чистится). На второй проект остаётся примерно 300 МБ памяти и 3 ГБ диска.

Фото: три WebP на снимок, ~75–100 КБ. Когда диска станет мало, фото переезжают в R2 сменой `MEDIA_DRIVER=s3` — ключи в базе те же, править её не надо.

## 1. Сервер

```bash
# swap 3 ГБ: без него сборка сайта на 2 ГБ памяти падает
sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system

# Docker
curl -fsSL https://get.docker.com | sudo sh

# наружу только SSH и веб
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

# код
sudo git clone https://github.com/ChunChunMaruOfficial/ichiba.git /opt/ichiba
cd /opt/ichiba/deploy
cp env.example .env && cp env.server.example .env.server
```

Заполнить `.env` и `.env.server` (подсказки внутри файлов). Значения берутся в Railway: сервис → Variables → Raw Editor. Строки `RAILWAY_*` не копировать.

## 2. Проверка внешних сервисов

С сервера, до переноса данных:

```bash
for u in https://generativelanguage.googleapis.com/v1beta/models https://api.mistral.ai https://api.z.ai https://api.telegram.org https://huggingface.co https://gmail.googleapis.com https://api.nbrb.by/exrates/rates/431; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -m 10 -w '%{http_code}\n' "$u" || echo "нет связи"
done
```

Любой код ответа (200, 401, 403, 404) значит, что связь есть. Отдельно Gemini с ключом:

```bash
curl -s -m 15 "https://generativelanguage.googleapis.com/v1beta/models?key=КЛЮЧ" | head -c 300
```

Ответ «User location is not supported» означает, что Google не обслуживает адрес хостера. Тогда либо `GEMINI_BASE_URL` на прокси вне Беларуси, либо без Gemini: поиск по фото работает на локальной модели, тексты — на Mistral и Z.ai.

## 3. Репетиция на копии данных

Сайт на Railway продолжает работать, домен не трогаем.

```bash
cd /opt/ichiba/deploy
docker compose up -d postgres

# база: у Postgres на Railway нет внешнего адреса, поэтому берём свежий ночной дамп из R2
docker compose run --rm --no-deps -v "$PWD":/work --entrypoint bash db-backup /work/fetch-dump.sh
docker compose exec -T postgres pg_restore --no-owner --no-privileges --clean --if-exists -U ichiba -d ichiba < ichiba.dump

# API в «тихом» режиме: без бота, писем, импорта и бэкапов
docker compose -f docker-compose.yml -f docker-compose.rehearsal.yml up -d --build server

# фото из ночной копии в R2 (можно запускать повторно, качает только недостающее)
docker compose run --rm --no-deps server node dist/backup/media-restore.js

# сайт собирается при работающем API; на 2 ГБ это 10–20 минут
docker compose -f docker-compose.yml -f docker-compose.rehearsal.yml up -d --build client caddy
```

Файл `docker-compose.rehearsal.yml` обязателен: с боевым токеном сервер переставит вебхук бота на себя, и бот на Railway перестанет отвечать.

Проверка без смены DNS (IP — адрес сервера):

```bash
curl -sk --resolve ichiba.by:443:IP https://ichiba.by/api/health
curl -sk --resolve ichiba.by:443:IP https://ichiba.by/ | grep -o '<title>[^<]*'
docker compose ps && free -m && df -h /
```

В браузере: строка `IP ichiba.by media.ichiba.by` в файле hosts и отдельный новый профиль браузера (в обычном сайт запомнен как «только настоящий сертификат»). Смотреть: главная, карточка, фото, вход по почте (код будет в `docker compose logs server`), чат в двух вкладках, загрузка фото, поиск по фото.

Один запрос к базе — нет ли фото в Cloudinary (они не лежат на диске и в перенос не входят, но продолжат открываться):

```bash
docker compose exec postgres psql -U ichiba -d ichiba -c 'SELECT provider, count(*) FROM "Photo" GROUP BY 1'
```

## 4. Переключение

Простой 15–30 минут, лучше ночью.

Так прошло переключение 15 ноября 2026 (простой 4 минуты):

1. На Railway остановить `client`: в панели сервис → Deployments → ⋮ у активного деплоя → Remove (через API остановить сервис нельзя). С этого момента никто не пишет в старую базу.
2. Финальный дамп. У Postgres на Railway нет внешнего адреса; на время дампа его открывают (TCP Proxy на порт 5432 — прошло без обрыва), снимают `pg_dump` с сервера и сразу закрывают. Фото — по ключам из базы с `media.ichiba.by`, пока старый `server` ещё работает, либо `media-restore.js` из R2.
3. Восстановить базу, как в разделе 3.
4. В `deploy/.env` поставить `CADDY_ISSUER=acme` (настоящие сертификаты Let's Encrypt, e-mail не нужен), запустить API без файла репетиции, пересобрать сайт, затем `docker compose up -d`.
5. В Cloudflare: `ichiba.by` — запись A с IP сервера, «DNS only»; `www` и `media` — CNAME на `ichiba.by`. Запись `media` сначала тоже «DNS only»: так Caddy получает для неё сертификат напрямую (минута), после этого прокси включить обратно. Записи `_railway-verify.*` больше не нужны.
6. На Railway остановить `server` тем же способом, а у `db-backup` сменить расписание на несбыточное (`0 0 29 2 *`). Оставлять их работающими нельзя: старый сервер при перезапуске заберёт вебхук бота, через 13 дней начнёт стирать из R2 фото, которых нет в его базе, а старый бэкап будет класть в бакет дампы устаревшей базы.
7. Проверить сайт, чат, фото и бота (`/menu` должен ответить: вебхук сервер переставляет сам при старте).
8. Ночной дамп базы — в crontab сервера (`sudo crontab -e`):

```
17 0 * * * cd /opt/ichiba/deploy && docker compose run --rm db-backup >> /var/log/ichiba-backup.log 2>&1
```

Откат в первые дни: вернуть записи в Cloudflare и запустить сервисы на Railway. Всё, что люди сделали на новом сервере после переключения, при откате теряется, поэтому решение об откате — в первый час.

## 5. После переноса

- UptimeRobot: монитор API сменить с адреса Railway на `https://ichiba.by/api/health`.
- Политика конфиденциальности (`client/src/app/privacy/page.tsx`, раздел «Передача за рубеж»): убрать строку про серверы Railway в Нидерландах. Менять в день переключения, не раньше — до него она верна.
- `client/next.config.ts`: убрать редирект с `client-production-bff5.up.railway.app`.
- Через неделю без откатов удалить проект на Railway.

Перенастраивать не нужно (домен тот же): Яндекс Метрика, Google Analytics, Вебмастер и Search Console, вход через Google и Telegram, IndexNow, почта через Gmail API, бакет бэкапов в R2.

## Обновление сайта

```bash
cd /opt/ichiba && git pull && cd deploy
docker compose up -d --build server
docker compose up -d --build client
docker image prune -f && docker builder prune -f --filter until=24h
```

Сначала API, потом сайт: сайт при сборке читает страницы из API. Во время сборки сайт работает, но медленнее — память уходит в swap.

## Gemini

Google не обслуживает Gemini из Беларуси («User location is not supported»). Запросы к нему идут через сервис `gemini-proxy` (`gemini-proxy.mjs`): он пересылает их через внешние HTTP-прокси из файла `deploy/.env.gemini-proxies` (по одному `user:pass@host:port` в строке) и при ошибке, таймауте или отказе по стране переходит на следующий. Соединение с Google — шифрованный туннель: прокси видит только адрес. Проверка: `docker compose logs gemini-proxy`.

## Файлы с секретами

Лежат рядом с `docker-compose.yml` под именами `.env*`, git их игнорирует: `.env`, `.env.server`, `.env.gemini-proxies`. Выгрузку Raw Editor из Railway в формат Docker переводит `node convert-railway-env.cjs <из> <в>`.
