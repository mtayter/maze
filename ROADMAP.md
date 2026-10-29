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

## 3. Google SSO (gates everything)

Reuse the mathsaic project's SSO setup (same Google client / flow).
Sign-in gates the whole app — no anonymous use.

- Every maze has an owner. All mazes that exist when SSO lands default
  to Mike.
- You can only edit (and save over) your own mazes. You can load
  anyone's maze, rename it, edit it, and save it as your own copy.
- Settings page: each player picks an avatar color, saved in the DB
  (used by multiplayer, phase 4).

## 4. Multiplayer

- Players in the same maze see each other, rendered in their avatar
  colors.
- Other players are part of collision: you can't move into a cell
  another player occupies.
- Spawn collision: if your start cell is occupied when you load a
  maze, you spawn at the closest open cell instead.
