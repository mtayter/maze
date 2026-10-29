#!/usr/bin/env bash
#
# Maze installer.
#
# Installs the maze game server (Node.js API + MySQL + static frontend):
#   - prompts for DB credentials (host, port, database, user, password) and
#     the listen address, reusing the existing config as defaults on re-run
#   - writes config OUTSIDE the repo checkout, default
#     ~/.config/maze/config.env, mode 0600
#   - optionally creates the database + DB user via a MySQL admin account
#     (admin password is used transiently and never stored)
#   - installs dependencies (npm install) and a systemd user unit
#     (maze.service), enabled and (re)started
#   - prints the Apache reverse-proxy + static-file steps (manual: they
#     need sudo and vary by setup)
#
# Idempotent: safe to re-run. Re-running reuses saved values as defaults,
# overwrites (never appends to) the config file and the systemd unit, and
# regenerates nothing (this project has no generated tokens).
#
# Non-interactive mode:
#   ./install.sh --non-interactive
# reads all values from the environment instead of prompting:
#   MAZE_DB_HOST, MAZE_DB_PORT, MAZE_DB_NAME, MAZE_DB_USER,
#   MAZE_DB_PASSWORD (required), MAZE_HOST, MAZE_PORT,
#   MAZE_CONFIG_FILE (default ~/.config/maze/config.env),
#   MAZE_CREATE_DB (y/n, default n),
#   MAZE_ADMIN_USER, MAZE_ADMIN_PASSWORD (only when MAZE_CREATE_DB=y).
# Existing config values are still used as defaults for anything not set
# in the environment.
#
# Security notes: no `set -x` in this script (it would echo secrets into
# logs). Passwords are read with `read -s`, never echoed, and passed to
# the mysql client via MYSQL_PWD (not a command-line argument, which
# would be visible in `ps` output).
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${MAZE_CONFIG_FILE:-$HOME/.config/maze/config.env}"
NON_INTERACTIVE=0

usage() {
  echo "Usage: $0 [--non-interactive] [--help]"
  echo "  --non-interactive  Read all values from environment variables (see header)."
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

# --- config-file helpers -----------------------------------------------------
# File format: KEY="value", one per line, # comments. The writer escapes
# backslash, double-quote, dollar, and backtick with a backslash; the
# reader reverses that.

quote_value() {
  # Escape \ " $ ` then wrap in double quotes.
  local v="${1//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//\$/\\\$}"
  v="${v//\`/\\\`}"
  printf '"%s"' "$v"
}

unescape_value() {
  local s="$1" out="" i c
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:$i:1}"
    if [[ "$c" == '\' && $((i + 1)) -lt ${#s} ]]; then
      i=$((i + 1))
      out+="${s:$i:1}"
    else
      out+="$c"
    fi
  done
  printf '%s' "$out"
}

config_get() {
  # config_get KEY FILE -> value (empty if absent)
  local key="$1" file="$2" line raw
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  raw="${line#*=}"
  if [[ "$raw" == \"*\" && "$raw" == *\" && ${#raw} -ge 2 ]]; then
    raw="${raw:1:${#raw}-2}"
    unescape_value "$raw"
  else
    printf '%s' "$raw"
  fi
}

# --- prompts -----------------------------------------------------------------

prompt_with_default() {
  # prompt_with_default "Prompt text" default_value -> prints value to stdout
  local prompt="$1" def="$2" val
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    printf '%s' "$def"
    return 0
  fi
  if [[ -n "$def" ]]; then
    printf '%s [%s]: ' "$prompt" "$def" >&2
  else
    printf '%s: ' "$prompt" >&2
  fi
  IFS= read -r val || true
  if [[ -z "$val" ]]; then printf '%s' "$def"; else printf '%s' "$val"; fi
}

prompt_password() {
  # prompt_password "Prompt text" has_existing(0/1) -> prints password to stdout
  local prompt="$1" has_existing="$2" val
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    printf '%s' "${MAZE_DB_PASSWORD:-}"
    return 0
  fi
  if [[ "$has_existing" -eq 1 ]]; then
    printf '%s (Enter to keep existing): ' "$prompt" >&2
  else
    printf '%s: ' "$prompt" >&2
  fi
  IFS= read -rs val || true
  printf '\n' >&2
  printf '%s' "$val"
}

prompt_yes_no() {
  # prompt_yes_no "Question" default(y/n) -> prints y or n
  local prompt="$1" def="$2" val
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    printf '%s' "$def"
    return 0
  fi
  printf '%s [%s]: ' "$prompt" "$def" >&2
  IFS= read -r val || true
  val="${val:-$def}"
  case "$val" in
    y|Y|yes|YES) printf 'y' ;;
    *) printf 'n' ;;
  esac
}

# --- collect values (existing config -> defaults) ----------------------------

existing_db_host="$(config_get MAZE_DB_HOST "$CONFIG_FILE")"
existing_db_port="$(config_get MAZE_DB_PORT "$CONFIG_FILE")"
existing_db_name="$(config_get MAZE_DB_NAME "$CONFIG_FILE")"
existing_db_user="$(config_get MAZE_DB_USER "$CONFIG_FILE")"
existing_db_password="$(config_get MAZE_DB_PASSWORD "$CONFIG_FILE")"
existing_host="$(config_get MAZE_HOST "$CONFIG_FILE")"
existing_port="$(config_get MAZE_PORT "$CONFIG_FILE")"

if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
  db_host="${MAZE_DB_HOST:-$existing_db_host}"
  db_port="${MAZE_DB_PORT:-$existing_db_port}"
  db_name="${MAZE_DB_NAME:-$existing_db_name}"
  db_user="${MAZE_DB_USER:-$existing_db_user}"
  db_password="${MAZE_DB_PASSWORD:-}"
  listen_host="${MAZE_HOST:-$existing_host}"
  listen_port="${MAZE_PORT:-$existing_port}"
  create_db="${MAZE_CREATE_DB:-n}"
else
  db_host="$(prompt_with_default "Database host" "${existing_db_host:-localhost}")"
  db_port="$(prompt_with_default "Database port" "${existing_db_port:-3306}")"
  db_name="$(prompt_with_default "Database name" "${existing_db_name:-maze}")"
  db_user="$(prompt_with_default "Database user" "${existing_db_user:-maze_app}")"
  if [[ -n "$existing_db_password" ]]; then
    db_password="$(prompt_password "Database password" 1)"
    [[ -n "$db_password" ]] || db_password="$existing_db_password"
  else
    db_password="$(prompt_password "Database password" 0)"
  fi
  listen_host="$(prompt_with_default "Listen host (keep 127.0.0.1; use a reverse proxy)" "${existing_host:-127.0.0.1}")"
  listen_port="$(prompt_with_default "Listen port" "${existing_port:-3000}")"
  create_db="$(prompt_yes_no "Create the database and DB user now with a MySQL admin account?" "n")"
fi

# Apply built-in defaults for anything still empty.
db_host="${db_host:-localhost}"
db_port="${db_port:-3306}"
db_name="${db_name:-maze}"
db_user="${db_user:-maze_app}"
listen_host="${listen_host:-127.0.0.1}"
listen_port="${listen_port:-3000}"
create_db="${create_db:-n}"

if [[ -z "$db_password" ]]; then
  echo "Error: database password is required (set MAZE_DB_PASSWORD in non-interactive mode)." >&2
  exit 1
fi

# --- write config (0600, outside the repo) -----------------------------------

config_dir="$(dirname "$CONFIG_FILE")"
mkdir -p "$config_dir"
chmod 700 "$config_dir"

old_umask="$(umask)"
umask 077
{
  echo "# Maze server config — generated by install.sh. Do NOT commit this file."
  echo "# Format: KEY=\"value\". Real environment variables override this file."
  echo "MAZE_DB_HOST=$(quote_value "$db_host")"
  echo "MAZE_DB_PORT=$(quote_value "$db_port")"
  echo "MAZE_DB_NAME=$(quote_value "$db_name")"
  echo "MAZE_DB_USER=$(quote_value "$db_user")"
  echo "MAZE_DB_PASSWORD=$(quote_value "$db_password")"
  echo "MAZE_HOST=$(quote_value "$listen_host")"
  echo "MAZE_PORT=$(quote_value "$listen_port")"
} > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
umask "$old_umask"
echo "Wrote config: $CONFIG_FILE (0600)"

# --- database setup -----------------------------------------------------------

sql_escape() {
  # Escape for a single-quoted SQL string literal: \ -> \\, ' -> ''.
  local v="${1//\\/\\\\}"
  v="${v//\'/\'\'}"
  printf '%s' "$v"
}

if ! command -v mysql >/dev/null 2>&1; then
  echo "WARNING: mysql client not found; skipping database setup."
  echo "  Create the database + user manually, then run:"
  echo "    mysql -h $db_host -P $db_port -u $db_user -p $db_name < $APP_DIR/schema.sql"
elif [[ "$create_db" == "y" ]]; then
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    admin_user="${MAZE_ADMIN_USER:-root}"
    admin_password="${MAZE_ADMIN_PASSWORD:-}"
  else
    admin_user="$(prompt_with_default "MySQL admin user" "root")"
    admin_password="$(prompt_password "MySQL admin password (used once, never stored)" 0)"
  fi
  if [[ "$db_host" == "localhost" || "$db_host" == "127.0.0.1" ]]; then
    grant_host="localhost"
  else
    grant_host="%"
  fi
  MYSQL_PWD="$admin_password" mysql -h "$db_host" -P "$db_port" -u "$admin_user" <<SQL
CREATE DATABASE IF NOT EXISTS \`$(sql_escape "$db_name")\`;
CREATE USER IF NOT EXISTS '$(sql_escape "$db_user")'@'$(sql_escape "$grant_host")' IDENTIFIED BY '$(sql_escape "$db_password")';
GRANT ALL PRIVILEGES ON \`$(sql_escape "$db_name")\`.* TO '$(sql_escape "$db_user")'@'$(sql_escape "$grant_host")';
FLUSH PRIVILEGES;
SQL
  echo "Created database '$db_name' and user '$db_user'@'$grant_host'."
  MYSQL_PWD="$db_password" mysql -h "$db_host" -P "$db_port" -u "$db_user" "$db_name" < "$APP_DIR/schema.sql"
  echo "Created maze table."
else
  if MYSQL_PWD="$db_password" mysql -h "$db_host" -P "$db_port" -u "$db_user" "$db_name" < "$APP_DIR/schema.sql" 2>/dev/null; then
    echo "Created/verified maze table."
  else
    echo "WARNING: could not create the maze table with the app credentials"
    echo "  (user may lack CREATE privileges). Create it manually, e.g.:"
    echo "    mysql -h $db_host -P $db_port -u <admin> -p $db_name < $APP_DIR/schema.sql"
  fi
fi

# --- dependencies -------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Install Node.js 18+ (tested on Node 22), then re-run this script." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Install npm (ships with Node.js), then re-run this script." >&2
  exit 1
fi
npm install --prefix "$APP_DIR" --no-audit --no-fund
echo "Installed Node dependencies."

# --- systemd user service (idempotent: unit file overwritten, not duplicated) -

NODE_BIN="$(command -v node)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
{
  echo "[Unit]"
  echo "Description=Maze game API server"
  echo "After=network.target"
  echo ""
  echo "[Service]"
  echo "Type=simple"
  echo "WorkingDirectory=$APP_DIR"
  if [[ "$CONFIG_FILE" != "$HOME/.config/maze/config.env" ]]; then
    echo "Environment=MAZE_CONFIG_FILE=$CONFIG_FILE"
  fi
  echo "EnvironmentFile=$CONFIG_FILE"
  echo "ExecStart=$NODE_BIN $APP_DIR/server/maze.js"
  echo "Restart=on-failure"
  echo ""
  echo "[Install]"
  echo "WantedBy=default.target"
} > "$UNIT_DIR/maze.service"

if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable maze.service >/dev/null
  if systemctl --user is-active -q maze.service; then
    systemctl --user restart maze.service
    echo "Restarted maze.service."
  else
    systemctl --user start maze.service
    echo "Started maze.service."
  fi
  systemctl --user status maze.service --no-pager || true
else
  echo "WARNING: systemd user manager not available; service not started."
  echo "  Start the server manually:"
  echo "    MAZE_CONFIG_FILE=$CONFIG_FILE node $APP_DIR/server/maze.js"
fi

# --- next steps ----------------------------------------------------------------

cat <<EOF

Done.
  Config:  $CONFIG_FILE (0600, outside the repo)
  Service: maze.service (systemd user unit; 'systemctl --user status maze.service')

To keep the service running after logout, enable lingering once:
  loginctl enable-linger "\$USER"

Still manual (needs sudo; varies by setup) — serve the frontend + proxy the API:
  1. Copy the static frontend into your web root, e.g.:
       sudo mkdir -p /var/www/html/maze
       sudo cp -r $APP_DIR/public/* /var/www/html/maze/
  2. Install the Apache proxy snippet (see apache-proxy.conf.example):
       sudo cp $APP_DIR/apache-proxy.conf.example /etc/apache2/conf-available/maze.conf
       sudo a2enconf maze
       sudo systemctl reload apache2
  3. Open https://<your-host>/maze/ to play (editor: the Create tab).
EOF
