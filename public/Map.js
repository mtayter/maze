import Maze from './Maze.js';

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
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  draw() {
    this.cell_size = Math.trunc(Math.min((this.canvas.width-100) / this.maze.h.length, (this.canvas.height-100) / this.maze.v.length));

    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
    return x * this.cell_size + 50;
  }
  #y(y) {
    return this.canvas.height - y * this.cell_size - 50;
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
