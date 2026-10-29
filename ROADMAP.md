# Maze roadmap

Planned phases, in order. Each phase lands as its own commit (or small
set of commits) so changes stay isolated and reviewable.

## 1. SPA shell + version check ✅ (2026-10-29)

Single-page app: `public/index.html` is the only page; `app.js` is a
hash router (`#/play`, `#/create`) mounting view modules from
`public/views/`. Shared shell state carries the selected maze between
views. The old standalone `maze.html` / `draw.html` pages are gone (no
redirects kept — nothing external depends on them).

Version check: `index.html` carries a `<meta name="app-version">` stamp
and `version.json` carries the same value. The shell fetches
`version.json` (no-store) on load, on tab-visible, and every 15
minutes; if the deployed version is newer than the loaded one it
reloads once — unless the editor has unsaved changes, in which case it
shows a "new version available" banner instead. The stylesheet,
`app.js`, and every ES-module import carry a matching `?v=` query so
a stamp bump also busts stale cached subresources. Bump the meta
stamp, `version.json`, and every `?v=` query together in any commit
that changes files under `public/`.

## 2. Z-buffer renderer ✅ (2026-10-29)

Replaced the painter's-algorithm sort in `public/views/play.js` with
per-pixel depth rendering: `public/Raster.js` is a small software
rasterizer (inverse-z, perspective-correct for depth) that the play
view feeds with near-clipped, fan-triangulated panels. Outlines are
painted in the rasterizer along true polygon edges only — the fan's
internal diagonals are masked — so the old white-seam look is kept
without draw-order artifacts.

## 3. Google SSO (gates everything) ✅ (2026-10-29)

Reuses the mathsaic project's SSO setup — same Google OAuth client
(same origin, so no new Cloud Console setup) and the same flow: the
client signs in with Google Identity Services and POSTs the ID token
to `POST /app/maze/auth`; the server verifies it against Google's
tokeninfo endpoint (audience + expiry), upserts the user by Google
`sub`, and issues its own session — a random token whose SHA-256 hash
is stored, 30-day expiry, in an HttpOnly `maze_session` cookie.
`GET /app/maze/config` exposes the client ID; `GET /app/maze/me`
restores the session; `POST /app/maze/logout` ends it;
`POST /app/maze/settings` saves the avatar color.

Tables are singular: `user` (primary key `user_id`), `session`
(foreign key `user_id`), and `maze` gained a nullable `user_id`
owner column — the same column name everywhere. The migration runs
at server startup. Sign-in gates the whole app: the maze endpoints
answer 401 without a session, and the SPA shows only a sign-in
screen until signed in.

- Every maze has an owner. Mazes created before SSO have
  `user_id = NULL`; when the designated owner
  (`MAZE_OWNER_EMAIL`) signs in, all unowned mazes are claimed as
  theirs.
- You can only save over your own mazes (the server answers 403
  otherwise). You can load anyone's maze, rename it, edit it, and
  save it as your own copy — the editor shows who owns the loaded
  maze and guides the rename.
- Settings page (`#/settings`): each player picks an avatar color,
  saved on their `user` row (used by multiplayer, phase 4). The
  shell shows your photo, first name, and avatar-color dot, with
  sign-out.
- Editor save availability follows the name field (owner's
  refinement, 2026-10-29): Save is disabled whenever the current
  name isn't saveable by the signed-in user — someone else's maze
  under its own name, or any already-taken name — and re-enables
  when the name is changed to a free one. A blank name keeps Save
  enabled; clicking explains a name is needed. Typing a taken name
  errors on blur and pulls focus back until a different name is
  entered.

## 4. Multiplayer ✅ (2026-10-29)

Presence is ephemeral and lives in server memory — no database
writes. Clients POST their position to `/app/maze/presence` on every
move and turn (plus a 5-second heartbeat) and subscribe to the room
roster over Server-Sent Events at `/app/maze/events?maze=<name>`;
both endpoints require the session. The server broadcasts the roster
on every change and sweeps players silent for 30 seconds. Leaving
sends an explicit goodbye so cells free up immediately.

- Players in the same maze see each other as little standing
  figures (legs, torso, lighter head) in their avatar colors,
  rotated to their facing and depth-tested by the same z-buffer
  renderer as the walls. The figure's height follows the player's
  Grow/Shrink level — presence carries the eye height and the
  figure scales proportionally (4.0.1).
- Other players are part of collision: a move whose target cell is
  occupied is blocked, exactly like a wall bump.
- Spawn collision: joining reports your spawn position and reads
  back the roster; if your cell is taken, you relocate to the
  closest free cell (Manhattan rings) before anyone sees you
  standing inside another player.
