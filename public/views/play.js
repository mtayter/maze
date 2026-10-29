// Play view: first-person 3D maze game.
// mount(el, shared) renders into el; unmount() aborts every listener
// registered during mount (all use the mount's AbortSignal).
//
// Rendering: draw() rasterizes every panel with the software z-buffer
// in Raster.js (per-pixel inverse-z depth; no draw-order dependence).

import { getMazeData, listMazes } from '../MazeDB.js?v=4.1.2';
import Maze from '../Maze.js?v=4.1.2';
import Player from '../Player.js?v=4.1.2';
import Map from '../Map.js?v=4.1.2';
import { Rect3d } from "../Geometry.js?v=4.1.2";
import { clearFrame, drawTriangle, packColor, WHITE } from '../Raster.js?v=4.1.2';
import * as Multiplayer from '../Multiplayer.js?v=4.1.2';
import { getUser } from '../Auth.js?v=4.1.2';

let maze, player, map;
let canvas, ctx;
let panels;
let fov, fx, fy;
let winShown = false;

// How far the self-view figure is shifted back so the camera sits
// just in front of the face (see draw()).
const EYE_FORWARD = 0.135;
// Z-buffer render targets, (re)allocated when the canvas size changes.
let offCanvas = null, offCtx = null, imgData = null, pix32 = null, zbuf = null;
// NOTE: a plain object, not a Map — the imported Maze Map class
// shadows the global Map constructor throughout this module.
const colorCache = Object.create(null);
function packed(hex) {
  let c = colorCache[hex];
  if (c === undefined) {
    c = packColor(hex);
    colorCache[hex] = c;
  }
  return c;
}
let mapPinned = false;
let ac = null; // AbortController for this mount's listeners
let viewEl = null;
// This view's own memory, independent of the editor: which maze was
// loaded here, and where the player stood in it. Module scope survives
// unmount/remount, so switching views restores the game as left.
let lastMaze = '';
let restoreState = null;

const wall_color = '#c0c0c0';
const floor_color = '#909090';
const body_color = '#ffdbac';
const start_color = '#c00000';
const end_color = '#00c000';

function toCameraSpace([x,y,z], p) {
  // distance from camera
  const dx = x - p.x;
  const dy = y - p.y;
  const dz = z - p.z;

  // rotate for turned left/right
  const yaw_s = Math.sin(Math.PI/2 - p.yaw);
  const yaw_c = Math.cos(Math.PI/2 - p.yaw);
  let x1 = dx * yaw_c - dz * yaw_s;
  let y1 = dy;
  let z1 = dx * yaw_s + dz * yaw_c;

  // rotate for looking up/down
  const pitch_s = Math.sin(p.pitch);
  const pitch_c = Math.cos(p.pitch);
  return [
    x1,
    y1 * pitch_c - z1 * pitch_s,
    y1 * pitch_s + z1 * pitch_c
  ];
}

function clipAgainstNearPlane(verts, near=0.1) {
  const clipped = [];
  for (let i = 0; i < verts.length; i++) {
    const curr = verts[i];
    const next = verts[(i+1) % verts.length];
    const insideCurr = curr[2] >= near;
    const insideNext = next[2] >= near;

    if (insideCurr) {
      clipped.push(curr);
    }

    if (insideCurr !== insideNext) {
      // Find intersection with near plane
      const t = (near - curr[2]) / (next[2] - curr[2]);
      const ix = curr[0] + t * (next[0] - curr[0]);
      const iy = curr[1] + t * (next[1] - curr[1]);
      clipped.push([ix, iy, near]);
    }
  }
  return clipped;
}

function transformFor([x, y, z], px, pz, yaw) {
  // rotate a body-local point to match an angle and move to a location
  const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
  const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
  return [px + rx, y, pz + rz];
}

function transform(v) {
  return transformFor(v, player.x, player.z, player.yaw);
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.55);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function myPos() {
  return { x: player.x, z: player.z, yaw: player.yaw, y: player.y };
}

// The one and only player figure: legs, torso, and a lighter head,
// in an avatar color, scaled by Grow/Shrink level (eye height
// relative to the standard 0.5). Other players are drawn from all
// three parts; your own view uses the same parts (minus the head —
// your camera sits in it), pitch-gated so the forward view stays
// clear: legs appear once you look down a couple of steps, the
// torso a step further. Because the figure scales with eye
// height, those angles are the same at every size.
function personParts(color, s) {
  return {
    legs: Rect3d([-0.16, 0, -0.09], [0.16, 0.45 * s, 0.09], color),
    torso: Rect3d([-0.19, 0.45 * s, -0.11], [0.19, 0.8 * s, 0.11], color),
    head: Rect3d([-0.11, 0.8 * s, -0.11], [0.11, 1.0 * s, 0.11], lighten(color)),
  };
}

function personPanels(p) {
  const color = p.avatar_color || '#888888';
  const s = (typeof p.y === 'number' ? p.y : 0.5) / 0.5;
  const parts = personParts(color, s);
  return [parts.legs, parts.torso, parts.head].flat(1).map(shape => ({
    verts: shape.verts.map(v => transformFor(v, p.x, p.z, p.yaw)),
    color: shape.color,
  }));
}

function ensureBuffers() {
  if (!offCanvas || offCanvas.width !== canvas.width || offCanvas.height !== canvas.height) {
    offCanvas = document.createElement('canvas');
    offCanvas.width = canvas.width;
    offCanvas.height = canvas.height;
    offCtx = offCanvas.getContext('2d');
    imgData = offCtx.createImageData(canvas.width, canvas.height);
    pix32 = new Uint32Array(imgData.data.buffer);
    zbuf = new Float32Array(canvas.width * canvas.height);
  }
}

function draw() {
  if (!ctx || !player || !panels) {
    return;
  }

  ensureBuffers();
  const W = canvas.width;
  const H = canvas.height;
  clearFrame(pix32, zbuf);

  // Own body: the same figure everyone else sees (own avatar color,
  // own scale), minus the head, pitch-gated (see personParts) — but
  // drawn shifted backward by EYE_FORWARD (scaled by Grow/Shrink,
  // like the figure itself), as if the eyes stick out from the
  // front of the face: the face front (0.11 ahead of the figure's
  // center) ends up just behind the camera while the leg and torso
  // fronts (0.16 / 0.19) stay just ahead of it, so looking down
  // shows the FRONT of the body instead of the box interiors.
  // Self view only; everyone else sees the figure at its true spot.
  const me = getUser();
  const myScale = player.y / 0.5;
  const myParts = personParts((me && me.avatar_color) || body_color, myScale);
  const sprite = [];
  if (player.pitch < -0.28) {
    sprite.push(myParts.legs);
  }
  if (player.pitch < -0.55) {
    sprite.push(myParts.torso);
  }
  const eyeShift = EYE_FORWARD * myScale;
  const everything = [
    ...panels,
    ...sprite.flat(1).map(shape => ({
      verts: shape.verts.map(([x, y, z]) => transform([x - eyeShift, y, z])),
      color: shape.color
    })),
    ...Multiplayer.getOthers().flatMap(personPanels)
  ];

  // Z-buffer: draw order no longer matters; each panel is clipped to
  // the near plane, projected with inverse-z, and fan-triangulated
  // into the rasterizer. The fan's internal diagonals are masked out
  // of edge painting so quads don't grow fake seams.
  for (const panel of everything) {
    const camVerts = panel.verts.map(v => toCameraSpace(v, player));
    const clipped = clipAgainstNearPlane(camVerts);
    if (clipped.length < 3) {
      continue; // behind the camera / too small to draw
    }
    const pts = clipped.map(([xc, yc, zc]) => [
      W / 2 + fx * (xc / zc),
      H / 2 - fy * (yc / zc),
      1 / zc,
    ]);
    const fill32 = packed(panel.color);
    const n = pts.length;
    for (let j = 1; j <= n - 2; j++) {
      // Triangle (p0, pj, pj+1). Edge mask: the edge opposite p0 is
      // (pj, pj+1) — always a true polygon edge; opposite pj is
      // (pj+1, p0) — true only for the closing edge (j+1 == n-1);
      // opposite pj+1 is (p0, pj) — true only for the first edge.
      drawTriangle(pix32, zbuf, W, H,
        pts[0], pts[j], pts[j + 1],
        fill32, WHITE,
        [true, j + 1 === n - 1, j === 1]);
    }
  }

  offCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(offCanvas, 0, 0);
}

// Check if point q lies on segment pr
function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) &&
         q.x >= Math.min(p.x, r.x) &&
         q.y <= Math.max(p.y, r.y) &&
         q.y >= Math.min(p.y, r.y);
}

function orientation(p, q, r) {
  const Ax = p.x - q.x;
  const Ay = p.y - q.y;
  const Bx = r.x - q.x;
  const By = r.y - q.y;
  const cross_product = (Ax * By) - (Ay * Bx);
  if(cross_product == 0) {
    return 0;
  } else {
    return (cross_product > 0) ? 1 : -1; // 1 = counter-clockwise, -1 = clockwise
  }
}

// returns true if segments p1p2 and q1q2 intersect
function segmentsIntersect(p1, p2, q1, q2) {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);

  // General case
  if (o1 !== o2 && o3 !== o4) return true;

  // Special cases (collinear)
  if (o1 === 0 && onSegment(p1, q1, p2)) return true;
  if (o2 === 0 && onSegment(p1, q2, p2)) return true;
  if (o3 === 0 && onSegment(q1, p1, q2)) return true;
  if (o4 === 0 && onSegment(q1, p2, q2)) return true;

  return false; // no intersection
}

function wallBetween(x1, y1, x2, y2) {
  for (let panel of panels) {
    if(panel.color == wall_color) {
      if(segmentsIntersect(
        {x: x1, y: y1},
        {x: x2, y: y2},
        {x: panel.verts[0][0], y: panel.verts[0][2]},
        {x: panel.verts[1][0], y: panel.verts[1][2]}
      )) {
        return true;
      }
    }
  }
  return false;
}

function showWin() {
  document.getElementById('winBanner').classList.add('show');
}
function hideWin() {
  document.getElementById('winBanner').classList.remove('show');
}
function showError(message) {
  document.getElementById('errorText').textContent = message;
  document.getElementById('errorBanner').classList.add('show');
}
function hideError() {
  document.getElementById('errorBanner').classList.remove('show');
}

function move(d) {
  if (!player || !maze) {
    return;
  }
  const [tx, tz] = player.whats(d);
  if (wallBetween(player.x, player.z, tx, tz)) {
    return;
  }
  // Other players are solid: their cell can't be entered.
  const occupied = Multiplayer.getOthers().some(p =>
    Math.floor(p.x) === Math.floor(tx) && Math.floor(p.z) === Math.floor(tz));
  if (occupied) {
    return;
  }
  player.move(d);
  Multiplayer.update(myPos());
  if(Math.floor(player.x) == maze.end_x && Math.floor(player.z) == maze.end_y) {
    if (!winShown) {
      winShown = true;
      showWin();
    }
  } else {
    winShown = false;
  }
  draw();
}

function turn(d) {
  if (!player) return;
  player.turn(d);
  Multiplayer.update(myPos());
  draw();
}

function look(d) {
  if (!player) return;
  player.look(d);
  draw();
}

function grow() {
  if (!player) return;
  player.grow();
  Multiplayer.update(myPos());
  draw();
}
function shrink() {
  if (!player) return;
  player.shrink();
  Multiplayer.update(myPos());
  draw();
}

function setMapVisible(visible) {
  if (!map) return;
  const btn = document.getElementById('mapBtn');
  if (visible) {
    map.show();
    map.resize();
    map.draw();
  } else {
    map.hide();
  }
  mapPinned = visible;
  if (btn) btn.setAttribute('aria-pressed', String(visible));
}
function toggleMap() {
  setMapVisible(!mapPinned);
}

async function populateMazeSelect() {
  const mazeSelect = document.getElementById('mazeSelect');
  let mazes = await listMazes();
  mazeSelect.length = 1;
  mazes.forEach(m => {
    mazeSelect.add(new Option(m.name, m.name));
  });
}

async function loadMaze(mazeName) {

  let color;

  try {
    maze = await getMazeData(mazeName);
  } catch (err) {
    console.error('Failed to get maze data:', err);
    showError(`Couldn't load “${mazeName}”. The maze server hiccuped — pick it again in a moment.`);
    return;
  }

  winShown = false;
  hideWin();
  hideError();
  setMapVisible(false);
  player = new Player(maze.start_x + 0.5, maze.start_y + 0.5, maze.directionRad);
  if (restoreState && restoreState.maze === mazeName) {
    player.x = restoreState.x;
    player.y = restoreState.y;
    player.z = restoreState.z;
    player.yaw = restoreState.yaw;
    player.pitch = restoreState.pitch;
    winShown = restoreState.winShown;
    if (winShown) {
      showWin();
    }
    restoreState = null;
  }

  panels = [];

  for(let x=0; x<maze.h.length; x++) {
    for(let z=0; z<maze.v.length; z++) {
      if(x == maze.start_x && z == maze.start_y) {
        color = start_color;
      } else if(x == maze.end_x && z == maze.end_y) {
        color = end_color;
      } else {
        color = floor_color;
      }

      panels.push({
        verts: [
          [x,0,z],
          [x+1,0,z],
          [x+1,0,z+1],
          [x,0,z+1]
        ],
        color: color
      });
    }
  }

  // horizontal walls
  for(let x=0; x<maze.h.length; x++) {
    for(let z=0; z<=maze.v.length; z++) {
      if(maze.h[x][z]) {
        panels.push({
          verts: [
            [x, 0, z],
            [x+1, 0, z],
            [x+1, 1, z],
            [x, 1, z],
          ],
          color: wall_color
        });
      }
    }
  }
  // vertical walls
  for(let z=0; z<maze.v.length; z++) {
    for(let x=0; x<=maze.h.length; x++) {
      if(maze.v[z][x]) {
        panels.push({
          verts: [
            [x, 0, z],
            [x, 0, z+1],
            [x, 1, z+1],
            [x, 1, z],
          ],
          color: wall_color
        });
      }
    }
  }

  draw();
  map = new Map(maze,document.getElementById('mapCanvas'),start_color,end_color);

  activeMaze = mazeName;
  joinMultiplayer(mazeName);
}

// Multiplayer session for the loaded maze. Joining reports our spawn
// position; the roster that comes back settles spawn collisions: if
// someone already stands on our cell, we move to the closest free
// one. Later roster changes simply redraw (draw reads the roster).
let activeMaze = '';
let joinSeq = 0;

async function joinMultiplayer(mazeName) {
  const seq = ++joinSeq;
  let players;
  try {
    players = await Multiplayer.join(mazeName, myPos(), () => draw());
  } catch (err) {
    console.error('Multiplayer join failed:', err);
    return;
  }
  if (seq !== joinSeq || mazeName !== activeMaze || !player) {
    return; // a newer load superseded this join
  }
  const me = getUser();
  const occupied = (players || [])
    .filter(p => !me || p.user_id !== me.user_id)
    .map(p => [Math.floor(p.x), Math.floor(p.z)]);
  const cellX = Math.floor(player.x);
  const cellZ = Math.floor(player.z);
  const spot = Multiplayer.findSpawn(occupied, cellX, cellZ, maze.h.length, maze.v.length);
  if (spot.x !== cellX || spot.z !== cellZ) {
    player.x = spot.x + 0.5;
    player.z = spot.z + 0.5;
    draw();
  }
  Multiplayer.update(myPos());
}

function resize() {
  // The view sits below the shell bar, so size to the view, not the window.
  canvas.width = viewEl.clientWidth || window.innerWidth;
  canvas.height = viewEl.clientHeight || window.innerHeight;
  fy = (canvas.height / 2) / Math.tan(fov / 2);
  fx = fy * (canvas.width / canvas.height);
}

export async function mount(el, shared) {
  ac = new AbortController();
  const signal = ac.signal;
  viewEl = el;
  maze = player = map = panels = null;
  winShown = false;
  mapPinned = false;

  el.className = 'view-play';
  el.innerHTML = `
    <canvas id="mazeCanvas" class="game-canvas"></canvas>
    <canvas id="mapCanvas"></canvas>
    <div id="topbar">
      <label class="field" for="mazeSelect">
        <select id="mazeSelect" aria-label="Choose a maze">
          <option value="">Pick a maze…</option>
        </select>
      </label>
    </div>
    <div class="hint-pill">WASD to move &nbsp;·&nbsp; Arrows to turn &amp; look &nbsp;·&nbsp; T / G grow &amp; shrink &nbsp;·&nbsp; Hold M for map &nbsp;·&nbsp; Drag to look around</div>
    <div class="touch-controls" aria-label="Touch controls">
      <div>
        <div class="pad" role="group" aria-label="Move">
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="forward" aria-label="Move forward">⬆️</button>
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="left" aria-label="Move left">⬅️</button>
          <span class="pad-label">Move</span>
          <button class="btn" type="button" data-action="right" aria-label="Move right">➡️</button>
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="backward" aria-label="Move backward">⬇️</button>
          <span class="spacer"></span>
        </div>
      </div>
      <div class="mid-controls">
        <button class="btn mid-btn" id="mapBtn" type="button" aria-pressed="false" title="Map (M)">🗺️ Map</button>
        <div class="mid-size">
          <button class="btn mid-btn" id="growBtn" type="button" title="Grow taller (T)">➕ Grow</button>
          <button class="btn mid-btn" id="shrinkBtn" type="button" title="Shrink (G)">➖ Shrink</button>
        </div>
      </div>
      <div>
        <div class="pad" role="group" aria-label="Look and turn">
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="look-up" aria-label="Look up">⬆️</button>
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="turn-left" aria-label="Turn left">⬅️</button>
          <span class="pad-label">Look</span>
          <button class="btn" type="button" data-action="turn-right" aria-label="Turn right">➡️</button>
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="look-down" aria-label="Look down">⬇️</button>
          <span class="spacer"></span>
        </div>
      </div>
    </div>
    <div class="win-banner" id="winBanner" role="dialog" aria-modal="false" aria-labelledby="winTitle">
      <div class="win-card">
        <div class="win-emoji">🎉</div>
        <h2 id="winTitle">Great job!</h2>
        <p>You found your way out of the maze.</p>
        <button class="btn btn-primary" id="winDismissBtn" type="button">Keep exploring</button>
      </div>
    </div>
    <div class="win-banner" id="errorBanner" role="alertdialog" aria-modal="false" aria-labelledby="errorTitle">
      <div class="win-card">
        <div class="win-emoji">😵‍💫</div>
        <h2 id="errorTitle">That maze didn't load</h2>
        <p id="errorText"></p>
        <button class="btn btn-primary" id="errorDismissBtn" type="button">OK</button>
      </div>
    </div>
  `;

  canvas = document.getElementById('mazeCanvas');
  ctx = canvas.getContext('2d');
  fov = 100 * Math.PI / 180;
  resize();
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await populateMazeSelect();

  const mazeSelect = document.getElementById("mazeSelect");
  if (lastMaze) {
    mazeSelect.value = lastMaze;
    if (mazeSelect.value === lastMaze) {
      await loadMaze(lastMaze);
    }
  }
  mazeSelect.addEventListener('change', async () => {
    lastMaze = mazeSelect.value;
    restoreState = null; // a freshly picked maze starts at its start
    if(mazeSelect.value != '') {
      try {
        mazeSelect.blur();
        await loadMaze(mazeSelect.value);
      } catch (err) {
        console.error('Failed to get maze data:', err);
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, { signal });

  document.getElementById('mapBtn').addEventListener('click', () => {
    if (mazeSelect.value != '') toggleMap();
  }, { signal });
  document.getElementById('growBtn').addEventListener('click', grow, { signal });
  document.getElementById('shrinkBtn').addEventListener('click', shrink, { signal });
  document.getElementById('winDismissBtn').addEventListener('click', hideWin, { signal });
  document.getElementById('errorDismissBtn').addEventListener('click', hideError, { signal });
  document.getElementById('mapCanvas').addEventListener('click', () => setMapVisible(false), { signal });

  const actions = {
    'forward': () => move('forward'),
    'backward': () => move('backward'),
    'left': () => move('left'),
    'right': () => move('right'),
    'turn-left': () => turn('left'),
    'turn-right': () => turn('right'),
    'look-up': () => look('up'),
    'look-down': () => look('down'),
  };
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => actions[btn.dataset.action](), { signal });
  });

  // Drag on the 3D view to turn / look — one step per ~36px of drag,
  // so a continuous swipe keeps turning. Primary pointer only, so a
  // second finger (e.g. an attempted pinch) doesn't spin the view.
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, { signal });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !player || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const STEP = 36;
    if (Math.abs(dx) >= STEP && Math.abs(dx) >= Math.abs(dy)) {
      turn(dx > 0 ? 'right' : 'left');
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else if (Math.abs(dy) >= STEP) {
      look(dy < 0 ? 'up' : 'down');
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  }, { signal });
  const endDrag = (e) => { if (!drag || e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag, { signal });
  canvas.addEventListener('pointercancel', endDrag, { signal });
  canvas.addEventListener('pointerleave', endDrag, { signal });

  window.addEventListener("keydown", e => {
    if(e.code == "ArrowUp") {
      look('up');
    } else if(e.code == "ArrowDown") {
      look('down');
    } else if(e.code == "ArrowLeft") {
      turn('left');
    } else if(e.code == "ArrowRight") {
      turn('right');
    } else if(e.code == "KeyW") {
      move('forward');
    } else if(e.code == "KeyA") {
      move('left');
    } else if(e.code == "KeyS") {
      move('backward');
    } else if(e.code == "KeyD") {
      move('right');
    } else if(e.code == "KeyT") {
      grow();
    } else if(e.code == "KeyG") {
      shrink();
    } else if(e.code == "KeyM") {
      if(e.repeat) {
        return;
      }
      if(mazeSelect.value != '' && map) {
        map.show();
        map.resize();
        map.draw();
      }
    }
  }, { signal });

  window.addEventListener("keyup", function(e) {
    if(e.code == "KeyM") {
      if(map && !mapPinned) {
        map.hide();
      }
    }
  }, { signal });

  window.addEventListener("resize", function() {
    resize();
    draw();
    if (map) {
      map.resize();
      map.draw();
    }
  }, { signal });

}

export function unmount() {
  Multiplayer.leave();
  activeMaze = '';
  joinSeq++;
  if (player && lastMaze) {
    restoreState = {
      maze: lastMaze,
      x: player.x, y: player.y, z: player.z,
      yaw: player.yaw, pitch: player.pitch,
      winShown,
    };
  }
  if (ac) {
    ac.abort();
    ac = null;
  }
  maze = player = map = panels = canvas = ctx = viewEl = null;
}
