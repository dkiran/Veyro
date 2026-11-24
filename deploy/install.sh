#!/usr/bin/env bash
# Deploys Veyro on a single Linux server (tested design for Amazon Linux 2023 / Ubuntu with systemd).
# Run from anywhere as your normal user (needs sudo):   ./deploy/install.sh
# Safe to run again after every `git pull` to update the live site.
#
# Modes:
#   ./deploy/install.sh                 Veyro owns ports 80/443: installs Caddy (automatic HTTPS) and serves the site itself.
#   ./deploy/install.sh --shared-proxy  Another reverse proxy already owns 80/443 (e.g. a Caddy in Docker). No Caddy is installed;
#                                       the API serves the web app too, on port 4000, for that proxy to forward to.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN_NAME="track.veyrotrack.com"
WEBROOT=/var/www/veyro
SHARED=0; [ "${1:-}" = "--shared-proxy" ] && SHARED=1

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
command -v node >/dev/null || { echo "Node.js not found. Install Node 22 first (nvm install 22)."; exit 1; }
command -v sudo >/dev/null || { echo "sudo is required"; exit 1; }
NODE_BIN="$(command -v node)"

say "Server dependencies"
cd "$REPO/server"
npm ci
if [ ! -f .env ]; then cp .env.example .env; fi
if ! grep -q '^JWT_SECRET=' .env || grep -qE '^JWT_SECRET=(change-me.*)?$' .env; then
  sed -i '/^JWT_SECRET=/d' .env
  echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
  echo "Generated a new JWT_SECRET in server/.env"
fi
chmod 600 .env

say "Building the web app"
cd "$REPO/web"
npm ci
npm run build
if [ "$SHARED" = 0 ]; then
  sudo mkdir -p "$WEBROOT"
  sudo rsync -a --delete "$REPO/web/dist/" "$WEBROOT/"
  sudo chmod -R a+rX "$WEBROOT"
fi

if [ "$SHARED" = 0 ]; then
  say "Installing Caddy (HTTPS web server)"
  if [ ! -x /usr/local/bin/caddy ]; then
    case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "Unsupported CPU: $(uname -m)"; exit 1;; esac
    sudo curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/local/bin/caddy
    sudo chmod +x /usr/local/bin/caddy
  fi
  getent group caddy >/dev/null || sudo groupadd --system caddy
  id caddy >/dev/null 2>&1 || sudo useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
  sudo mkdir -p /etc/caddy
  sudo cp "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
  sudo /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile
  sudo cp "$REPO/deploy/caddy.service" /etc/systemd/system/caddy.service
else
  say "Shared proxy mode: not installing Caddy"
  sudo systemctl disable --now caddy 2>/dev/null || true
fi

say "Installing the Veyro API service"
if [ "$SHARED" = 1 ]; then API_HOST=0.0.0.0; EXTRA="Environment=WEB_DIST=$REPO/web/dist"; else API_HOST=127.0.0.1; EXTRA=""; fi
sed -e "s|@USER@|$(id -un)|g" -e "s|@REPO@|$REPO|g" -e "s|@NODE@|$NODE_BIN|g" -e "s|@HOST@|$API_HOST|g" -e "s|@EXTRA_ENV@|$EXTRA|g" "$REPO/deploy/veyro-api.service" | sudo tee /etc/systemd/system/veyro-api.service >/dev/null

sudo systemctl daemon-reload
if [ "$SHARED" = 0 ]; then
  sudo systemctl enable --now caddy veyro-api
  sudo systemctl reload caddy || sudo systemctl restart caddy
else
  sudo systemctl enable --now veyro-api
fi
sudo systemctl restart veyro-api

say "Checking"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then echo "API is up (http://127.0.0.1:4000/api/health)"; break; fi
  sleep 2; [ "$i" = 10 ] && { echo "API did not start. Look at:  sudo journalctl -u veyro-api -n 50"; exit 1; }
done
echo
[ "$SHARED" = 1 ] && echo "Shared proxy mode: forward $DOMAIN_NAME to port 4000 on this machine (see README: shared proxy)."
echo "Done. Once DNS for $DOMAIN_NAME points at this server, open https://$DOMAIN_NAME"
echo "Logs:  sudo journalctl -u veyro-api -f     |     sudo journalctl -u caddy -f"
