// Create view: maze editor.
// mount(el, shared) renders into el; unmount() aborts every listener
// registered during mount. Edits set shared.editorDirty so the shell's
// version check never force-reloads over unsaved work; saving clears it.

import Maze from '../Maze.js';
import { saveMazeData, listMazes, getMazeData } from '../MazeDB.js';

let canvas, ctx, wrap, win_width, win_height, cell_size, offsetX = 24, offsetY = 24;
let h = null, v = null, selector = "walls";
let startX = -1, startY = -1, endX = -1, endY = -1;
let ac = null;
let sharedRef = null;

function setDirty(dirty) {
  if (sharedRef) {
    sharedRef.editorDirty = dirty;
  }
}

async function save_maze() {
  let new_maze = document.getElementById("name").value.trim();
  if (!new_maze) {
    alert('Give your maze a name first.');
    return;
  }
  if (startX < 0 || endX < 0) {
    alert('Place a start (red) and an end (green) square first.');
    return;
  }
  let taken = false;
  document.querySelector('#mazeSelect').querySelectorAll('option').forEach(maze => {
    if(new_maze == maze.value) {
      taken = true;
    }
  });
  if (taken) {
    alert('That name is already taken.');
    return;
  }
  await saveMazeData(new_maze,h,v,startX,startY,endX,endY,document.getElementById("directionSelect").value);
  setDirty(false);
  if (sharedRef) {
    sharedRef.mazeName = new_maze;
  }
  await populateMazeSelect();
  document.querySelector('#mazeSelect').value = new_maze;
}

function x(x) {
  return x * cell_size + offsetX;
}
function y(y) {
  return win_height - y * cell_size - offsetY;
}
function createline(x0, y0, x1, y1, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(x(x0),y(y0));
  ctx.lineTo(x(x1),y(y1));
  ctx.stroke();
}
function createbox(x0, y0, color) {
  ctx.fillStyle = color;
  ctx.lineWidth = 10;
  ctx.fillRect(x(x0)+ctx.lineWidth, y(y0+1)+ctx.lineWidth, cell_size - ctx.lineWidth*2, cell_size - ctx.lineWidth*2);
}

function layout() {
  if (!h || !v) return;
  const maze_width = h.length;
  const maze_height = v.length;
  const margin = 24;
  cell_size = Math.max(8, Math.trunc(Math.min((win_width - margin * 2) / maze_width, (win_height - margin * 2) / maze_height)));
  offsetX = Math.trunc((win_width - cell_size * maze_width) / 2);
  offsetY = Math.trunc((win_height - cell_size * maze_height) / 2);
}

function render() {
  if (!h || !v || !ctx) return;
  layout();
  const maze_width = h.length;
  const maze_height = v.length;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < maze_width; x++) {
    for (let y = 0; y <= maze_height; y++) {
      createline(x, y, x + 1, y, h[x][y] ? '#000000' : '#e2e8f0');
    }
  }
  for (let y = 0; y < maze_height; y++) {
    for (let x = 0; x <= maze_width; x++) {
      createline(x, y, x, y + 1, v[y][x] ? '#000000' : '#e2e8f0');
    }
  }
  if (startX > -1) createbox(startX, startY, '#f00000');
  if (endX > -1) createbox(endX, endY, '#00c853');
}

function draw_blank_maze() {
  startX = startY = endX = endY = -1;
  let maze_width = parseInt(document.getElementById('width').value) || 10;
  let maze_height = parseInt(document.getElementById('height').value) || 10;

  document.getElementById("name").value = "";
  document.querySelector('input[name="selectorRadio"][value="walls"]').click();
  document.getElementById("directionSelect").selectedIndex = 0;
  document.getElementById("mazeSelect").selectedIndex = 0;

  // Horizontal walls
  h = [];
  for (let x = 0; x < maze_width; x++) {
    h[x] = [];
    for (let y = 0; y <= maze_height; y++) {
      h[x][y] = (y === 0 || y === maze_height) ? 1 : 0;
    }
  }

  // Vertical walls
  v = [];
  for (let y = 0; y < maze_height; y++) {
    v[y] = [];
    for (let x = 0; x <= maze_width; x++) {
      v[y][x] = (x === 0 || x === maze_width) ? 1 : 0;
    }
  }

  setDirty(false);
  render();
}

function draw_loaded_maze(name, new_h, new_v, start_x, start_y, end_x, end_y, direction) {

  h = new_h;
  v = new_v;

  document.getElementById('width').value = h.length;
  document.getElementById('height').value = v.length;

  document.getElementById("name").value = name;
  document.querySelector('input[name="selectorRadio"][value="walls"]').click();

  document.querySelector('#directionSelect').value = direction;

  startX = start_x;
  startY = start_y;
  endX = end_x;
  endY = end_y;

  setDirty(false);
  render();
}

async function populateMazeSelect() {
  const mazeSelect = document.getElementById('mazeSelect');
  let mazes = await listMazes();
  mazeSelect.length = 1;
  mazes.forEach(maze => {
    mazeSelect.add(new Option(maze.name, maze.name));
  });
}

function fitCanvas() {
  win_width = wrap.clientWidth;
  win_height = wrap.clientHeight;
  canvas.width = win_width;
  canvas.height = win_height;
}

export async function mount(el, shared) {
  ac = new AbortController();
  const signal = ac.signal;
  sharedRef = shared;
  h = v = null;
  selector = "walls";
  startX = startY = endX = endY = -1;

  el.className = 'view-create';
  el.innerHTML = `
    <header class="editor-bar">
      <div class="editor-group">
        <span class="group-label">Size</span>
        <label class="field">W <input type="number" id="width" min="1" max="40" inputmode="numeric" value="10"></label>
        <label class="field">H <input type="number" id="height" min="1" max="40" inputmode="numeric" value="10"></label>
        <button class="btn" id="reloadBtn" type="button">🧹 New blank</button>
      </div>
      <div class="editor-group">
        <span class="group-label">Tap places…</span>
        <div class="segmented" role="radiogroup" aria-label="Editing tool">
          <label><input type="radio" name="selectorRadio" value="walls" checked>🧱 Walls</label>
          <label><input type="radio" name="selectorRadio" value="start">🔴 Start</label>
          <label><input type="radio" name="selectorRadio" value="end">🟢 End</label>
        </div>
      </div>
      <div class="editor-group editor-group-nowrap">
        <label class="field">Start facing
          <select id="directionSelect" aria-label="Start direction">
            <option value="n" selected>⬆️ North</option>
            <option value="e">➡️ East</option>
            <option value="s">⬇️ South</option>
            <option value="w">⬅️ West</option>
          </select>
        </label>
        <label class="field">Load
          <select id="mazeSelect" aria-label="Load a maze">
            <option value="">Load…</option>
          </select>
        </label>
      </div>
      <div class="editor-group">
        <span class="group-label">Name</span>
        <label class="field"><input type="text" id="name" placeholder="Maze name" size="12"></label>
        <button class="btn btn-primary" id="saveBtn" type="button">💾 Save</button>
      </div>
    </header>
    <div class="canvas-wrap" id="canvasWrap">
      <canvas id="mazeCanvas" class="editor-canvas"></canvas>
    </div>
  `;

  const reloadBtn = document.getElementById('reloadBtn');
  const saveBtn = document.getElementById('saveBtn');

  reloadBtn.addEventListener('click', () => {
    draw_blank_maze();
  }, { signal });

  saveBtn.addEventListener('click', () => {
    save_maze();
  }, { signal });

  document.querySelectorAll('input[name="selectorRadio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if(radio.value == "start") {
        document.body.style.cursor = 'url("start.png"), auto';
        selector = "start";
      } else if(radio.value == "end") {
        document.body.style.cursor = 'url("end.png"), auto';
        selector = "end";
      } else {
        document.body.style.cursor = 'auto';
        selector = "walls";
      }
    }, { signal });
  });

  // Set up the canvas and paint a blank maze immediately, so the view
  // never sits blank while the maze list loads over the network.
  wrap = document.getElementById('canvasWrap');
  canvas = document.getElementById('mazeCanvas');
  ctx = canvas.getContext('2d');
  fitCanvas();
  draw_blank_maze();

  const mazeSelect = document.getElementById("mazeSelect");
  await populateMazeSelect();

  mazeSelect.addEventListener('change', async () => {
    if(mazeSelect.value != '') {
      if (sharedRef) {
        sharedRef.mazeName = mazeSelect.value;
      }
      try {
        const data = await getMazeData(mazeSelect.value);
        draw_loaded_maze(mazeSelect.value, data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction);
      } catch (err) {
        console.error('Failed to get maze data:', err);
        alert(`Couldn't load “${mazeSelect.value}”. The maze server hiccuped — try again in a moment.`);
      }
    } else {
      document.getElementById('width').value = 10;
      document.getElementById('height').value = 10;
      draw_blank_maze();
    }
  }, { signal });

  canvas.addEventListener("pointerdown", function(event) {
    if (!event.isPrimary) return;
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    let px = event.clientX - rect.left;
    let py = event.clientY - rect.top;

    // Convert pixel to grid coordinates relative to maze origin
    let gx = (px - offsetX) / cell_size;
    let gy = (win_height - py - offsetY) / cell_size;

    let color, wx, wy;

    let maze_width = h.length;
    let maze_height = v.length;

    if(selector == "walls") {
      // Determine if click is closer to horizontal or vertical wall
      let xDistToVert = Math.min(gx - Math.floor(gx), Math.ceil(gx) - gx);
      let yDistToHor  = Math.min(gy - Math.floor(gy), Math.ceil(gy) - gy);

      if (yDistToHor < xDistToVert) {
        // Click is closer to horizontal wall
        wx = Math.floor(gx);
        wy = Math.round(gy);  // nearest horizontal wall
        if(wx >= 0 && wy >= 0 && wx < maze_width && wy <= maze_height) {
          h[wx][wy] = h[wx][wy] ? 0 : 1;
          color = h[wx][wy] ? '#000000' : '#e2e8f0';
          createline(wx, wy, wx + 1, wy, color);
          setDirty(true);
        }
      } else {
        // Click is closer to vertical wall
        wx = Math.round(gx);  // nearest vertical wall
        wy = Math.floor(gy);
        if(wx >= 0 && wy >= 0 && wx <= maze_width && wy < maze_height) {
          v[wy][wx] = v[wy][wx] ? 0 : 1;
          color = v[wy][wx] ? '#000000' : '#e2e8f0';
          createline(wx, wy, wx, wy + 1, color);
          setDirty(true);
        }
      }
    } else {
      wx = Math.floor(gx);
      wy = Math.floor(gy);
      if(wx >= 0 && wy >= 0 && wx < maze_width && wy < maze_height) {
        if(selector == "start") {
          if(wx == endX && wy == endY) {
            endX = endY = -1;
          }
          startX = wx;
          startY = wy;
        } else {
          if(wx == startX && wy == startY) {
            startX = startY = -1;
          }
          endX = wx;
          endY = wy;
        }
        setDirty(true);
        render();
      }
    }

  }, { signal });

  window.addEventListener('resize', () => {
    fitCanvas();
    render();
  }, { signal });

  if (shared.mazeName) {
    mazeSelect.value = shared.mazeName;
    if (mazeSelect.value === shared.mazeName) {
      try {
        const data = await getMazeData(shared.mazeName);
        draw_loaded_maze(shared.mazeName, data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction);
      } catch (err) {
        console.error('Failed to get maze data:', err);
        draw_blank_maze();
      }
    } else {
      draw_blank_maze();
    }
  } else {
    draw_blank_maze();
  }

}

export function unmount() {
  if (ac) {
    ac.abort();
    ac = null;
  }
  document.body.style.cursor = 'auto';
  canvas = ctx = wrap = null;
  h = v = null;
  sharedRef = null;
}
