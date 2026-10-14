export default class Maze {

  static #dirToRad = {
    "e": 0,
    "n": Math.PI * (1/2),
    "w": Math.PI,
    "s": Math.PI * (3/2)
  };

  constructor(h, v, start_x, start_y, end_x, end_y, direction) {
    this.h = h;
    this.v = v;
    this.start_x = start_x;
    this.start_y = start_y;
    this.end_x = end_x;
    this.end_y = end_y;
    this.direction = direction;
    this.directionRad = Maze.#dirToRad[direction];
  }

}
