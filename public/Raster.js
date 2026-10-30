// Raster.js — tiny software z-buffer triangle rasterizer.
//
// Pure functions over typed arrays (no DOM), so the play view can
// render into an ImageData buffer and tests/benchmarks can run in
// Node. Depths are stored as inverse z (1/z): larger means closer,
// and inverse z interpolates linearly in screen space, which is the
// perspective-correct quantity for depth comparisons.
//
// Pixel colors are packed uint32s in ImageData byte order
// (little-endian ABGR): 0xFF000000 | b<<16 | g<<8 | r.

// Half-width, in pixels, of the outline painted along true polygon
// edges. Adjacent faces paint their own sides of a shared edge, so
// seams come out roughly twice this wide — matching the old 2px
// canvas strokes this renderer replaces.
const EDGE_HALF_WIDTH = 1.1;

export function packColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
}

export const BLACK = 0xFF000000;
export const WHITE = 0xFFFFFFFF;

export function clearFrame(pixels, zbuf) {
  pixels.fill(BLACK);
  zbuf.fill(0);
}

// Rasterize one triangle.
//   a, b, c: [screenX, screenY, invZ] vertices (floats)
//   fill32, edge32: packed colors for the face and its outline
//   edgeMask: [ea, eb, ec] — whether the edge OPPOSITE that vertex is
//     a true polygon edge (fan-triangulation diagonals pass false, so
//     they don't get a fake outline across the quad).
export function drawTriangle(pixels, zbuf, width, height, a, b, c, fill32, edge32, edgeMask) {
  const [ax, ay, aw] = a;
  const [bx, by, bw] = b;
  const [cx, cy, cw] = c;

  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) {
    return; // degenerate (zero-area) triangle
  }

  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minY > maxY) {
    return;
  }

  // Altitude from each vertex to its opposite edge: dist from a pixel
  // to that edge = barycentric weight of the vertex * altitude.
  const area2 = Math.abs(denom);
  const altA = area2 / Math.hypot(bx - cx, by - cy);
  const altB = area2 / Math.hypot(ax - cx, ay - cy);
  const altC = area2 / Math.hypot(ax - bx, ay - by);

  // Barycentric weights and inverse-z are affine in screen space:
  // evaluate once per row start, then step by gradients per pixel.
  const dlaDx = (by - cy) / denom;
  const dlbDx = (cy - ay) / denom;
  const dwDx = dlaDx * (aw - cw) + dlbDx * (bw - cw);

  // Vertices sorted by y for the scanline walk (long edge v0->v2,
  // short edges v0->v1 then v1->v2).
  const vs = [[ax, ay], [bx, by], [cx, cy]].sort((p, q) => p[1] - q[1]);
  const [x0, y0] = vs[0];
  const [x1, y1] = vs[1];
  const [x2, y2] = vs[2];

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    if (py < y0 || py > y2 || y2 === y0) {
      continue;
    }
    const xLong = x0 + (x2 - x0) * ((py - y0) / (y2 - y0));
    let xShort;
    if (py <= y1 && y1 !== y0) {
      xShort = x0 + (x1 - x0) * ((py - y0) / (y1 - y0));
    } else if (y2 !== y1) {
      xShort = x1 + (x2 - x1) * ((py - y1) / (y2 - y1));
    } else {
      xShort = x1;
    }
    let xStart = Math.ceil(Math.min(xLong, xShort) - 0.5);
    let xEnd = Math.floor(Math.max(xLong, xShort) - 0.5);
    if (xEnd < 0 || xStart > width - 1) {
      continue;
    }
    xStart = Math.max(0, xStart);
    xEnd = Math.min(width - 1, xEnd);

    const rowBase = y * width;
    let la = ((by - cy) * (xStart + 0.5 - cx) + (cx - bx) * (py - cy)) / denom;
    let lb = ((cy - ay) * (xStart + 0.5 - cx) + (ax - cx) * (py - cy)) / denom;
    let w = cw + la * (aw - cw) + lb * (bw - cw);
    for (let x = xStart; x <= xEnd; x++) {
      const idx = rowBase + x;
      if (w > zbuf[idx]) {
        const lc = 1 - la - lb;
        let dist = Infinity;
        if (edgeMask[0]) dist = Math.min(dist, la * altA);
        if (edgeMask[1]) dist = Math.min(dist, lb * altB);
        if (edgeMask[2]) dist = Math.min(dist, lc * altC);
        zbuf[idx] = w;
        pixels[idx] = dist < EDGE_HALF_WIDTH ? edge32 : fill32;
      }
      la += dlaDx;
      lb += dlbDx;
      w += dwDx;
    }
  }
}

// Rasterize one textured triangle — drawTriangle with a photo on it.
//   a, b, c: [screenX, screenY, invZ, u*invZ, v*invZ] vertices.
//     Interpolating u*invZ and v*invZ linearly in screen space and
//     dividing by invZ per pixel is the perspective-correct texture
//     mapping (same trick as the depth itself).
//   tex: { data: Uint32Array of packed colors, w, h } — sampled
//     nearest-neighbor; data is row-major from the image's top row,
//     and v runs 0 at the top to 1 at the bottom.
//   Pixels within EDGE_HALF_WIDTH of a true edge get edge32, exactly
//   like the flat path, so a textured face keeps its outline.
export function drawTexturedTriangle(pixels, zbuf, width, height, a, b, c, tex, edge32, edgeMask) {
  const [ax, ay, aw, au, av] = a;
  const [bx, by, bw, bu, bv] = b;
  const [cx, cy, cw, cu, cv] = c;

  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) {
    return;
  }

  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minY > maxY) {
    return;
  }

  const area2 = Math.abs(denom);
  const altA = area2 / Math.hypot(bx - cx, by - cy);
  const altB = area2 / Math.hypot(ax - cx, ay - cy);
  const altC = area2 / Math.hypot(ax - bx, ay - by);

  const dlaDx = (by - cy) / denom;
  const dlbDx = (cy - ay) / denom;
  const dwDx = dlaDx * (aw - cw) + dlbDx * (bw - cw);
  const duDx = dlaDx * (au - cu) + dlbDx * (bu - cu);
  const dvDx = dlaDx * (av - cv) + dlbDx * (bv - cv);

  const vs = [[ax, ay], [bx, by], [cx, cy]].sort((p, q) => p[1] - q[1]);
  const [x0, y0] = vs[0];
  const [x1, y1] = vs[1];
  const [x2, y2] = vs[2];

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    if (py < y0 || py > y2 || y2 === y0) {
      continue;
    }
    const xLong = x0 + (x2 - x0) * ((py - y0) / (y2 - y0));
    let xShort;
    if (py <= y1 && y1 !== y0) {
      xShort = x0 + (x1 - x0) * ((py - y0) / (y1 - y0));
    } else if (y2 !== y1) {
      xShort = x1 + (x2 - x1) * ((py - y1) / (y2 - y1));
    } else {
      xShort = x1;
    }
    let xStart = Math.ceil(Math.min(xLong, xShort) - 0.5);
    let xEnd = Math.floor(Math.max(xLong, xShort) - 0.5);
    if (xEnd < 0 || xStart > width - 1) {
      continue;
    }
    xStart = Math.max(0, xStart);
    xEnd = Math.min(width - 1, xEnd);

    const rowBase = y * width;
    let la = ((by - cy) * (xStart + 0.5 - cx) + (cx - bx) * (py - cy)) / denom;
    let lb = ((cy - ay) * (xStart + 0.5 - cx) + (ax - cx) * (py - cy)) / denom;
    let w = cw + la * (aw - cw) + lb * (bw - cw);
    let u = cu + la * (au - cu) + lb * (bu - cu);
    let v = cv + la * (av - cv) + lb * (bv - cv);
    for (let x = xStart; x <= xEnd; x++) {
      const idx = rowBase + x;
      if (w > zbuf[idx]) {
        const lc = 1 - la - lb;
        let dist = Infinity;
        if (edgeMask[0]) dist = Math.min(dist, la * altA);
        if (edgeMask[1]) dist = Math.min(dist, lb * altB);
        if (edgeMask[2]) dist = Math.min(dist, lc * altC);
        zbuf[idx] = w;
        if (dist < EDGE_HALF_WIDTH) {
          pixels[idx] = edge32;
        } else {
          const tu = Math.min(tex.w - 1, Math.max(0, Math.floor((u / w) * tex.w)));
          const tv = Math.min(tex.h - 1, Math.max(0, Math.floor((v / w) * tex.h)));
          pixels[idx] = tex.data[tv * tex.w + tu];
        }
      }
      la += dlaDx;
      lb += dlbDx;
      w += dwDx;
      u += duDx;
      v += dvDx;
    }
  }
}
