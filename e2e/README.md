# E2E stand

Everything runs locally against its own database; nothing reaches the AI providers, Telegram, Gmail, Cloudinary or
the production site. Built for the 2026-11-09 pass; the API scripts (`server/_e2e-*.mjs`) and the Maestro web flows
(`e2e/maestro`) both use it.

## 1. Database (port 51310)

```bash
cd server && LOCALAPPDATA='D:\tools\prisma-dev-local' npx prisma dev --name ichiba-e2e --port 51311 --db-port 51310 --shadow-db-port 51312
```

`prisma dev` keeps its data under `%LOCALAPPDATA%\prisma-dev-nodejs` (it overrides any other data-root setting): drive C
is nearly full on this machine and the database once died mid-run with «database or disk is full», so the stand's
`LOCALAPPDATA` points at drive D.

The integration tests can share it: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:51310/template1?sslmode=disable npm run test:int`
(they wipe it, so seed again afterwards). Seed (≈30 min on PGlite, 180 items with photos):

```bash
cd server && DATABASE_URL='postgres://postgres:postgres@localhost:51310/template1?sslmode=disable' DATABASE_POOL_MAX=1 SEED_DEMO=true MEDIA_DIR=storage/e2e-media PHOTO_EMBED_LOCAL=off PHOTO_EMBED_GEMINI=off GEMINI_API_KEY= MISTRAL_API_KEY= ZAI_API_KEY= npx tsx prisma/seed.ts --reset
```

## 2. API (port 4100) and site (port 3100)

`npm --prefix server run build`, then the `api-e2e` launch configuration (`.claude/launch.json`): the built server with
every external key blanked, crons off, e-mail to the local SMTP sink (`node server/_smtp-capture.mjs`, port 2525) and
`AUTH_DEV_ANY_CODE=true` (any 6-digit code signs in).

The site must be built for this API (rewrites are fixed at build time):

```bash
cd client && API_URL=http://localhost:4100 NEXT_PUBLIC_SITE_URL=http://localhost:3100 npx next build
```

then the `client-e2e` launch configuration (`next start -p 3100`).

## 3. API scenarios

```bash
cd server && E2E_API=http://127.0.0.1:4100 DATABASE_URL='postgres://postgres:postgres@localhost:51310/template1?sslmode=disable' JWT_SECRET=e2e-only-secret-e2e-only-secret-e2e-only node _e2e-hardening.mjs
```

`_e2e-auth`, `_e2e-chat`, `_e2e-deals-chat`, `_e2e-v4` and `_e2e-media-cleanup` run the same way (add
`MEDIA_DIR='D:\ichiba\server\storage\e2e-media' CRON_SECRET=e2e-secret`). `_e2e-v3` needs the SMTP sink
(`server/_mails.jsonl` is read whole: empty it before a run). `_e2e-ai` (live AI ensemble) and `_e2e-cloudinary` (real
Cloudinary account) are not for this stand.

Publishing a listing needs the AI photo check, which is off here (no keys): whatever creates and publishes a new
listing fails on this stand by design — `_e2e-v4` from its first publish, `_e2e-v3` from its auction section.

Last full run, 2026-11-09: hardening 19/19, chat 47/47, deals-chat 16/16, auth 16/16, media-cleanup 10/10, v3 26 up to
the auction section, v4 5 up to its first publish.

## 4. Maestro web flows

Maestro CLI 2.12.1 lives in `D:\tools\maestro` (Java 17+: the Adoptium JDK 21). Its web driver downloads Chrome for
Testing (no Chrome on this machine); `run.mjs` points that cache and every temp folder at `D:\tools`. With the stand up:

```bash
node e2e/maestro/run.mjs                 # every flow
node e2e/maestro/run.mjs 03-search.yaml  # one flow
```

`run.mjs` picks a real item from the stand's database, makes an unsubscribe token for a seeded account and passes both
to the flows as variables. Reports and screenshots go to `e2e/maestro/out` (not committed). Last run 2026-11-09: 6/6.

The integration tests can reuse the stand's database, but they wipe it: seed again afterwards.
