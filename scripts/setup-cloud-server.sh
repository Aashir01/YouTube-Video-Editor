#!/usr/bin/env bash
# Cutroom Cloud (accounts, credits, the AI gateway) on a fresh Ubuntu 24.04 server, with HTTPS.
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/Aashir01/YouTube-Video-Editor/main/scripts/setup-cloud-server.sh | bash
# With your own domain (its A record pointing at this server):
#   curl -fsSL .../setup-cloud-server.sh | DOMAIN=cloud.example.com bash
# Without one it uses <ip>.sslip.io, a free name that points at this server's IP. Safe to run again (updates).
set -euo pipefail
if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -4 -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "Setting up Cutroom Cloud at https://$DOMAIN"

echo "== 1/7 Updates and tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y git caddy sqlite3 ufw unattended-upgrades curl openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version

echo "== 2/7 Firewall: only SSH, HTTP and HTTPS"
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

echo "== 3/7 The code"
id cutroom >/dev/null 2>&1 || useradd -m -s /bin/bash cutroom
if [ -d /home/cutroom/app/.git ]; then sudo -u cutroom git -C /home/cutroom/app pull --ff-only
else sudo -u cutroom git clone https://github.com/Aashir01/YouTube-Video-Editor.git /home/cutroom/app; fi
cd /home/cutroom/app && sudo -u cutroom npm ci --omit=dev --omit=optional --no-audit --no-fund

echo "== 4/7 Settings (.env.cloud)"
if [ ! -f /home/cutroom/app/.env.cloud ]; then
  cat > /home/cutroom/app/.env.cloud <<EOF
OPENROUTER_API_KEY=
ADMIN_TOKEN=$(openssl rand -hex 32)
CLOUD_HOST=127.0.0.1
CLOUD_PORT=8787
CLOUD_DB=/home/cutroom/cloud.db
TRUST_PROXY=1
CONTACT_URL=
EOF
  chown cutroom:cutroom /home/cutroom/app/.env.cloud && chmod 600 /home/cutroom/app/.env.cloud
fi

echo "== 5/7 Keep it running (systemd)"
cat > /etc/systemd/system/cutroom-cloud.service <<'EOF'
[Unit]
Description=Cutroom Cloud
After=network.target

[Service]
User=cutroom
WorkingDirectory=/home/cutroom/app
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning --import tsx src/cloud/main.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now cutroom-cloud

echo "== 6/7 HTTPS (Caddy)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "== 7/7 Daily backup of the accounts database (keeps 7 days)"
( crontab -u cutroom -l 2>/dev/null | grep -v cloud.db; echo '0 3 * * * sqlite3 /home/cutroom/cloud.db ".backup /home/cutroom/backup-$(date +\%a).db"' ) | crontab -u cutroom -

sleep 3
echo
echo "Local check:  $(curl -s 127.0.0.1:8787/v1/health || echo 'not answering yet')"
echo "Open in a browser:  https://$DOMAIN/v1/health"
echo "Next: put your OpenRouter key in /home/cutroom/app/.env.cloud, then: systemctl restart cutroom-cloud"
echo "Your admin token (keep it secret):"
grep ADMIN_TOKEN /home/cutroom/app/.env.cloud
