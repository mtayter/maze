import { getMazeData, listMazes } from './MazeDB.js';
import Maze from './Maze.js';
import Player from './Player.js';
import Map from './Map.js';
import { Rect3d, trianglize } from "./Geometry.js";

let maze, player, map;
let canvas, ctx;
let panels;
let fov, fx, fy;
let maze_triangles;
let winShown = false;
let mapPinned = false;

const wall_color = '#c0c0c0';
const floor_color = '#909090';
//const wall_color = 'red';
//const floor_color = 'blue';
const body_color = '#ffdbac';
const start_color = '#c00000';
const end_color = '#00c000';

function panelDist(quad, player, useMin = true) {
  // painter's algorithm using min or max of euclidean distance squared
  let dist = useMin ? Infinity : -Infinity;

  for (const v of quad) {
    const [x, y, z] = toCameraSpace(v, player);
    const d = x*x + y*y + z*z;
    dist = useMin ? Math.min(dist, d) : Math.max(dist, d);
  }

  return dist;
}

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

function project([xc,yc,zc]) {
  const xp = fx * (xc / zc);
  const yp = fy * (yc / zc);
  return [Math.round(canvas.width/2 + xp), Math.round(canvas.height/2 - yp)];
}

function transform([x,y,z]) {
  // rotate feet and legs to match player's angle and move to player's location
  const rx = x * Math.cos(player.yaw) - z * Math.sin(player.yaw);
  const rz = x * Math.sin(player.yaw) + z * Math.cos(player.yaw);
//  return [5.5 + rx, y, 0.5 + rz];
  return [player.x + rx, y, player.z + rz];
}

function draw() {
  if (!ctx || !player || !panels) {
    return;
  }

  ctx.fillStyle = "black";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const sprite = [
    Rect3d([-0.20,0,0.05],[0.20,0.2,0.15],body_color),
    Rect3d([-0.20,0,-0.05],[0.20,0.2,-0.15],body_color),
    Rect3d([-0.20,0.2,0.08],[-0.16,player.y*0.50,0.12],body_color),
    Rect3d([-0.20,0.2,-0.08],[-0.16,player.y*0.50,-0.12],body_color),
    Rect3d([-0.20,player.y*0.50,-0.15],[-0.16,player.y,0.15],body_color)
  ];
  const everything = [
    ...panels,
    ...sprite.flat(1).map(shape => ({
      verts: shape.verts.map(transform),
      color: shape.color
    }))
  ];

  const EPS = 1e-6;
  everything.sort((a, b) => {
    // painter's algorithm, sort by farthest first
    let wda = panelDist(a.verts, player, true);
    let wdb = panelDist(b.verts, player, true);
    if(Math.abs(wdb - wda) > EPS) {
      // based on nearest corner
      return wdb - wda;
    } else {
      // tie breaker: based on furthest corner
      wda = panelDist(a.verts, player, false);
      wdb = panelDist(b.verts, player, false);
      return wdb - wda;
    }
  });

  ctx.lineWidth = 2;
  ctx.strokeStyle = "white";
  for(let panel of everything) {
    const camVerts = panel.verts.map(v => toCameraSpace(v, player));
    const clipped = clipAgainstNearPlane(camVerts);
    if (clipped.length < 3) {
      continue; // too small to draw
    }
    const pts = clipped.map(v => project(v));
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for(let i=1; i<pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = panel.color;
    ctx.fill();
    ctx.stroke();
  }

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
  if(!wallBetween(player.x, player.z, ...player.whats(d))) {
    player.move(d);
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
}

function turn(d) {
  if (!player) return;
  player.turn(d);
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
  draw();
}
function shrink() {
  if (!player) return;
  player.shrink();
  draw();
}

function setMapVisible(visible) {
  if (!map) return;
  const btn = document.getElementById('mapBtn');
  if (visible) {
    map.resize();
    map.draw();
    map.show();
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

  maze_triangles = panels.flatMap(panel =>
    trianglize(panel.verts,"white",panel.color)
  );

  draw();
  map = new Map(maze,document.getElementById('mapCanvas'),start_color,end_color);

}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  fy = (canvas.height / 2) / Math.tan(fov / 2);
  fx = fy * (canvas.width / canvas.height);
}

async function init() {

  let app = document.getElementById('app');
  app.innerHTML = `
    <canvas id="mazeCanvas" class="game-canvas"></canvas>
    <canvas id="mapCanvas"></canvas>
    <div id="topbar">
      <span class="brand">🌀 Maze</span>
      <label class="field" for="mazeSelect">
        <select id="mazeSelect" aria-label="Choose a maze">
          <option value="">Pick a maze…</option>
        </select>
      </label>
      <a class="btn" href="draw.html" title="Create your own maze">✏️ Create</a>
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
  mazeSelect.addEventListener('change', async () => {
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
  });

  document.getElementById('mapBtn').addEventListener('click', () => {
    if (mazeSelect.value != '') toggleMap();
  });
  document.getElementById('growBtn').addEventListener('click', grow);
  document.getElementById('shrinkBtn').addEventListener('click', shrink);
  document.getElementById('winDismissBtn').addEventListener('click', hideWin);
  document.getElementById('errorDismissBtn').addEventListener('click', hideError);
  document.getElementById('mapCanvas').addEventListener('click', () => setMapVisible(false));

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
    btn.addEventListener('click', () => actions[btn.dataset.action]());
  });

  // iOS Safari ignores user-scalable=no; block its pinch gesture event.
  document.addEventListener('gesturestart', e => e.preventDefault());

  // Drag on the 3D view to turn / look — one step per ~36px of drag,
  // so a continuous swipe keeps turning. Primary pointer only, so a
  // second finger (e.g. an attempted pinch) doesn't spin the view.
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
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
  });
  const endDrag = (e) => { if (!drag || e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

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
        map.resize();
        map.draw();
        map.show();
      }
    }
  });

  window.addEventListener("keyup", function(e) {
    if(e.code == "KeyM") {
      if(map && !mapPinned) {
        map.hide();
      }
    }
  });

  window.addEventListener("resize", function() {
    resize();
    draw();
    if (map) {
      map.resize();
      map.draw();
    }
  });

}

await init();
