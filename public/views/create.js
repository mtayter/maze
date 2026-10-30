// Create view: maze editor.
// mount(el, shared) renders into el; unmount() aborts every listener
// registered during mount. Edits set shared.editorDirty so the shell's
// version check never force-reloads over unsaved work; saving clears it.

import Maze from '../Maze.js?v=4.8.0';
import { saveMazeData, deleteMaze, listMazes, getMazeData } from '../MazeDB.js?v=4.8.0';
import { openMazePicker } from '../MazePicker.js?v=4.8.0';

let canvas, ctx, wrap, win_width, win_height, cell_size, offsetX = 24, offsetY = 24;
let h = null, v = null, selector = "walls";
let startX = -1, startY = -1, endX = -1, endY = -1;
let ac = null;
let sharedRef = null;
let wrapObserver = null;
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

// Button visibility is state-driven: a button shows only when it
// can act. Inputs, by contrast, stay visible and grey out — they
// display state (the loaded maze's name and size). The save button
// is one button with two identities: ➕ Add for a fresh, non-blank
// name, 💾 Update when the name is your own loaded maze. Copy
// shows whenever a maze is loaded: it detaches the drawing into a
// new unsaved maze. While any maze is loaded the name box locks to
// its name; while someone ELSE's maze is loaded the whole editing
// surface locks (size, facing, tools, canvas) — that maze is
// view-only until copied. Any state refresh also closes the
// delete confirmation.
function refreshSaveState() {
  const saveBtn = document.getElementById('saveBtn');
  if (!saveBtn) return;
  hideDeleteConfirm();
  const status = nameStatus();
  const own = status === 'own';
  const loaded = lastLoaded !== '';
  const toolsLocked = loaded && !loadedMine;
  saveBtn.textContent = own ? '💾 Update' : '➕ Add';
  saveBtn.hidden = !(own || status === 'free');
  document.getElementById('deleteBtn').hidden = !own;
  document.getElementById('copyBtn').hidden = !loaded;
  document.getElementById('name').disabled = loaded;
  document.getElementById('width').disabled = toolsLocked;
  document.getElementById('height').disabled = toolsLocked;
  document.querySelector('#directionSelect').disabled = toolsLocked;
  const seg = document.querySelector('.segmented');
  if (seg) seg.closest('.editor-group').hidden = toolsLocked;
}

// Copy detaches the drawing from the maze it was loaded from: it
// becomes a new, unsaved maze — the name box unlocks and blanks,
// the mode returns to Add, and the editing surface unlocks. The
// original stays saved under its own name, untouched.
function copy_maze() {
  if (!lastLoaded) return;
  lastLoaded = '';
  savedName = '';
  loadedMine = true;
  loadedOwnerName = '';
  const nameInput = document.getElementById('name');
  nameInput.value = '';
  setDirty(true);
  clearNameError();
  refreshSaveState();
  nameInput.focus();
}

function showDeleteConfirm() {
  const confirm = document.getElementById('deleteConfirm');
  if (!confirm || !lastLoaded) return;
  document.getElementById('deleteConfirmText').textContent =
    `Delete “${lastLoaded}” for good?`;
  confirm.hidden = false;
}

function hideDeleteConfirm() {
  const confirm = document.getElementById('deleteConfirm');
  if (confirm) confirm.hidden = true;
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
  const taken = Object.prototype.hasOwnProperty.call(mazeOwners, new_maze);
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
  await populateMazeOwners();
  clearNameError();
  refreshSaveState();
}

async function delete_maze() {
  const name = lastLoaded;
  if (!name || !loadedMine) {
    return;
  }
  try {
    await deleteMaze(name);
  } catch (err) {
    if (err && err.status === 403) {
      alert(`“${name}” belongs to someone else.`);
    } else if (!err || err.status !== 401) {
      alert('Deleting failed — the maze server hiccuped. Try again in a moment.');
    }
    refreshSaveState();
    return;
  }
  // The drawing stays on screen as a new, unsaved maze under the
  // same (now free) name — Add brings it back if that was a mistake.
  lastLoaded = '';
  savedName = name;
  loadedMine = true;
  loadedOwnerName = '';
  setDirty(true);
  await populateMazeOwners();
  clearNameError();
  refreshSaveState();
  alert(`Deleted “${name}”.`);
}

// The W/H inputs are live controls: editing one resizes the
// drawing in place. Growing appends open blank space — to the
// right, and at the screen's bottom (which is data y=0 under the
// editor's flip, so existing rows shift up); the new outer border
// is walled and the old border opens as a seam so the new space is
// part of the maze. Shrinking cuts from the same edges, and if
// anything would be cut — wall segments, the start or end square —
// it asks first, naming what would go.
function applySize() {
  const widthEl = document.getElementById('width');
  const heightEl = document.getElementById('height');
  const curW = h.length;
  const curH = v.length;
  const newW = Math.min(40, Math.max(1, parseInt(widthEl.value) || curW));
  const newH = Math.min(40, Math.max(1, parseInt(heightEl.value) || curH));
  if (newW === curW && newH === curH) {
    widthEl.value = curW;
    heightEl.value = curH;
    return;
  }

  // What would a shrink cut off? (Boundary lines are structural;
  // only interior segments and the start/end squares count.)
  const lost = [];
  let wallCount = 0;
  if (newW < curW) {
    for (let cx = newW; cx < curW; cx++) {
      for (let cy = 1; cy < curH; cy++) if (h[cx][cy]) wallCount++;
    }
    for (let cy = 0; cy < curH; cy++) {
      for (let cx = newW + 1; cx < curW; cx++) if (v[cy][cx]) wallCount++;
    }
    if (startX >= newW) lost.push('the start square');
    if (endX >= newW) lost.push('the end square');
  }
  if (newH < curH) {
    const drop = curH - newH;
    for (let cy = 0; cy < drop; cy++) {
      for (let cx = 1; cx < curW; cx++) if (v[cy][cx]) wallCount++;
    }
    for (let cx = 0; cx < curW; cx++) {
      for (let cy = 1; cy < drop; cy++) if (h[cx][cy]) wallCount++;
    }
    if (startY >= 0 && startY < drop) lost.push('the start square');
    if (endY >= 0 && endY < drop) lost.push('the end square');
  }
  if (wallCount > 0) {
    lost.unshift(`${wallCount} wall segment${wallCount === 1 ? '' : 's'}`);
  }
  if (lost.length > 0 &&
      !confirm(`Shrinking will cut off ${lost.join(', ')}. Shrink anyway?`)) {
    widthEl.value = curW;
    heightEl.value = curH;
    return;
  }

  if (newW > curW) {
    for (let cx = curW; cx < newW; cx++) {
      const col = new Array(curH + 1).fill(0);
      col[0] = 1;
      col[curH] = 1;
      h.push(col);
    }
    for (let cy = 0; cy < curH; cy++) {
      v[cy][curW] = 0; // open the seam where the old right border was
      for (let cx = curW + 1; cx <= newW; cx++) {
        v[cy][cx] = cx === newW ? 1 : 0;
      }
    }
  }
  if (newH > curH) {
    const add = newH - curH;
    for (let i = 0; i < add; i++) {
      const row = new Array(h.length + 1).fill(0);
      row[0] = 1;
      row[h.length] = 1;
      v.unshift(row);
    }
    for (let cx = 0; cx < h.length; cx++) {
      h[cx].unshift(...new Array(add).fill(0));
      h[cx][0] = 1;   // new bottom border
      h[cx][add] = 0; // the shifted old bottom border, opened as a seam
    }
    if (startY >= 0) startY += add;
    if (endY >= 0) endY += add;
  }
  if (newW < h.length) {
    h.length = newW;
    for (let cy = 0; cy < v.length; cy++) {
      v[cy].length = newW + 1;
      v[cy][newW] = 1; // the new right edge is a proper border
    }
    if (startX >= newW) startX = startY = -1;
    if (endX >= newW) endX = endY = -1;
  }
  if (newH < v.length) {
    const drop = v.length - newH;
    v.splice(0, drop);
    for (let cx = 0; cx < h.length; cx++) {
      h[cx].splice(0, drop);
      h[cx][0] = 1; // the new bottom edge is a proper border
    }
    if (startY >= 0) {
      if (startY < drop) startX = startY = -1;
      else startY -= drop;
    }
    if (endY >= 0) {
      if (endY < drop) endX = endY = -1;
      else endY -= drop;
    }
  }

  widthEl.value = h.length;
  heightEl.value = v.length;
  setDirty(true);
  render();
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

// The start square carries a white arrow in the facing direction
// (the Start facing dropdown), so the spawn heading reads at a
// glance. Screen space works out cleanly: the editor flips data-y
// when drawing, and Maze's direction table makes north data +y —
// so north is up here, east right, and so on.
function drawStartArrow() {
  const sel = document.querySelector('#directionSelect');
  const dir = (sel && sel.value) || savedDirection;
  const rot = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 }[dir] || 0;
  const cx = x(startX) + cell_size / 2;
  const cy = y(startY + 1) + cell_size / 2;
  const a = cell_size * 0.27;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -a);
  ctx.lineTo(a * 0.78, -a * 0.12);
  ctx.lineTo(a * 0.34, -a * 0.12);
  ctx.lineTo(a * 0.34, a * 0.85);
  ctx.lineTo(-a * 0.34, a * 0.85);
  ctx.lineTo(-a * 0.34, -a * 0.12);
  ctx.lineTo(-a * 0.78, -a * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
  if (startX > -1) {
    createbox(startX, startY, '#f00000');
    drawStartArrow();
  }
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
  clearNameError();
  refreshSaveState();
}

// The name rules need to know every maze's owner; the picker
// dialog fetches the same (cached) list itself when opened.
async function populateMazeOwners() {
  let mazes = await listMazes();
  mazeOwners = {};
  mazes.forEach(maze => {
    mazeOwners[maze.name] = { owner_name: maze.owner_name, mine: maze.mine };
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
      <div class="stack-field">
        <span class="action-row">
          <button class="btn" id="reloadBtn" type="button">🧹 New</button>
          <button class="btn" id="loadBtn" type="button">📂 Load</button>
        </span>
      </div>
      <div class="editor-group">
        <span class="group-label">Size</span>
        <label class="field">W <input type="number" id="width" min="1" max="40" inputmode="numeric" value="10"></label>
        <label class="field">H <input type="number" id="height" min="1" max="40" inputmode="numeric" value="10"></label>
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
      </div>
      <div class="editor-group">
        <span class="group-label">Name</span>
        <label class="field"><input type="text" id="name" placeholder="Maze name" size="12"></label>
        <span class="action-row">
          <button class="btn btn-primary" id="saveBtn" type="button">➕ Add</button>
          <button class="btn btn-danger" id="deleteBtn" type="button" hidden>🗑️ Delete</button>
        </span>
        <button class="btn" id="copyBtn" type="button" hidden>📋 Copy</button>
        <span class="delete-confirm" id="deleteConfirm" hidden>
          <span id="deleteConfirmText"></span>
          <button class="btn btn-danger" id="deleteYesBtn" type="button">Yes, delete</button>
          <button class="btn" id="deleteNoBtn" type="button">Cancel</button>
        </span>
        <span class="name-error" id="nameError" role="alert"></span>
      </div>
    </header>
    <div class="canvas-wrap" id="canvasWrap">
      <canvas id="mazeCanvas" class="editor-canvas"></canvas>
    </div>
  `;

  const reloadBtn = document.getElementById('reloadBtn');

  reloadBtn.addEventListener('click', () => {
    draw_blank_maze();
  }, { signal });

  document.getElementById('saveBtn').addEventListener('click', () => {
    save_maze();
  }, { signal });
  document.getElementById('copyBtn').addEventListener('click', () => {
    copy_maze();
  }, { signal });
  document.getElementById('width').addEventListener('change', applySize, { signal });
  document.getElementById('height').addEventListener('change', applySize, { signal });
  document.getElementById('deleteBtn').addEventListener('click', () => {
    showDeleteConfirm();
  }, { signal });
  document.getElementById('deleteYesBtn').addEventListener('click', () => {
    delete_maze();
  }, { signal });
  document.getElementById('deleteNoBtn').addEventListener('click', () => {
    refreshSaveState();
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

  await populateMazeOwners();
  refreshSaveState();

  document.querySelector('#directionSelect').addEventListener('change', (e) => {
    savedDirection = e.target.value;
    render();
  }, { signal });

  document.getElementById('loadBtn').addEventListener('click', () => {
    openMazePicker({
      container: el,
      title: 'Load a maze',
      current: lastLoaded,
      signal,
      onPick: async (name) => {
        try {
          const data = await getMazeData(name);
          draw_loaded_maze(name, data.h, data.v, data.start_x, data.start_y, data.end_x, data.end_y, data.direction, data.owner_name, data.mine);
        } catch (err) {
          console.error('Failed to get maze data:', err);
          alert(`Couldn't load “${name}”. The maze server hiccuped — try again in a moment.`);
        }
      },
    });
  }, { signal });

  canvas.addEventListener("pointerdown", function(event) {
    if (!event.isPrimary) return;
    // Someone else's maze is view-only until copied.
    if (lastLoaded && !loadedMine) return;
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

  // The toolbar can wrap (or the Load select widen once its options
  // arrive) after the first paint without any window resize, which
  // shrinks the wrap — the canvas bitmap must track the wrap's real
  // size or the maze is drawn too tall and runs off the screen.
  if (window.ResizeObserver) {
    wrapObserver = new ResizeObserver(() => {
      fitCanvas();
      render();
    });
    wrapObserver.observe(wrap);
  }

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
  if (wrapObserver) {
    wrapObserver.disconnect();
    wrapObserver = null;
  }
  document.body.style.cursor = 'auto';
  canvas = ctx = wrap = null;
  sharedRef = null;
}
