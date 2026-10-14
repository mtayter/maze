export function Rect2d(v1,v2,color) {
  // create axis aligned rectangle

  let a1, a2, a3, verts = [];

  for(let i=0; i<3; i++) {
    if(v1[i] == v2[i]) {
      a1 = (i + 1) % 3;
      a2 = (i + 2) % 3;
      a3 = i;
    }
  }

  let v = new Array(3);
  v[a1] = v1[a1];
  v[a2] = v1[a2];
  v[a3] = v1[a3];
  verts.push(v);

  v = new Array(3);
  v[a1] = v1[a1];
  v[a2] = v2[a2];
  v[a3] = v1[a3];
  verts.push(v);

  v = new Array(3);
  v[a1] = v2[a1];
  v[a2] = v2[a2];
  v[a3] = v1[a3];
  verts.push(v);

  v = new Array(3);
  v[a1] = v2[a1];
  v[a2] = v1[a2];
  v[a3] = v1[a3];
  verts.push(v);

  return new PlanePoly(verts,color);
}

export function Rect3d(v1,v2,color) {
  // create axis aligned rectangular prism
  let p = [];
  p.push(Rect2d([v1[0],v1[1],v1[2]],[v2[0],v2[1],v1[2]],color));
  p.push(Rect2d([v1[0],v1[1],v2[2]],[v2[0],v2[1],v2[2]],color));
  p.push(Rect2d([v1[0],v1[1],v1[2]],[v2[0],v1[1],v2[2]],color));
  p.push(Rect2d([v1[0],v2[1],v1[2]],[v2[0],v2[1],v2[2]],color));
  p.push(Rect2d([v1[0],v1[1],v1[2]],[v1[0],v2[1],v2[2]],color));
  p.push(Rect2d([v2[0],v1[1],v1[2]],[v2[0],v2[1],v2[2]],color));
  return p;
}

export class PlanePoly {
  constructor(verts,color) {
    this.verts = verts;
    this.color = color;
  }
}

export class Triangle {
  constructor(v1,v2,v3,edge_color1,edge_color2,edge_color3,fill_color) {
    this.verts = [v1,v2,v3];
    this.edge_colors = [edge_color1,edge_color2,edge_color3];
    this.fill_color = fill_color;
  }
}

export function trianglize(vertices,edge_color,fill_color) {
  let t = [];
  if(vertices.length == 3) {
    t.push(new Triangle(...vertices,edge_color,edge_color,edge_color,fill_color));
  } else {
    t.push(new Triangle(...vertices.slice(0,3),edge_color,edge_color,fill_color,fill_color));
    for(let i = 2; i < vertices.length-2; i++) {
      t.push(new Triangle(vertices[0],...vertices.slice(i,i+2),fill_color,edge_color,fill_color,fill_color));
    }
    t.push(new Triangle(vertices[0],...vertices.slice(-2),fill_color,edge_color,edge_color,fill_color));
  }
  return t;
}
