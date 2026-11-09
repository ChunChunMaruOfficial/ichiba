# Бэкапы и мониторинг

Railway на нашем тарифе не делает резервных копий ни базы, ни диска с фото. Поэтому копии делаем сами в отдельное
хранилище — Cloudflare R2 (подойдёт любое S3-совместимое: Backblaze B2 и т. п.). База наружу не открывается: дамп
снимает cron-сервис внутри Railway по внутренней сети.

| Что | Как | Когда | Сколько хранится |
|---|---|---|---|
| База данных | Railway cron-сервис **db-backup** (`scripts/backup/Dockerfile` → `db-backup.sh`): `pg_dump`, шифрование паролем, если он задан (gpg, AES-256), загрузка в R2. Запускается, работает минуту и выключается | каждый день в 03:17 по Минску (`17 0 * * *` UTC) | 14 дней, ежемесячных копий нет: данные удалённого аккаунта должны уйти из всех копий за 15 дней (политика, 99-З). `DAILY_DAYS`/`MONTHLY_DAYS` на сервисе меняют сроки |
| Фото и видео (`/data/media` на сервере) | сервер сам докачивает новые файлы в R2 (`server/src/backup/media-backup.ts`) | каждую ночь в 03:40 и через 3 минуты после каждого деплоя | пока файл есть на сервере; файл, которого нет ни на диске, ни в базе, удаляется из копии через 13 дней. Если диск пуст или пропала треть копии разом — ничего не удаляется (`planErasures`) |
| Сайт и API | UptimeRobot проверяет главную и `/health` | каждые 5 минут | — |
| Сами бэкапы | Healthchecks.io ждёт отметку от каждого бэкапа | раз в сутки | — |

В бакете: `db/daily/ichiba-<дата>.dump` (или `.dump.gpg`, если задан пароль), `media/<как на диске>`; `db/monthly/` очищается (остался от прежнего срока 400 дней).

Бакет закрытый, доступ только по ключу, R2 сам шифрует данные на дисках. Пароль `BACKUP_PASSPHRASE` — дополнительная
защита, по желанию: с ним дамп без пароля не открыть, но **пароль потерян = бэкапы бесполезны**, поэтому хранить его
нужно вне Railway (в менеджере паролей). Сейчас владелец решил обойтись без пароля.

Пока переменные из шага 4 не заданы, оба бэкапа ничего не делают и пишут в лог, что не настроены.

## Настройка (один раз)

### 1. Хранилище R2

1. Cloudflare → **R2 Object Storage** → Create bucket, имя `ichiba-backup`, регион Automatic. Публичный доступ не
   включать. Бесплатно 10 ГБ; Cloudflare может попросить привязать карту даже для бесплатного объёма — если карта не
   проходит, берите Backblaze B2 (тоже 10 ГБ бесплатно), остальное так же.
2. R2 → **Manage API tokens** → Create API token: права **Object Read & Write**, только бакет `ichiba-backup`.
   Сохраните **Access Key ID**, **Secret Access Key** и **endpoint** вида `https://<account-id>.r2.cloudflarestorage.com`.

### 2. Пароль шифрования (по желанию)

Если нужен: длинная фраза (от 30 символов), сохранённая в менеджере паролей. Без него дампы хранятся как есть.

### 3. Healthchecks.io — узнать, что бэкап перестал делаться

healthchecks.io → бесплатный аккаунт → два чека: `ichiba db backup` и `ichiba media backup`, Period **1 day**,
Grace **3 hours**. Integrations → почта (или Telegram). Скопируйте Ping URL каждого чека.

### 4. Переменные в Railway

Railway → проект ichiba → **Settings → Shared Variables** (production), добавить:

```
BACKUP_S3_ENDPOINT=<endpoint из шага 1>
BACKUP_S3_BUCKET=ichiba-backup
BACKUP_S3_ACCESS_KEY_ID=<Access Key ID>
BACKUP_S3_SECRET_ACCESS_KEY=<Secret Access Key>
BACKUP_PASSPHRASE=<пароль из шага 2, по желанию>
BACKUP_DB_PING_URL=<Ping URL чека «db»>
BACKUP_MEDIA_PING_URL=<Ping URL чека «media»>
```

Сервисы **server** и **db-backup** уже ссылаются на них (`${{shared.BACKUP_…}}`), отдельно в каждый вписывать не
нужно. После сохранения Railway предложит применить изменения — применить (server перезапустится).

Первая копия фото начнётся через 3 минуты после перезапуска сервера и загрузит всё, что есть на диске (Railway
считает исходящий трафик — за один раз это центы). Дальше — только новые файлы. Если загрузка не удалась, ошибка
придёт админам в Telegram, как остальные ошибки сервера.

### 5. UptimeRobot — узнать, что сайт лёг

uptimerobot.com → бесплатный аккаунт → два монитора HTTP(s), интервал 5 минут:

- `https://ichiba.by/` — сайт;
- `https://server-production-8773.up.railway.app/health` — API.

Alert contacts → почта. (Проверьте условия бесплатного тарифа для коммерческих сайтов при регистрации.)

### 6. Первая проверка

- База: Railway CLI → `railway cron run` в сервисе db-backup (или дождаться 03:17). В логах строка вида
  `ichiba-2026-11-05T0017Z.dump.gpg: 52 tables, 840 KB`, в R2 — файл в `db/daily/`, в Healthchecks — зелёный чек.
- Фото: в логах server через 3 минуты после перезапуска `[MediaBackup] N files on the volume, N uploaded (… MB)`.

## Восстановление

### База

1. Скачайте нужный файл из R2 (Cloudflare → R2 → `ichiba-backup` → `db/daily/` → Download).
2. Если файл зашифрован (`.dump.gpg`), расшифруйте (в Git Bash на Windows `gpg` уже есть):
   ```bash
   gpg -d ichiba-2026-11-05T0017Z.dump.gpg > ichiba.dump
   ```
3. Сначала проверьте на пустой базе, не на проде. Например, локально в Docker:
   ```bash
   docker run -d --name restore-check -e POSTGRES_PASSWORD=check -p 55432:5432 postgres:18
   docker run --rm -v "$PWD:/b" --network host postgres:18 pg_restore --no-owner --no-privileges -d postgres://postgres:check@localhost:55432/postgres /b/ichiba.dump
   docker exec restore-check psql -U postgres -c 'select count(*) from "User"' -c 'select count(*) from "Listing"'
   ```
4. Настоящее восстановление после аварии: в Railway создайте новый Postgres, восстановите в него так же
   (`pg_restore --no-owner --no-privileges -d <адрес новой базы> ichiba.dump`; адрес снаружи — включите на время
   TCP Proxy у новой базы), затем у сервисов server и db-backup поменяйте `DATABASE_URL` на
   `${{<новый Postgres>.DATABASE_URL}}` и задеплойте.

### Фото

Railway → сервис server → `railway ssh` (Railway CLI), затем в контейнере:

```bash
node dist/backup/media-restore.js
```

Скачивает в `MEDIA_DIR` всё, чего нет на диске; уже лежащие файлы не трогает, можно запускать повторно.

### Проверка раз в месяц

Скачать последний дамп, расшифровать, восстановить в Docker (шаг 3 выше), сверить число пользователей и вещей
с админкой. Бэкап, который ни разу не восстанавливали, не считается.
