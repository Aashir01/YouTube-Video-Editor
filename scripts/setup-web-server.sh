#!/usr/bin/env bash
# The Cutroom website (sign-in + one private studio per person) on the server that already runs
# Cutroom Cloud (see setup-cloud-server.sh). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/Aashir01/YouTube-Video-Editor/main/scripts/setup-web-server.sh | WEB_DOMAIN=cutroom.example.com bash
# WEB_DOMAIN needs an A record pointing at this server. Safe to run again: it updates and restarts
# (studios that are open restart too).
#   BRANCH=...      install another branch (default main)
#   APP_DIR=...     where the code is (default /home/cutroom/app, shared with Cutroom Cloud)
set -euo pipefail
WEB_DOMAIN="${WEB_DOMAIN:?Set WEB_DOMAIN, e.g. WEB_DOMAIN=cutroom.example.com}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/home/cutroom/app}"
WEB_DATA=/home/cutroom/web
echo "Setting up the Cutroom website at https://$WEB_DOMAIN (branch $BRANCH)"

echo "== 1/7 Video tools: FFmpeg, fonts, and what the render browser needs"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl caddy sqlite3 ffmpeg fonts-noto-color-emoji \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 \
  libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== 2/7 The code ($BRANCH)"
id cutroom >/dev/null 2>&1 || useradd -m -s /bin/bash cutroom
if [ -d "$APP_DIR/.git" ]; then
  sudo -u cutroom git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u cutroom git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  sudo -u cutroom git clone --branch "$BRANCH" https://github.com/Aashir01/YouTube-Video-Editor.git "$APP_DIR"
fi

echo "== 3/7 Packages, the editor UI and the render browser (a few minutes)"
cd "$APP_DIR"
sudo -u cutroom npm ci --no-audit --no-fund
sudo -u cutroom node bin/director.mjs build
sudo -u cutroom node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('render browser ready'))"

echo "== 4/7 Website settings (.env.hub)"
if [ ! -f "$APP_DIR/.env.hub" ]; then
  cat > "$APP_DIR/.env.hub" <<EOF
HUB_HOST=127.0.0.1
HUB_PORT=8080
HUB_DATA=$WEB_DATA
CLOUD_URL=http://127.0.0.1:8787
TRUST_PROXY=1
HUB_MAX_APPS=40
HUB_IDLE_MINUTES=20
STORAGE_FREE_MB=3000
STORAGE_CREATOR_MB=30000
MAX_UPLOAD_MB=4096
RENDER_CONCURRENCY=2
YOUTUBE_API_KEY=
EOF
  chown cutroom:cutroom "$APP_DIR/.env.hub" && chmod 600 "$APP_DIR/.env.hub"
fi
mkdir -p "$WEB_DATA" && chown cutroom:cutroom "$WEB_DATA"

echo "== 5/7 Keep it running (systemd), memory capped below the server's"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024*0.85)}' /proc/meminfo)
cat > /etc/systemd/system/cutroom-web.service <<EOF
[Unit]
Description=Cutroom website (sign-in and studios)
After=network.target cutroom-cloud.service

[Service]
User=cutroom
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning --import tsx src/hub/main.ts
Restart=always
RestartSec=3
MemoryMax=${MEM_MB}M
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cutroom-web
systemctl restart cutroom-web
# Cutroom Cloud runs from the same code: restart it on the new version too
systemctl list-unit-files cutroom-cloud.service >/dev/null 2>&1 && systemctl restart cutroom-cloud || true

echo "== 6/7 HTTPS for $WEB_DOMAIN (Caddy; the Cloud site is kept)"
if ! grep -q "^$WEB_DOMAIN {" /etc/caddy/Caddyfile 2>/dev/null; then
  cat >> /etc/caddy/Caddyfile <<EOF

$WEB_DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
EOF
fi
systemctl reload caddy || systemctl restart caddy

echo "== 7/7 Check"
for i in $(seq 1 30); do curl -fs 127.0.0.1:8080/hub/health >/dev/null && break; sleep 1; done
echo "Website: $(curl -s 127.0.0.1:8080/hub/health || echo 'not answering yet: journalctl -u cutroom-web -n 50')"
echo "Cloud:   $(curl -s 127.0.0.1:8787/v1/health || echo 'not answering: is Cutroom Cloud running on this server?')"
echo
echo "Open https://$WEB_DOMAIN and create an account."
echo "Optional: a YouTube Data API key in $APP_DIR/.env.hub (YOUTUBE_API_KEY) gives every studio the idea radar; then: systemctl restart cutroom-web"
