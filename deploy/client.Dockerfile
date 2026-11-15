# Site (Next.js) for a single VPS: docker compose builds it from the repo root (deploy/README.md).
FROM node:22-bookworm-slim AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./
# All of these are baked into the build: the /api rewrite (API_URL) and the browser bundle (NEXT_PUBLIC_*).
ARG API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_YM_ID
ARG NEXT_PUBLIC_LEGAL_EMAIL
ENV API_URL=$API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID \
    NEXT_PUBLIC_YM_ID=$NEXT_PUBLIC_YM_ID \
    NEXT_PUBLIC_LEGAL_EMAIL=$NEXT_PUBLIC_LEGAL_EMAIL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
# The build is the hungriest step on a 2 GB machine: the heap may grow into swap instead of dying.
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# The standalone server with only the traced dependencies; static files and public/ are copied next to it by hand.
COPY --from=build --chown=node:node /app/client/.next/standalone ./
COPY --from=build --chown=node:node /app/client/.next/static ./.next/static
COPY --from=build --chown=node:node /app/client/public ./public
# Read from process.cwd() at run time: journal articles (lib/journal.ts) and the fonts of the Open Graph image.
COPY --from=build --chown=node:node /app/client/content ./content
COPY --from=build --chown=node:node /app/client/assets ./assets
USER node
EXPOSE 3000
CMD ["node", "server.js"]
