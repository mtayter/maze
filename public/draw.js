import Maze from './Maze.js';
import { saveMazeData, listMazes, getMazeData } from './MazeDB.js';

let canvas, ctx, win_width, win_height, n, cell_size, h, v, selector = "walls";
let startX = -1, startY = -1, endX = -1, endY = -1;

async function save_maze() {
  let new_maze = document.getElementById("name").value;
  document.querySelector('#mazeSelect').querySelectorAll('option').forEach(maze => {
    if(new_maze == maze.value) {
      alert('That name is already taken.');
      return false;
    }
  });
  const data = await saveMazeData(new_maze,h,v,startX,startY,endX,endY,document.getElementById("directionSelect").value);
  await populateMazeSelect();
  document.querySelector('#mazeSelect').value = new_maze;
}

function x(x) {
  return x * cell_size + 50;
}
function y(y) {
  return win_height - y * cell_size - 50;
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
function draw_blank_maze() {
  startX = startY = endX = endY = -1;
  let maze_width = parseInt(document.getElementById('width').value);
  let maze_height = parseInt(document.getElementById('height').value);

  document.getElementById("name").value = "";
  document.querySelector('input[name="selectorRadio"][value="walls"]').click();
  document.getElementById("directionSelect").selectedIndex = 0;
  document.getElementById("mazeSelect").selectedIndex = 0;

  cell_size = Math.trunc(Math.min((win_width - 100) / maze_width, (win_height - 100) / maze_height));

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Horizontal walls
  h = [];
  for (let x = 0; x < maze_width; x++) {
    h[x] = [];
    for (let y = 0; y <= maze_height; y++) {
      let isBorder = (y === 0 || y === maze_height);
      h[x][y] = isBorder ? 1 : 0;
      createline(x, y, x + 1, y, isBorder ? '#000000' : '#f0f0f0');
    }
  }

  // Vertical walls
  v = [];
  for (let y = 0; y < maze_height; y++) {
    v[y] = [];
    for (let x = 0; x <= maze_width; x++) {
      let isBorder = (x === 0 || x === maze_width);
      v[y][x] = isBorder ? 1 : 0;
      createline(x, y, x, y + 1, isBorder ? '#000000' : '#f0f0f0');
    }
  }
}

function draw_loaded_maze(name, new_h, new_v, start_x, start_y, end_x, end_y, direction) {

  h = new_h;
  v = new_v;

  let maze_width = document.getElementById('width').value = h.length;
  let maze_height = document.getElementById('height').value = v.length;

  document.getElementById("name").value = name;
  document.querySelector('input[name="selectorRadio"][value="walls"]').click();

  document.querySelector('#directionSelect').value = direction;

  cell_size = Math.trunc(Math.min((win_width - 100) / maze_width, (win_height - 100) / maze_height));

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Horizontal walls
  for (let x = 0; x < maze_width; x++) {
    for (let y = 0; y <= maze_height; y++) {
      createline(x, y, x + 1, y, h[x][y] ? '#000000' : '#f0f0f0');
    }
  }

  // Vertical walls
  for (let y = 0; y < maze_height; y++) {
    for (let x = 0; x <= maze_width; x++) {
      createline(x, y, x, y + 1, v[y][x] ? '#000000' : '#f0f0f0');
    }
  }

  createbox(start_x, start_y, '#f00000');
  startX = start_x;
  startY = start_y;

  createbox(end_x, end_y, '#00f000');
  endX = end_x;
  endY = end_y;
}

async function populateMazeSelect() {
  let mazes = await listMazes();
  mazeSelect.length = 1;
  mazes.forEach(maze => {
    mazeSelect.add(new Option(maze.name, maze.name));
  });
}

async function init() {

  let app = document.getElementById('app');
  app.innerHTML = `
    Width: <input type="text" id="width" size="3" value="10">
    Height: <input type="text" id="height" size="3" value="10">
    <button id="reloadBtn">Reload</button>
    &nbsp; &nbsp; &nbsp;
    <input type="radio" name="selectorRadio" value="walls" checked> Walls
    <input type="radio" name="selectorRadio" value="start"> Start
    <input type="radio" name="selectorRadio" value="end"> End
    &nbsp; &nbsp; &nbsp;
    Start direction: 
    <select id="directionSelect">
      <option value="n" selected>North</option>
      <option value="e">East</option>
      <option value="s">South</option>
      <option value="w">West</option>
    </select>
    &nbsp; &nbsp; &nbsp;
    Name: <input type="text" id="name" size="10">
    &nbsp; &nbsp; &nbsp;
    <select id="mazeSelect">
      <option value=""></option>
    </select>
    &nbsp; &nbsp; &nbsp;
    <button id="saveBtn">Save</button>
    <canvas id="mazeCanvas"></canvas>
  `;

  const reloadBtn = document.getElementById('reloadBtn');
  const saveBtn = document.getElementById('saveBtn');

  reloadBtn.addEventListener('click', () => {
    draw_blank_maze();
  });

  saveBtn.addEventListener('click', () => {
    save_maze();
  });

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
    });
  });

  const mazeSelect = document.getElementById("mazeSelect");
  await populateMazeSelect();

  mazeSelect.addEventListener('change', async () => {
    if(mazeSelect.value != '') {
      let h, v, start_x, start_y, end_x, end_y, direction;
      try {
        const data = await getMazeData(mazeSelect.value);
        ({ h, v, start_x, start_y, end_x, end_y, direction } = data);
        draw_loaded_maze(mazeSelect.value, h, v, start_x, start_y, end_x, end_y, direction);
      } catch (err) {
        console.error('Failed to get maze data:', err);
      }
    } else {
      document.getElementById('width').value = 10;
      document.getElementById('height').value = 10;
      draw_blank_maze();
    }
  });

  canvas = document.getElementById('mazeCanvas');
  ctx = canvas.getContext('2d');
  win_width = window.innerWidth;
  win_height = window.innerHeight;
  canvas.width = win_width;
  canvas.height = win_height;

  canvas.addEventListener("click", function(event) {

    const rect = canvas.getBoundingClientRect();
    let px = event.clientX - rect.left;
    let py = event.clientY - rect.top;

    // Convert pixel to grid coordinates relative to maze origin
    let gx = (px - 50) / cell_size;
    let gy = (win_height - py - 50) / cell_size;

    let color, wx, wy;

    let maze_width = parseInt(document.getElementById('width').value);
    let maze_height = parseInt(document.getElementById('height').value);

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
          color = h[wx][wy] ? '#000000' : '#f0f0f0';
          createline(wx, wy, wx + 1, wy, color);
        }
      } else {
        // Click is closer to vertical wall
        wx = Math.round(gx);  // nearest vertical wall
        wy = Math.floor(gy);
        if(wx >= 0 && wy >= 0 && wx <= maze_width && wy < maze_height) {
          v[wy][wx] = v[wy][wx] ? 0 : 1;
          color = v[wy][wx] ? '#000000' : '#f0f0f0';
          createline(wx, wy, wx, wy + 1, color);
        }
      }
    } else {
      wx = Math.floor(gx);
      wy = Math.floor(gy);
      if(wx >= 0 && wy >= 0 && wx < maze_width && wy < maze_height) {
        if(selector == "start") {
          if(startX > -1) {
            createbox(startX, startY, '#ffffff');
          }
          if(wx == endX && wy == endY) {
            endX = endY = -1;
          }
          createbox(wx, wy, '#f00000');
          startX = wx;
          startY = wy;
        } else {
          if(endX > -1) {
            createbox(endX, endY, '#ffffff');
          }
          if(wx == startX && wy == startY) {
            startX = startY = -1;
          }
          createbox(wx, wy, '#00f000');
          endX = wx;
          endY = wy;
        }
      }
    }

  });

  draw_blank_maze();

}

init();
