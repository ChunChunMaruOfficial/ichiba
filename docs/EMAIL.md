# Email / SMTP — ichiba

> Стек: NestJS + Nodemailer. Письма: коды подтверждения и сброса пароля, уведомления продавцам и брендам на привязанную почту.
> Всё включается переменными в `server/.env` — код менять не нужно.

## 1. Как это устроено

```
Браузер → Next.js → API (NestJS) → Nodemailer → SMTP (внешний сервер или локальный Postfix) → почтовый ящик
```

| Файл | Роль |
|------|------|
| `server/src/mail/mailer.ts` | Транспорт Nodemailer: читает `SMTP_*` из `.env`, при старте проверяет соединение и пишет результат в лог |
| `server/src/mail/templates.ts` | HTML- и текстовые шаблоны в палитре сайта: код подтверждения, уведомления (`NOTIFY_EMAIL_TYPES`) |
| `server/src/mail/mail.module.ts` | Очередь писем (таблица `EmailOutbox`) с повторами, `NotifyEmails`, отписка, отправка кодов |
| `server/src/users/notify-email.ts` | Привязка почты для уведомлений: код на адрес → подтверждение → `User.notifyEmail` |
| `server/src/auth/code-sender.service.ts` | Коды подтверждения и сброса пароля |
| `server/src/notifications/notifications.service.ts` | Важные уведомления дублируются письмом на привязанную почту |

**Какие письма уходят**
- Сразу, синхронно (пользователь ждёт на экране): код подтверждения почты, код сброса пароля, код привязки почты для уведомлений. Две попытки, при неудаче пользователь видит «Не получилось отправить письмо с кодом».
- Через очередь: уведомления продавцу или бренду — хотят купить, движение сделки, предложения цены, итоги аукционов, отзывы, споры, решения модерации и по статусу бренда (`NOTIFY_EMAIL_TYPES` в `templates.ts`). Остальное (снижение цен, каждая ставка, новинки подписок) остаётся только на сайте.

**Привязка.** Настройки → «Уведомления на почту» (видно продавцам и брендам): адрес → 6-значный код на этот адрес → `User.notifyEmail`. Почта входа, если подтверждена, привязывается в одно нажатие. Одна почта на аккаунт; новая заменяет старую.

**Очередь.** Письмо сначала сохраняется в `EmailOutbox` и отправляется сразу. Если почта недоступна, повтор через 1 мин, 5 мин, 30 мин, 2 ч, 6 ч, потом статус `FAILED` и запись в лог. Действие на сайте из-за почты не ломается и не ждёт.

**Отписка.** В каждом уведомлении есть ссылка «Отписаться» и заголовки `List-Unsubscribe` + `List-Unsubscribe-Post` (кнопка в Gmail и Яндекс Почте): отписка отвязывает почту. Коды подтверждения приходят всегда.

**Кому.** Только на `notifyEmail` (он всегда подтверждён кодом); заблокированным и удалённым не пишем.

Без `SMTP_HOST`/`GMAIL_*` (или с `MAIL_PROVIDER=log`) письма не отправляются: их текст печатается в лог API (удобно для разработки).

## 2. Вариант A: внешний SMTP (reg.ru, Яндекс 360, SendGrid, Mailgun…)

`server/.env`:
```env
SMTP_HOST=mail.hosting.reg.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@your-domain.by
SMTP_PASS=пароль_от_ящика
SMTP_FROM=info@your-domain.by
SMTP_FROM_NAME=ichiba
APP_URL=https://your-domain.by
```

- Порт `465` = SSL/TLS (`SMTP_SECURE=true`), порт `587` = STARTTLS (`SMTP_SECURE=false`). Если `SMTP_SECURE` не задан, для 465 включается TLS автоматически.
- `SMTP_FROM` обычно должен совпадать с `SMTP_USER`, иначе внешний сервер может отклонить письмо.
- Сертификат внешнего сервера проверяется. Если у провайдера самоподписанный сертификат, добавьте `SMTP_TLS_REJECT_UNAUTHORIZED=false`.

## 3. Вариант B: локальный Postfix (когда хостинг блокирует исходящие 465/587)

Postfix стоит на том же сервере, что и API, и доставляет письма напрямую через MX-запись домена получателя.

```bash
sudo apt install -y postfix
# При установке: Internet Site, System mail name: your-domain.by

# Домен не должен считаться локальным, иначе письма не уйдут наружу
sudo postconf -e "mydestination = localhost.localdomain, localhost"
# Многие MX (в т.ч. reg.ru) не поддерживают SMTPUTF8
sudo postconf -e "smtputf8_enable = no"
sudo postconf -e "myhostname = mail.your-domain.by"
sudo postconf -e "myorigin = your-domain.by"
# Без TLS на localhost
echo 'smtpd_tls_security_level = none' | sudo tee -a /etc/postfix/main.cf
echo 'smtp_tls_security_level = may' | sudo tee -a /etc/postfix/main.cf
sudo systemctl reload postfix
```

`server/.env`:
```env
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@your-domain.by
SMTP_FROM_NAME=ichiba
APP_URL=https://your-domain.by
```

`SMTP_USER` пустой — это нормально: письма включаются по одному `SMTP_HOST`. Для `localhost` проверка сертификата отключена автоматически (у Postfix он самоподписанный).

Проверка Postfix:
```bash
echo "Test body" | mail -s "SMTP Test" you@example.com
tail -20 /var/log/mail.log | grep -E "to=|status="
```
Успех выглядит как `status=sent (...)`.

**Чтобы письма не попадали в спам** (для Postfix обязательно): в DNS домена добавьте
- SPF: `v=spf1 ip4:IP_ВАШЕГО_СЕРВЕРА mx ~all`;
- DKIM (пакет `opendkim`) и DMARC: `v=DMARC1; p=none; rua=mailto:postmaster@your-domain.by`;
- PTR (обратная запись) для IP сервера на `mail.your-domain.by` — в панели хостинга.

## 4. Пароль со спецсимволами

API читает `.env` пакетом `dotenv` без подстановок, поэтому `$` и `'` в пароле безопасны, если записать значение **без кавычек**:
```env
SMTP_PASS=,f_Ab$cd'Ef
```
Самый надёжный способ на сервере — задать пароль переменной окружения (панель хостинга, systemd, `pm2 ... --update-env`): переменная окружения имеет приоритет над `.env`.

Проверить, что пароль прочитался целиком:
```bash
cd server && node -e "require('dotenv').config(); console.log('SMTP_PASS length:', process.env.SMTP_PASS?.length)"
```

## 5. Порты и блокировки хостинга

| Провайдер | 25 | 465 | 587 |
|---|---|---|---|
| Selectel | закрыт по умолчанию | закрыт | закрыт |
| Reg.ru (VPS) | часто закрыт | часто закрыт | часто закрыт |
| DigitalOcean | закрыт | открыт | открыт |
| AWS EC2 | закрыт | — | — |

Если соединение висит до таймаута, напишите в поддержку хостинга:
> Прошу разблокировать исходящий 25 порт (SMTP) на сервере с IP X.X.X.X для транзакционных писем сайта (подтверждение почты, сброс пароля, уведомления о заказах).

## 6. Проверка и диагностика

После запуска API смотрите лог:
- `SMTP ready: host:port (secure=…)` — соединение и авторизация в порядке;
- `SMTP check failed for host:port: …` — сервер недоступен или неверный логин; письма будут повторяться из очереди;
- `SMTP is not configured (SMTP_HOST empty)` — письма пишутся в лог.

Очередь в базе:
```sql
SELECT status, count(*) FROM "EmailOutbox" GROUP BY status;
SELECT "to", subject, attempts, "lastError" FROM "EmailOutbox" WHERE status <> 'SENT' ORDER BY "createdAt" DESC LIMIT 20;
```

| Ошибка в логе | Причина | Решение |
|---|---|---|
| `Connection timeout` / `ETIMEDOUT` | Порт закрыт хостингом | Вариант B (Postfix) или запрос в поддержку |
| `self-signed certificate` | Самоподписанный сертификат | `SMTP_TLS_REJECT_UNAUTHORIZED=false` |
| `Invalid login` / `535` | Неверный логин или пароль | Проверьте `SMTP_USER`/`SMTP_PASS` (раздел 4) |
| `553 Sender address rejected` | `SMTP_FROM` не совпадает с ящиком | `SMTP_FROM` = `SMTP_USER` |
| `status=bounced (unknown user)` в mail.log | Домен в `mydestination` | Уберите домен из `mydestination` |
| `SMTPUTF8 is required` | MX не поддерживает SMTPUTF8 | `postconf -e "smtputf8_enable = no"` |

## 7. Локальная проверка без настоящей почты

```bash
cd server
node _smtp-capture.mjs          # SMTP-приёмник на 127.0.0.1:2525, письма пишутся в _mails.jsonl
SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_SECURE=false node dist/main.js
node _e2e-v3.mjs email           # регистрация → письмо с кодом
node _e2e-v3.mjs deal            # сделка → письма продавцу и покупателю, отписка
```
