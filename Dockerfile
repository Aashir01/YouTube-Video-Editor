# Cutroom in a container.
#
#   docker compose up -d        then open http://localhost:3333
#
# Projects, settings and keys are kept in the "cutroom-data" volume (/data).
# API keys can also come from a .env file next to docker-compose.yml.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
# build the editor UI, then drop the build tools
RUN node bin/director.mjs build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
# FFmpeg for media, the libraries Chrome Headless Shell needs to render videos, and an emoji font
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-color-emoji \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
      libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production \
    DIRECTOR_DATA_DIR=/data
COPY --from=build --chown=node:node /app /app
USER node
# fetch the render browser now, so the first export needs no download
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('render browser ready'))"
VOLUME ["/data"]
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3333/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "bin/director.mjs", "start", "--host", "0.0.0.0", "--port", "3333", "--no-open"]
