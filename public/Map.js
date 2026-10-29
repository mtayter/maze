import Maze from './Maze.js?v=3.0.2';

export default class Map {
  constructor(maze,canvas,start_color,end_color) {
    this.canvas = canvas;
    this.maze = maze;
    this.start_color = start_color;
    this.end_color = end_color;

    this.resize();
    this.ctx = this.canvas.getContext('2d');
    this.draw();
    this.hide();
  }

  resize() {
    // The canvas fills its view (below the shell bar in the SPA);
    // fall back to window size while it is display:none (client size 0).
    this.canvas.width = this.canvas.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
  }
  draw() {
    if (!this.ctx || !this.maze) {
      return;
    }
    // Keep a margin that suits the screen: snug on phones, airy on desktop,
    // and centre the maze in the overlay instead of pinning it to a corner.
    const pad = Math.max(16, Math.min(50, Math.floor(Math.min(this.canvas.width, this.canvas.height) * 0.06)));
    this.cell_size = Math.trunc(Math.min((this.canvas.width - pad * 2) / this.maze.h.length, (this.canvas.height - pad * 2) / this.maze.v.length));
    this.originX = Math.trunc((this.canvas.width - this.cell_size * this.maze.h.length) / 2);
    this.originY = Math.trunc((this.canvas.height - this.cell_size * this.maze.v.length) / 2);

    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.strokeStyle = '#0f172a';
    this.ctx.lineWidth = 2;

    this.#create4gon(this.maze.start_x+0.2,this.maze.start_y+0.2,this.maze.start_x+0.8,this.maze.start_y+0.2,this.maze.start_x+0.8,this.maze.start_y+0.8,this.maze.start_x+0.2,this.maze.start_y+0.8,this.start_color);
    this.#create4gon(this.maze.end_x+0.2,this.maze.end_y+0.2,this.maze.end_x+0.8,this.maze.end_y+0.2,this.maze.end_x+0.8,this.maze.end_y+0.8,this.maze.end_x+0.2,this.maze.end_y+0.8,this.end_color);

    for(let i=0; i<this.maze.h.length; i++) {
      for(let j=0; j<this.maze.h[i].length; j++) {
        if(this.maze.h[i][j]) {
          this.#createline(i,j,i+1,j);
        }
      }
    }
    for(let i=0; i<this.maze.v.length; i++) {
      for(let j=0; j<this.maze.v[i].length; j++) {
        if(this.maze.v[i][j]) {
          this.#createline(j,i,j,i+1);
        }
      }
    }
  }

  #x(x) {
    return x * this.cell_size + (this.originX ?? 50);
  }
  #y(y) {
    return this.canvas.height - y * this.cell_size - (this.originY ?? 50);
  }
  #createline(x0, y0, x1, y1) {
    this.ctx.beginPath();
    this.ctx.moveTo(this.#x(x0),this.#y(y0));
    this.ctx.lineTo(this.#x(x1),this.#y(y1));
    this.ctx.stroke();
  }
  #create4gon(x0, y0, x1, y1, x2, y2, x3, y3, color) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(this.#x(x0),this.#y(y0));
    this.ctx.lineTo(this.#x(x1),this.#y(y1));
    this.ctx.lineTo(this.#x(x2),this.#y(y2));
    this.ctx.lineTo(this.#x(x3),this.#y(y3));
    this.ctx.closePath();
    this.ctx.fill();
  }

  show() {
    this.canvas.style.display = 'block';
  }
  hide() {
    this.canvas.style.display = 'none';
  }
}
