#!/usr/bin/env bash
#
# One-time server bootstrap for a fresh Ubuntu 24.04 box.
# Run as root:  bash setup.sh yourdomain.com
#
# Installs Node, Caddy (automatic HTTPS), Chromium (for HTML-template PDFs),
# a dedicated non-root user, a systemd service, and a firewall.

set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: bash setup.sh <domain>   e.g. bash setup.sh mailer.peachstrides.com" >&2
  exit 1
fi

APP_USER="app"
APP_DIR="/home/${APP_USER}/PeachStrideTools"
REPO="https://github.com/dejodammy/PeachStrideTools.git"

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Installing base packages"
apt-get install -y curl git ufw ca-certificates debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

echo "==> Enabling automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Installing Node.js 22 LTS"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version

echo "==> Installing Chromium (for HTML-template PDF generation)"
apt-get install -y chromium-browser || apt-get install -y chromium

echo "==> Installing Caddy (automatic HTTPS)"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "==> Creating '${APP_USER}' user"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi

echo "==> Cloning the repo"
if [ ! -d "$APP_DIR" ]; then
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi

echo "==> Installing dependencies and building the client"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm run setup && npm run build"

echo "==> Installing the systemd service"
install -m 644 "${APP_DIR}/deploy/bulk-mailer.service" /etc/systemd/system/bulk-mailer.service
systemctl daemon-reload
systemctl enable bulk-mailer

echo "==> Configuring Caddy for ${DOMAIN}"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy localhost:5000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> Allowing the deploy user to restart the service without a password"
cat > /etc/sudoers.d/bulk-mailer <<EOF
${APP_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart bulk-mailer, /bin/systemctl status bulk-mailer
EOF
chmod 440 /etc/sudoers.d/bulk-mailer

echo "==> Configuring the firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo
echo "============================================================"
echo " Almost done. Two manual steps left:"
echo
echo " 1. Create the environment file with your sender accounts:"
echo "      sudo -u ${APP_USER} nano ${APP_DIR}/server/.env"
echo "    (copy ${APP_DIR}/server/.env.example as a starting point)"
echo
echo " 2. Start it:"
echo "      systemctl start bulk-mailer"
echo "      systemctl status bulk-mailer"
echo
echo " Then visit: https://${DOMAIN}"
echo "============================================================"
