export default class Player {
  constructor(x, z, yaw) {
    this.x = x;
    this.y = 0.5;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
  }
  turn(d) {
    if(d == "right") {
      this.yaw -= Math.PI * (1/8);
    } else if(d == "left") {
      this.yaw += Math.PI * (1/8);
    }
  }
  look(d) {
    if(d == "down") {
      if(this.pitch > -Math.PI * (1/2)) {
        this.pitch -= Math.PI * (1/16);
      }
    } else if(d == "up") {
      if(this.pitch < Math.PI * (1/2)) {
        this.pitch += Math.PI * (1/16);
      }
    }
  }
  move(d) {
    if(d == "forward") {
      this.x += Math.round(Math.cos(this.yaw));
      this.z += Math.round(Math.sin(this.yaw));
    } else if(d == "backward") {
      this.x -= Math.round(Math.cos(this.yaw));
      this.z -= Math.round(Math.sin(this.yaw));
    } else if(d == "left") {
      this.x += Math.round(Math.cos(this.yaw + (Math.PI * (1/2))));
      this.z += Math.round(Math.sin(this.yaw + (Math.PI * (1/2))));
    } else if(d == "right") {
      this.x += Math.round(Math.cos(this.yaw - (Math.PI * (1/2))));
      this.z += Math.round(Math.sin(this.yaw - (Math.PI * (1/2))));
    }
  }
  whats(d) {
    if(d == "forward") {
      return [
        this.x + Math.round(Math.cos(this.yaw)),
        this.z + Math.round(Math.sin(this.yaw))
      ];
    } else if(d == "backward") {
      return [
        this.x - Math.round(Math.cos(this.yaw)),
        this.z - Math.round(Math.sin(this.yaw))
      ];
    } else if(d == "left") {
      return [
        this.x + Math.round(Math.cos(this.yaw + (Math.PI * (1/2)))),
        this.z + Math.round(Math.sin(this.yaw + (Math.PI * (1/2))))
      ];
    } else if(d == "right") {
      return [
        this.x + Math.round(Math.cos(this.yaw - (Math.PI * (1/2)))),
        this.z + Math.round(Math.sin(this.yaw - (Math.PI * (1/2))))
      ];
    }
  }
  grow() {
    this.y++;
  }
  shrink() {
    if(this.y > 1) {
      this.y--;
    }
  }
}
