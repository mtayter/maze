// Create view: maze editor.
// mount(el, shared) renders into el; unmount() aborts every listener
// registered during mount. Edits set shared.editorDirty so the shell's
// version check never force-reloads over unsaved work; saving clears it.

import Maze from '../Maze.js?v=4.2.0';
import { saveMazeData, listMazes, getMazeData } from '../MazeDB.js?v=4.2.0';

let canvas, ctx, wrap, win_width, win_height, cell_size, offsetX = 24, offsetY = 24;
let h = null, v = null, selector = "walls";
let startX = -1, startY = -1, endX = -1, endY = -1;
let ac = null;
let sharedRef = null;
// This view's own memory, independent of the play view: the drawing
// state (h/v/start/end live in module scope and survive unmount), which
// maze it came from, and the toolbar's name/direction as last left.
// hasState is false only until the first blank or loaded maze exists.
let hasState = false;
let lastLoaded = '';
let savedName = '';
let savedDirection = 'n';
// Ownership of the loaded maze (SSO): you may edit anything, but only
// save over your own mazes; others' mazes save as copies (new name).
let loadedMine = true;
let loadedOwnerName = '';
// name -> { owner_name, mine } for every maze, rebuilt on list loads.
let mazeOwners = {};
// Name field value when it gained focus (blur-error guard).
let nameAtFocus = null;

function updateOwnerNote() {
  const note = document.getElementById('ownerNote');
  if (!note) return;
  if (!lastLoaded || loadedMine) {
    note.textContent = '';
  } else {
    note.textContent = `👤 By ${loadedOwnerName || 'another player'} — rename to save your copy`;
  }
}

// Save availability, driven by the name field: blank names keep Save
// enabled (clicking explains a name is needed); the loaded maze's own
// name is saveable only when the maze is yours; any other existing
// name is not saveable; a fresh name is.
function nameStatus() {
  const input = document.getElementById('name');
  if (!input) return 'blank';
  const name = input.value.trim();
  if (name === '') return 'blank';
  if (name === lastLoaded) return loadedMine ? 'own' : 'theirs';
  if (Object.prototype.hasOwnProperty.call(mazeOwners, name)) return 'taken';
  return 'free';
}

function refreshSaveState() {
  const saveBtn = document.getElementById('saveBtn');
  if (!saveBtn) return;
  const status = nameStatus();
  saveBtn.disabled = status === 'theirs' || status === 'taken';
}

function showNameError(message) {
  const error = document.getElementById('nameError');
  const input = document.getElementById('name');
  if (error) error.textContent = message;
  if (input) input.classList.add('invalid');
}

function clearNameError() {
  const error = document.getElementById('nameError');
  const input = document.getElementById('name');
  if (error) error.textContent = '';
  if (input) input.classList.remove('invalid');
}

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
  // Saving over the maze you loaded is fine when it's yours.
  if (taken && !(new_maze === lastLoaded && loadedMine)) {
    alert(loadedMine || new_maze !== lastLoaded
      ? 'That name is already taken.'
      : `“${new_maze}” belongs to ${loadedOwnerName || 'another player'} — pick a new name to save your copy.`);
    return;
  }
  try {
    await saveMazeData(new_maze,h,v,startX,startY,endX,endY,document.getElementById("directionSelect").value);
  } catch (err) {
    if (err && err.status === 403) {
      alert(`“${new_maze}” belongs to someone else — pick a new name to save your copy.`);
    } else if (!err || err.status !== 401) {
      alert('Saving failed — the maze server hiccuped. Try again in a moment.');
    }
    return;
  }
  setDirty(false);
  lastLoaded = new_maze;
  savedName = new_maze;
  loadedMine = true;
  loadedOwnerName = '';
  await populateMazeSelect();
  document.querySelector('#mazeSelect').value = new_maze;
  updateOwnerNote();
  clearNameError();
  refreshSaveState();
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
  hasState = true;
  lastLoaded = '';
  savedName = '';
  savedDirection = 'n';
  loadedMine = true;
  loadedOwnerName = '';
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
  updateOwnerNote();
  clearNameError();
  refreshSaveState();
}

function draw_loaded_maze(name, new_h, new_v, start_x, start_y, end_x, end_y, direction, ownerName, mine) {

  hasState = true;
  lastLoaded = name;
  savedName = name;
  savedDirection = direction;
  loadedMine = mine !== false;
  loadedOwnerName = ownerName || '';
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
  updateOwnerNote();
  clearNameError();
  refreshSaveState();
}

async function populateMazeSelect() {
  const mazeSelect = document.getElementById('mazeSelect');
  let mazes = await listMazes();
  mazeOwners = {};
  mazes.forEach(maze => {
    mazeOwners[maze.name] = { owner_name: maze.owner_name, mine: maze.mine };
  });
  mazeSelect.length = 1;
  mazes.forEach(maze => {
    mazeSelect.add(new Option(maze.name, maze.name));
  });
  refreshSaveState();
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
  // Drawing state (h/v/start/end, lastLoaded, savedName/Direction) is
  // deliberately NOT reset: it is this view's memory across switches.
  selector = "walls"; // matches the freshly rendered toolbar

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
        <div class="stack-field">
          <span class="group-label">Start facing</span>
          <select id="directionSelect" aria-label="Start direction">
            <option value="n" selected>⬆️ North</option>
            <option value="e">➡️ East</option>
            <option value="s">⬇️ South</option>
            <option value="w">⬅️ West</option>
          </select>
        </div>
        <div class="stack-field">
          <span class="group-label">Load</span>
          <select id="mazeSelect" aria-label="Load a maze">
            <option value="">Load…</option>
          </select>
          <span class="owner-note" id="ownerNote"></span>
        </div>
      </div>
      <div class="editor-group">
        <span class="group-label">Name</span>
        <label class="field"><input type="text" id="name" placeholder="Maze name" size="12"></label>
        <button class="btn btn-primary" id="saveBtn" type="button">💾 Save</button>
        <span class="name-error" id="nameError" role="alert"></span>
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

  // Save availability follows the name field: recheck on every edit,
  // and a name typed over an existing maze errors on blur and pulls
  // focus back until a different name is entered.
  const nameInput = document.getElementById('name');
  nameInput.addEventListener('focus', () => {
    nameAtFocus = nameInput.value;
  }, { signal });
  nameInput.addEventListener('input', () => {
    clearNameError();
    refreshSaveState();
  }, { signal });
  nameInput.addEventListener('blur', () => {
    if (nameStatus() === 'taken' && nameInput.value !== nameAtFocus) {
      showNameError(`“${nameInput.value.trim()}” already exists — enter a different name.`);
      refreshSaveState();
      nameInput.focus();
      nameInput.select();
    }
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

  // Set up the canvas and paint immediately — the restored drawing if
  // this view has state, otherwise a blank maze — so the view never
  // sits blank while the maze list loads over the network.
  wrap = document.getElementById('canvasWrap');
  canvas = document.getElementById('mazeCanvas');
  ctx = canvas.getContext('2d');
  fitCanvas();
  if (hasState) {
    document.getElementById('width').value = h.length;
    document.getElementById('height').value = v.length;
    document.getElementById('name').value = savedName;
    document.querySelector('#directionSelect').value = savedDirection;
    render();
  } else {
    draw_blank_maze();
  }

  const mazeSelect = document.getElementById("mazeSelect");
  await populateMazeSelect();
  if (hasState && lastLoaded) {
    mazeSelect.value = lastLoaded;
  }
  updateOwnerNote();
  refreshSaveState();

  mazeSelect.addEventListener('change', async () => {
    if(mazeSelect.value != '') {
      try {
        const data = await getMazeData(mazeSelect.value);
        draw_loaded_maze(mazeSelect.value, data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction, data.owner_name, data.mine);
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

}

export function unmount() {
  // Remember the toolbar exactly as left (even an unsaved typed name),
  // and keep the drawing state in module scope for the next mount.
  const nameEl = document.getElementById('name');
  if (nameEl) {
    savedName = nameEl.value;
  }
  const dirEl = document.querySelector('#directionSelect');
  if (dirEl) {
    savedDirection = dirEl.value;
  }
  if (ac) {
    ac.abort();
    ac = null;
  }
  document.body.style.cursor = 'auto';
  canvas = ctx = wrap = null;
  sharedRef = null;
}
