#!/usr/bin/env bash
#
# Pull the latest code, rebuild, restart. Run as the 'app' user:
#   bash ~/PeachStrideTools/deploy/deploy.sh
#
# The GitHub Action (.github/workflows/deploy.yml) runs this on every push to
# master, so this normally happens automatically.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Pulling latest"
git pull --ff-only

echo "==> Installing dependencies"
npm run setup

echo "==> Building client"
npm run build

echo "==> Restarting service"
sudo systemctl restart bulk-mailer

sleep 3
sudo systemctl status bulk-mailer --no-pager --lines=10
echo "==> Deployed"
