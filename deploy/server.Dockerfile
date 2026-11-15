# API (NestJS) for a single VPS: docker compose builds it from the repo root (deploy/README.md).
# Debian, not Alpine: sharp and onnxruntime-node (the local photo-search model) ship glibc binaries.
FROM node:22-bookworm-slim AS build
WORKDIR /app/server
# The lockfile, .npmrc (skips onnxruntime's CUDA download) and the Prisma schema first: `npm ci` runs
# `prisma generate` on postinstall, and this layer is reused until dependencies or the schema change.
COPY server/package.json server/package-lock.json server/.npmrc server/prisma.config.ts ./
COPY server/prisma ./prisma
RUN npm ci --no-audit --no-fund \
  # onnxruntime-node ships its binaries for every platform (about 290 MB); the image runs on Linux x64 only.
  && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32 \
       node_modules/onnxruntime-node/bin/napi-v6/linux/arm64 \
  && npm cache clean --force >/dev/null 2>&1
COPY server/tsconfig.json server/nest-cli.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends openssl ca-certificates >/dev/null \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/media /data/models && chown -R node:node /data
ENV NODE_ENV=production
# The server must start from server/: hand-listings read seed-data/ and the bot its avatar from process.cwd().
WORKDIR /app/server
# node_modules as built, dev dependencies included: `prisma migrate deploy` needs the prisma CLI, a devDependency.
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./dist
COPY --chown=node:node server/package.json server/prisma.config.ts ./
COPY --chown=node:node server/prisma ./prisma
COPY --chown=node:node server/assets ./assets
# Source photos of hand-listed sellers (about 236 MB): its own layer, rebuilt only when the folder changes.
COPY --chown=node:node server/seed-data ./seed-data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The same order as on Railway: migrations first (a no-op when there are none), then the API.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
