# OW Studio: web app and generation worker in one container. Data (SQLite + images) lives on a volume at /data.
# Run exactly one instance: SQLite and the job leases assume a single writer host.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, for layer caching. Dev dependencies are kept: the worker runs TypeScript through tsx.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    OW_DATA_DIR=/data \
    PORT=3000
VOLUME ["/data"]
EXPOSE 3000

WORKDIR /app/apps/web
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.mjs"]
