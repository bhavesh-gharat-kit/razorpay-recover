#!/usr/bin/env bash
#
# One-time (idempotent-where-reasonable) provisioning script for a fresh
# Ubuntu VPS. Documents every step rather than fully automating the parts
# that need a human to make a judgment call (DB password, domain name,
# TLS) — read it top to bottom before running, don't just execute blind.
#
# Usage: run in pieces, or as a whole with:
#   sudo bash deploy/provision.sh
#
# Assumes: Ubuntu 22.04+ LTS, run as a sudo-capable user (not root
# directly — create a deploy user first if you're starting from a fresh
# root-only box).
#
# After this script: see the "Deploy the app" section of
# docs/operations.md for cloning the repo, migrating, seeding, and
# starting PM2.

set -euo pipefail

echo "=== 1. System packages ==="
apt-get update
apt-get upgrade -y

echo "=== 2. Node.js LTS (via NodeSource) ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "=== 3. MySQL 8.0+ ==="
if ! command -v mysql >/dev/null 2>&1; then
  apt-get install -y mysql-server
  systemctl enable --now mysql
fi

echo "=== 4. PM2 (global) ==="
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "=== 5. Nginx ==="
if ! command -v nginx >/dev/null 2>&1; then
  apt-get install -y nginx
  systemctl enable --now nginx
fi

echo "=== 6. Certbot ==="
if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y certbot python3-certbot-nginx
fi

echo "=== 7. Firewall (ufw) — SSH + HTTP + HTTPS only ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

cat <<'EOF'

=== 8. MySQL production database + app user (manual — run as root/sudo) ===

Do NOT use the MySQL root user in the app's DATABASE_URL. Create a
dedicated, least-privilege app user instead:

  sudo mysql <<'SQL'
  CREATE DATABASE recover_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'recover'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_RANDOM_PASSWORD';
  GRANT ALL PRIVILEGES ON recover_prod.* TO 'recover'@'localhost';
  FLUSH PRIVILEGES;
  SQL

Generate the password with `openssl rand -base64 24` — don't reuse the
dev password from .env.example. Put it in the production `.env`'s
DATABASE_URL, and in a `~/.my.cnf` (mode 600) for deploy/backup.sh:

  [client]
  user=recover
  password=REPLACE_WITH_A_STRONG_RANDOM_PASSWORD

=== 9. Deploy user's SSH key + repo clone (manual) ===

  git clone <your-repo-url> /home/deploy/recover
  cd /home/deploy/recover
  cp .env.example .env
  # edit .env with real production values (see .env.example's comments
  # for what each key is and where it comes from)

=== Next: see docs/operations.md "Deploy an update" for the build +
    migrate + seed + pm2 start sequence, and deploy/nginx.conf +
    Certbot for the HTTPS front end. ===
EOF
