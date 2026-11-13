# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
# ffmpeg is only used to cut a poster frame for video thumbnails; the app works without it.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data LOCAL_ROOTS=/data/files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod --filter @superdrive/api...
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tini forwards SIGTERM so running transfers are paused cleanly and resume on the next start.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/api/dist/server.mjs"]
