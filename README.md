# Maze

A first-person 3D maze game in the browser, plus a maze editor. The
frontend is a single-page app: one shell (`public/index.html`) with two
hash-routed views.

- **Play** (`#/play`) — walk a maze in first-person view (canvas-rendered
  3D), from the start marker to the end marker.
- **Create** (`#/create`) — draw walls on a grid, set start/end and the
  start direction, and save the maze to the database.

Mazes are stored in a database and shared: anything saved in the editor is
immediately playable in the game.

**Version stamp:** `index.html` carries a `<meta name="app-version">`
stamp and `public/version.json` carries the same value. The shell checks
`version.json` (no-store) on load, when the tab becomes visible, and every
15 minutes; if the deployed version is newer than the loaded shell it
reloads once (or shows an update banner when the editor has unsaved
changes). The stylesheet, `app.js`, and every ES-module import also carry
a matching `?v=<version>` query, so a stamp bump busts stale cached
subresources too (a reload alone revalidates the document but browsers
may still serve heuristically-cached CSS/JS). **In any commit that
changes files under `public/`, bump all of them together: the meta
stamp, `version.json`, and every `?v=` query.**

Future plans (z-buffer renderer, Google SSO, multiplayer) are in
[ROADMAP.md](ROADMAP.md).

## Architecture

```
Browser (static files in public/)
  │  GET /maze/ (index.html SPA shell), *.js, *.css, *.png, version.json
  │  fetch() calls to /app/maze/*
  ▼
Apache (or any reverse proxy + static host)
  ├── serves public/ as /maze/
  └── proxies /app/maze/* → 127.0.0.1:<port>
        ▼
Node.js API (server/maze.js, Express)
        │  POST /app/maze/get   { maze }        → one maze (h/v as JSON arrays)
        │  GET  /app/maze/list                  → [{ name }, ...]
        │  POST /app/maze/save   { maze, h, v, start_x, start_y, end_x, end_y, direction }
        ▼
MySQL / MariaDB — one table, `maze` (see schema.sql)
```

The API binds `127.0.0.1` by default and is meant to sit behind a reverse
proxy — it has no auth of its own. Anyone who can reach the API can list,
read, and save mazes.

## Requirements

- **Node.js 18+** (tested on Node 22) + npm — runs the API server.
- **MySQL 8 / MariaDB 10+** — stores mazes. The installer can create the
  database, user, and table for you, or you can point it at an existing
  database.
- **systemd** (user units) — the installer runs the API as a
  `maze.service` user unit. Without systemd, run the server manually (see
  below).
- **Apache with mod_proxy** (optional) — serves the static frontend and
  proxies `/app/maze/` to the API. Any static host + reverse proxy works.

## Install

```sh
./install.sh
```

The installer:

1. Prompts for the database credentials (**host, port, database name,
   username, password**) and the listen address (host/port).
2. Writes them to a config file **outside the repo checkout**, default
   `~/.config/maze/config.env`, with **0600** permissions.
   Re-running reuses the saved values as defaults — press Enter to keep
   them, or type a new value to change it.
3. Optionally creates the database + DB user with a MySQL admin account
   (the admin password is used once and never stored), then creates the
   `maze` table from `schema.sql`.
4. Runs `npm install` for the API dependencies (`express`, `mysql2`).
5. Installs a systemd user unit (`maze.service`), enables it, and
   (re)starts it. Safe to re-run: the unit file is overwritten, never
   duplicated.

Non-interactive install (for scripted setups):

```sh
MAZE_DB_HOST=localhost MAZE_DB_PORT=3306 MAZE_DB_NAME=maze \
MAZE_DB_USER=maze_app MAZE_DB_PASSWORD='<db-password>' \
MAZE_HOST=127.0.0.1 MAZE_PORT=3000 MAZE_CREATE_DB=n \
./install.sh --non-interactive
```

`MAZE_CONFIG_FILE` overrides the config path; `MAZE_ADMIN_USER` /
`MAZE_ADMIN_PASSWORD` are used only when `MAZE_CREATE_DB=y`.

Then serve the frontend and proxy the API (needs sudo; the installer
prints these steps too):

```sh
sudo mkdir -p /var/www/html/maze
sudo cp -r public/* /var/www/html/maze/
sudo cp apache-proxy.conf.example /etc/apache2/conf-available/maze.conf
sudo a2enconf maze
sudo systemctl reload apache2
```

Open `https://<your-host>/maze/` to play (the editor is the Create tab,
or `#/create`). To keep the user service running after logout:

```sh
loginctl enable-linger "$USER"
```

### Without systemd

```sh
MAZE_CONFIG_FILE=~/.config/maze/config.env node server/maze.js
```

## Configuration

All settings come from environment variables, optionally loaded from a
config file. The server reads `MAZE_CONFIG_FILE`
(default `~/.config/maze/config.env`) first; real environment variables
take precedence over the file.

| Variable | Meaning | Default |
|---|---|---|
| `MAZE_DB_HOST` | Database host | `localhost` |
| `MAZE_DB_PORT` | Database port | `3306` |
| `MAZE_DB_NAME` | Database name | `maze` |
| `MAZE_DB_USER` | Database user | `maze_app` |
| `MAZE_DB_PASSWORD` | Database password | *(required)* |
| `MAZE_HOST` | API listen host | `127.0.0.1` |
| `MAZE_PORT` | API listen port | `3000` |
| `MAZE_CONFIG_FILE` | Config file path | `~/.config/maze/config.env` |

Config file format is `KEY="value"` per line; see `config.env.example`
for a template with placeholder values. **Never commit the real config
file** — it is gitignored, lives outside the checkout, and is mode 0600.
The DB password is a runtime credential the app must present to the
database, so it is stored as-is (not hashed); the protection is the
gitignored 0600 file, never the repo.

## Database schema

One table (`schema.sql`):

```sql
CREATE TABLE maze (
  name      VARCHAR(255) NOT NULL,
  h         LONGTEXT     NOT NULL,
  v         LONGTEXT     NOT NULL,
  start_x   INT          NOT NULL,
  start_y   INT          NOT NULL,
  end_x     INT          NOT NULL,
  end_y     INT          NOT NULL,
  direction CHAR(1)      NOT NULL,
  PRIMARY KEY (name)
);
```

`h` / `v` are JSON-encoded wall arrays (horizontal / vertical segments);
`direction` is the player's start direction, one of `e`, `n`, `w`, `s`.

## Project layout

```
install.sh                Interactive + --non-interactive installer
server/maze.js            API server (Express + MySQL). No secrets in code.
public/                   Static browser frontend (SPA: game + editor)
  index.html              The shell (top bar, nav, update banner)
  app.js                  Hash router + version check
  views/play.js           The game view
  views/create.js         The editor view
  version.json            Deployed version stamp (keep in sync with index.html)
  Maze.js, Map.js, Geometry.js, Player.js, MazeDB.js, maze.css
  start.png, end.png     Start / end markers
schema.sql                Creates the maze table
config.env.example        Config template (placeholders only)
apache-proxy.conf.example Apache reverse-proxy snippet
package.json              API dependencies (express, mysql2)
```

## Security notes

- The DB credentials used to be hardcoded in the server source. They are
  now entirely in the gitignored 0600 config file / environment; the code
  contains no credential values.
- The API has no authentication: keep it on `127.0.0.1` behind a reverse
  proxy, and do not expose its port directly.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).
