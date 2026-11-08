// Pinch Frame: make an L with thumb and index finger on both hands; the four fingertips span a
// window, and inside it the camera is shown in false color.
//
// The window is the quadrilateral through both thumb tips (landmark 4) and both index tips (8),
// with its corners ordered by angle around their centroid so it never self-intersects as the
// hands cross. False color maps each pixel's luma Y = 0.2126R + 0.7152G + 0.0722B through a
// palette, precomputed as a 256-entry lookup table per frame:
//   Acid    — hue = frac(bands·Y + t·speed): brightness becomes hue bands that cycle in time.
//   Thermal — a heat ramp (black → indigo → magenta → orange → pale yellow), repeated `bands`
//             times across the range and drifting with time.
//   Invert  — each channel c becomes 255 − c.
//   Print   — the window becomes a printed sheet you hold by its corners: left index and thumb,
//             right index and thumb, kept in that order (not sorted), so the sheet can twist.
//             It is two triangles hinged on the diagonal, each texture-mapped by the affine map
//             that sends the print's corners to your fingertips. A triangle whose signed area
//             (cross product) flips sign shows its back, so twisting folds the sheet over.
//             Front: a two-color risograph. Blue (RISO Blue #0078BF) carries the shadows and
//             Yellow (#FFE800) the midtones; where they overprint, the inks multiply to green.
//             Each layer is screened against static grain (riso's stochastic screen, Grain), and
//             yellow is printed slightly off register (Shift).
//             Back: Bright Red (#F15060) amplitude-modulated halftone; a dot's area is the
//             cell's darkness, so its radius is r = c·√(darkness/π) for a cell of size c (Dots).
//             Sheets 2–4: the multi-finger print instead, one sheet per thumb–finger pair (index,
//             middle, ring, pinky) across both hands, sharing the thumb corners so they fan out.
//             Each is one RISO ink (Blue for shadows, Fluorescent Pink #FF48B0 for midtones,
//             Yellow for all but the highlights, Orange #FF6C2F for light midtones), screened
//             against grain on opaque paper; inks multiply where sheets overlap, like real riso.
//   Code    — pinch with both hands: the two pinch points (midpoint of thumb and index tips) are
//             opposite corners of a box, read out as a 1-bit code. The box is divided into cells
//             (Cells sets their size); each cell's mean luma is thresholded at the median of all
//             cells, so half the cells are always white. A thin box reads as barcode bars, a tall
//             one as a coarse 1-bit image. Guide lines run across the frame through both
//             corners, which carry their normalized coordinates. Lock on: each corner belongs to
//             a hand while it pinches and stays where it is when that hand opens; with both
//             hands open the box and its code hold still; a fist frees that hand's corner to
//             follow it until the next pinch. Lock off: corners follow the pinches live. Outside
//             codes everything but the box. An open hand's finger spread sets Cells; Color tints
//             the set bits; Solid fills the area with that color instead of code.
//   Blur    — the L-hand window shows the camera blurred (24-sample golden-angle disc); Frosted
//             adds frosted glass's random micro-facet offsets, haze and grain.
//             Mosaic samples each pixel's blur around the center of its cell (up to 8% of the
//             frame height), so the window becomes glass blocks, each blurred as one.
//   Prism, Triangle — folded paper held between your hands, each face a different print of the
//             camera; Mosaic — sliced window over a stack of snapped layers. See their functions.
(function () {
  var THUMB_TIP = 4, INDEX_TIP = 8;
  var THERMAL = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];

  function hsv(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  }

  function thermal(x) {
    var f = x * (THERMAL.length - 1), i = Math.min(THERMAL.length - 2, Math.floor(f)), k = f - i;
    var a = THERMAL[i], b = THERMAL[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  var PAPER = [246, 243, 234], BLUE = [0, 120, 191], YELLOW = [255, 232, 0], RED = [241, 80, 96];
  var TEX = 360, MARGIN = 0.035;

  function smoothstep(a, b, x) { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }

  // Static paper grain in [0, 1): an integer hash of the pixel, so the screen doesn't crawl.
  function grainAt(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Draws image `img` mapped by the affine transform taking texture points s0, s1, s2 to screen
  // points d0, d1, d2, clipped to that triangle (grown by half a pixel so the hinge has no seam).
  function drawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
    var ax = s1[0] - s0[0], ay = s1[1] - s0[1], bx = s2[0] - s0[0], by = s2[1] - s0[1];
    var den = ax * by - bx * ay;
    if (Math.abs(den) < 1e-6) return;
    var px = d1.x - d0.x, py = d1.y - d0.y, qx = d2.x - d0.x, qy = d2.y - d0.y;
    var a = (px * by - qx * ay) / den, c = (qx * ax - px * bx) / den;
    var b = (py * by - qy * ay) / den, d = (qy * ax - py * bx) / den;
    var e = d0.x - a * s0[0] - c * s0[1], f = d0.y - b * s0[0] - d * s0[1];
    var cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
    ctx.save();
    ctx.beginPath();
    [d0, d1, d2].forEach(function (p, i) {
      var dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1, g = 0.7 / l;
      var x = p.x + dx * g, y = p.y + dy * g;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function createPrint() {
    var src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
    var front = document.createElement('canvas'), fctx = front.getContext('2d');
    var back = document.createElement('canvas'), bctx = back.getContext('2d');
    var lum = null, g1 = null, g2 = null, fImg = null, bImg = null;

    // Prints the sheet's two sides from the camera inside its bounding box.
    function print(tw, th, params) {
      var px = sctx.getImageData(0, 0, tw, th).data, n = tw * th, i, x, y;
      if (!lum || lum.length !== n) lum = new Float32Array(n);
      // Luma, stretched to the sheet's own range so every print uses the full tone scale.
      var lo = 1, hi = 0;
      for (i = 0; i < n; i++) {
        var L = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
        lum[i] = L;
        if (L < lo) lo = L;
        if (L > hi) hi = L;
      }
      var span = Math.max(0.15, hi - lo);
      for (i = 0; i < n; i++) lum[i] = (lum[i] - lo) / span;

      if (!fImg || fImg.width !== tw || fImg.height !== th) {
        fImg = fctx.createImageData(tw, th); bImg = bctx.createImageData(tw, th);
        g1 = new Float32Array(n); g2 = new Float32Array(n);
        for (y = 0; y < th; y++) for (x = 0; x < tw; x++) { g1[y * tw + x] = grainAt(x, y) - 0.5; g2[y * tw + x] = grainAt(x + 911, y + 457) - 0.5; }
      }
      var fd = fImg.data, bd = bImg.data;
      var grain = params.grain / 100, shift = Math.round(params.shift / 100 * 6);
      var margin = params.border === false ? 0 : MARGIN;
      var cell = 3 + params.dots * 1.5, mx = Math.round(tw * margin), my = Math.round(th * margin);
      for (y = 0; y < th; y++) {
        for (x = 0; x < tw; x++) {
          i = y * tw + x;
          var o = i * 4;
          var inside = x >= mx && x < tw - mx && y >= my && y < th - my;
          var r = PAPER[0], g = PAPER[1], b = PAPER[2];
          if (inside) {
            var L0 = lum[i];
            // Yellow plate printed off register: it reads the image `shift` pixels away.
            var yx = Math.min(tw - 1, x + shift), yy = Math.min(th - 1, y + Math.round(shift / 2));
            var L1 = lum[yy * tw + yx];
            var blue = smoothstep(0.62, 0.22, L0);
            var yel = 1 - Math.abs(L1 - 0.42) / 0.32;
            var t1 = 0.5 + g1[i] * grain, t2 = 0.5 + g2[i] * grain;
            // Subtractive overprint: each inked layer multiplies the paper.
            if (yel > t2) { r = r * YELLOW[0] / 255; g = g * YELLOW[1] / 255; b = b * YELLOW[2] / 255; }
            if (blue > t1) { r = r * BLUE[0] / 255; g = g * BLUE[1] / 255; b = b * BLUE[2] / 255; }
          }
          fd[o] = r; fd[o + 1] = g; fd[o + 2] = b; fd[o + 3] = 255;

          var br = PAPER[0], bg = PAPER[1], bb = PAPER[2];
          if (inside) {
            var ci = Math.floor(x / cell), cj = Math.floor(y / cell);
            var ccx = (ci + 0.5) * cell, ccy = (cj + 0.5) * cell;
            var dark = 1 - lum[Math.min(th - 1, ccy | 0) * tw + Math.min(tw - 1, ccx | 0)];
            var rad = cell * Math.sqrt(Math.max(0, dark) / Math.PI);
            var ex = x + 0.5 - ccx, ey = y + 0.5 - ccy;
            var cover = rad - Math.sqrt(ex * ex + ey * ey) + 0.5;
            if (cover > 0) {
              cover = Math.min(1, cover);
              br += (br * RED[0] / 255 - br) * cover; bg += (bg * RED[1] / 255 - bg) * cover; bb += (bb * RED[2] / 255 - bb) * cover;
            }
          }
          bd[o] = br; bd[o + 1] = bg; bd[o + 2] = bb; bd[o + 3] = 255;
        }
      }
      fctx.putImageData(fImg, 0, 0);
      bctx.putImageData(bImg, 0, 0);
    }

    return function (frame, ctx, hands, params, outline) {
      var W = frame.width, H = frame.height;
      // Left hand (on screen) first.
      var hs = hands.slice(0, 2).sort(function (a, b) { return (a[INDEX_TIP].x + a[THUMB_TIP].x) - (b[INDEX_TIP].x + b[THUMB_TIP].x); });
      var P0 = hs[0][INDEX_TIP], P1 = hs[1][INDEX_TIP], P2 = hs[1][THUMB_TIP], P3 = hs[0][THUMB_TIP];
      var pts = [P0, P1, P2, P3];
      var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
      var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
      var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
      var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
      var bw = x1 - x0, bh = y1 - y0;
      if (bw < 4 || bh < 4) return;
      // The print's shape follows the sheet's own sides, not its bounding box.
      var wide = (Math.hypot(P1.x - P0.x, P1.y - P0.y) + Math.hypot(P2.x - P3.x, P2.y - P3.y)) / 2;
      var tall = (Math.hypot(P3.x - P0.x, P3.y - P0.y) + Math.hypot(P2.x - P1.x, P2.y - P1.y)) / 2;
      var tw = TEX, th = Math.max(24, Math.min(TEX * 2, Math.round(TEX * tall / Math.max(1, wide))));
      [src, front, back].forEach(function (c) { if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; } });
      // Draw only the box behind the sheet, scaled to the print's size.
      sctx.setTransform(tw / bw, 0, 0, th / bh, -x0 * tw / bw, -y0 * th / bh);
      frame.draw(sctx, W, H);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      print(tw, th, params);

      // Two triangles hinged on the P0–P2 diagonal. Front faces keep the orientation of the
      // print's own corners (positive area on screen, y down); a flipped one shows the back.
      var T = [[0, 0], [tw, 0], [tw, th], [0, th]];
      [[0, 1, 2], [0, 2, 3]].forEach(function (tri) {
        var a = pts[tri[0]], b = pts[tri[1]], c = pts[tri[2]];
        var area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        drawTriangle(ctx, area >= 0 ? front : back, T[tri[0]], T[tri[1]], T[tri[2]], a, b, c);
      });
      // Outline: the sheet's edges and its fold, the P0–P2 diagonal.
      outline.push(pts, [P0, P2]);
    };
  }

  // Layers (Print, Sheets 2–4): one sheet per thumb–finger pair (index, middle, ring, pinky), each
  // printed in one RISO ink. Corners: left finger tip, right finger tip, right thumb tip, left thumb
  // tip, so the sheets fan out from the shared thumbs. Paper is drawn first for every sheet (opaque),
  // then each ink is multiplied on top, so where sheets overlap the inks overprint like riso.
  var PINK = [255, 72, 176];
  var LAYERS = [
    { tip: 8, ink: BLUE, lo: 0.2, hi: 0.62 },       // index: shadows
    { tip: 12, ink: PINK, lo: 0.3, hi: 0.75, mid: true }, // middle: midtones
    { tip: 16, ink: YELLOW, lo: 0.4, hi: 0.88 },    // ring: everything but highlights
    { tip: 20, ink: [255, 108, 47], lo: 0.45, hi: 0.85, mid: true } // pinky: RISO Orange #FF6C2F, light midtones
  ];
  function createLayers() {
    var TEXW = 300;
    var src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
    var tex = LAYERS.map(function () { var c = document.createElement('canvas'); return { c: c, g: c.getContext('2d') }; });

    // One ink plate: coverage from luma (shadows, a midtone band, or most tones), screened against
    // static grain; transparent where there's no ink.
    function plate(t, layer, tw, th, grain, border) {
      var d = sctx.getImageData(0, 0, tw, th).data, img = t.g.createImageData(tw, th), o = img.data;
      var lo = 1, hi = 0, i, L;
      for (i = 0; i < tw * th; i++) { L = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; if (L < lo) lo = L; if (L > hi) hi = L; }
      var span = Math.max(0.15, hi - lo), margin = border ? Math.round(tw * 0.03) : 0;
      for (var y = 0; y < th; y++) {
        for (var x = 0; x < tw; x++) {
          i = y * tw + x;
          L = ((0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 - lo) / span;
          var cov = layer.mid ? 1 - Math.abs(L - (layer.lo + layer.hi) / 2) / ((layer.hi - layer.lo) / 2) : smoothstep(layer.hi, layer.lo, L);
          var inside = x >= margin && x < tw - margin && y >= margin && y < th - margin;
          var on = inside && cov > 0.5 + (grainAt(x + layer.tip * 131, y) - 0.5) * grain;
          o[i * 4] = layer.ink[0]; o[i * 4 + 1] = layer.ink[1]; o[i * 4 + 2] = layer.ink[2]; o[i * 4 + 3] = on ? 255 : 0;
        }
      }
      t.g.putImageData(img, 0, 0);
    }

    return function (frame, ctx, ix, params, outline) {
      var pair = ix.pair;
      if (!pair) return false;
      var Lh = pair.left.points, Rh = pair.right.points, W = frame.width, H = frame.height;
      var sheets = LAYERS.slice(0, Math.max(2, Math.min(4, params.sheets || 4))).map(function (layer, k) {
        var pts = [Lh[layer.tip], Rh[layer.tip], Rh[THUMB_TIP], Lh[THUMB_TIP]];
        var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
        var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
        var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
        var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
        return { layer: layer, t: tex[k], pts: pts, x0: x0, y0: y0, bw: x1 - x0, bh: y1 - y0 };
      }).filter(function (sh) { return sh.bw > 4 && sh.bh > 4; });
      var grain = params.grain / 100;
      sheets.forEach(function (sh) {
        var tw = TEXW, th = Math.max(16, Math.min(TEXW * 2, Math.round(TEXW * sh.bh / sh.bw)));
        if (src.width !== tw || src.height !== th) { src.width = tw; src.height = th; }
        if (sh.t.c.width !== tw || sh.t.c.height !== th) { sh.t.c.width = tw; sh.t.c.height = th; }
        sctx.setTransform(tw / sh.bw, 0, 0, th / sh.bh, -sh.x0 * tw / sh.bw, -sh.y0 * th / sh.bh);
        frame.draw(sctx, W, H);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        plate(sh.t, sh.layer, tw, th, grain, params.border !== false);
        sh.tw = tw; sh.th = th;
      });
      function quad(sh, img) {
        var T = [[0, 0], [sh.tw, 0], [sh.tw, sh.th], [0, sh.th]], p = sh.pts;
        [[0, 1, 2], [0, 2, 3]].forEach(function (tri) { drawTriangle(ctx, img, T[tri[0]], T[tri[1]], T[tri[2]], p[tri[0]], p[tri[1]], p[tri[2]]); });
      }
      ctx.save();
      ctx.fillStyle = 'rgb(' + PAPER.join(',') + ')';
      sheets.forEach(function (sh) {
        ctx.beginPath();
        sh.pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'multiply';
      sheets.forEach(function (sh) { quad(sh, sh.t.c); });
      ctx.restore();
      sheets.forEach(function (sh) { outline.push(sh.pts); });
      return true;
    };
  }

  function createCode() {
    var small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
    var bits = document.createElement('canvas'), bctx = bits.getContext('2d'), img = null, lum = null;
    // Corners: one per hand. With Lock on, a pinch holds a corner and it stays where you let go; a
    // fist frees that hand's corner, which then follows the hand until a pinch locks it again.
    // With Lock off both corners follow the pinch points live.
    var slots = [], frozen = false;

    function mid(h) { var p = h.points; return { x: (p[THUMB_TIP].x + p[INDEX_TIP].x) / 2, y: (p[THUMB_TIP].y + p[INDEX_TIP].y) / 2 }; }

    // The 1-bit code of a region: each cell's mean luma against the median of all cells, set bits
    // in the ink color. Leaves the result in `bits`.
    function encode(frame, rx, ry, rw, rh, cell, ink) {
      var cols = Math.max(1, Math.round(rw / cell)), rows = Math.max(1, Math.round(rh / cell)), n = cols * rows;
      if (small.width !== cols || small.height !== rows) {
        small.width = bits.width = cols; small.height = bits.height = rows;
        img = bctx.createImageData(cols, rows); lum = new Float32Array(n);
      }
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.setTransform(cols / rw, 0, 0, rows / rh, -rx * cols / rw, -ry * rows / rh);
      frame.draw(sctx, frame.width, frame.height);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      var d = sctx.getImageData(0, 0, cols, rows).data, i;
      for (i = 0; i < n; i++) lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      var sorted = Array.prototype.slice.call(lum).sort(function (a, b) { return a - b; });
      var median = sorted[n >> 1], o = img.data;
      for (i = 0; i < n; i++) {
        var on = lum[i] > median || (n === 1 && lum[i] > 127);
        o[i * 4] = on ? ink[0] : 0; o[i * 4 + 1] = on ? ink[1] : 0; o[i * 4 + 2] = on ? ink[2] : 0; o[i * 4 + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);
    }

    return function (frame, ctx, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, hands = ix.hands;
      function slotOf(h) { var r = null; slots.forEach(function (sl) { if (sl.id === h.id) r = sl; }); return r; }
      if (!params.lock) {
        if (hands.length >= 2) slots = hands.slice(0, 2).map(function (h) { var m = mid(h); return { id: h.id, x: m.x, y: m.y, free: true }; });
      } else {
        var ids = hands.map(function (h) { return h.id; }), claimed = {};
        hands.forEach(function (h) {
          var m = mid(h), slot = slotOf(h);
          if (h.pinched) {
            if (!slot && slots.length < 2) { slot = { id: h.id }; slots.push(slot); }
            if (!slot) {
              // Take over a corner whose hand is gone, else the nearest one not held this frame.
              slots.forEach(function (sl) { if (!slot && ids.indexOf(sl.id) < 0) slot = sl; });
              slots.forEach(function (sl) { if (!claimed[sl.id] && (!slot || Math.hypot(sl.x - m.x, sl.y - m.y) < Math.hypot(slot.x - m.x, slot.y - m.y))) slot = sl; });
              slot.id = h.id;
            }
            slot.x = m.x; slot.y = m.y; slot.free = false; claimed[slot.id] = true;
          } else if (slot) {
            if (h.fist) slot.free = true;           // a fist unlocks this hand's corner
            if (slot.free) { slot.x = m.x; slot.y = m.y; }
          }
        });
      }
      var corners = slots.length === 2 ? slots : hands.length >= 2 ? hands.slice(0, 2).map(mid) : null;
      if (!corners) return false;
      var live = !params.lock || slots.length < 2 || hands.some(function (h) { return h.pinched; }) || slots.some(function (sl) { return sl.free; });
      var wasFrozen = frozen;
      frozen = !live;

      var x0 = Math.max(0, Math.min(corners[0].x, corners[1].x)), x1 = Math.min(W, Math.max(corners[0].x, corners[1].x));
      var y0 = Math.max(0, Math.min(corners[0].y, corners[1].y)), y1 = Math.min(H, Math.max(corners[0].y, corners[1].y));
      var bw = x1 - x0, bh = y1 - y0, line = Math.max(1, u);
      var ink = Magi.fx.inkColor(params.color).map(function (c) { return Math.round(c * 255); });

      ctx.save();
      if (bw >= 2 && bh >= 2) {
        // Inside: the box is the code. Outside: everything but the box is, and the box stays live.
        var rx = params.outside ? 0 : x0, ry = params.outside ? 0 : y0, rw = params.outside ? W : bw, rh = params.outside ? H : bh;
        if (params.solid) {
          // Solid: the area is one flat color instead of code.
          ctx.fillStyle = 'rgb(' + ink.join(',') + ')';
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          if (!(frozen && wasFrozen && bits.width > 0)) encode(frame, rx, ry, rw, rh, (3 + params.cells * 2.5) * u, ink);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(bits, rx, ry, rw, rh);
          ctx.imageSmoothingEnabled = true;
        }
        if (params.outside) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, y0, bw, bh); ctx.clip();
          frame.draw(ctx, W, H);
          ctx.restore();
        }
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = line;
        ctx.strokeRect(x0 + line / 2, y0 + line / 2, bw - line, bh - line);
      }

      // Guides across the whole frame through both corners.
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = line;
      ctx.beginPath();
      corners.forEach(function (c) {
        ctx.moveTo(0, c.y); ctx.lineTo(W, c.y);
        ctx.moveTo(c.x, 0); ctx.lineTo(c.x, H);
      });
      ctx.stroke();

      // Corner markers (hollow when free) and their normalized coordinates, full precision.
      var fs = Math.round(8 * u), sq = 5 * u, hud = frame.hud;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      hud.fillStyle = '#fff';
      hud.font = fs + 'px ' + Magi.fx.MONO;
      hud.textBaseline = 'top';
      corners.forEach(function (c) {
        if (c.free && params.lock) ctx.strokeRect(c.x - sq / 2, c.y - sq / 2, sq, sq);
        else ctx.fillRect(c.x - sq / 2, c.y - sq / 2, sq, sq);
        var left = c.x > W * 0.7, above = c.y > H * 0.85;
        hud.textAlign = left ? 'right' : 'left';
        var tx = c.x + (left ? -sq : sq), ty = c.y + (above ? -fs * 2.6 : sq);
        hud.fillText(String(c.x / W), tx, ty);
        hud.fillText(String(c.y / H), tx, ty + fs * 1.2);
      });
      if (frozen) { hud.textAlign = 'left'; hud.fillText('locked', x0, Math.max(0, y0 - fs * 1.4)); }
      ctx.restore();
      return true;
    };
  }

  // Blur: 24 samples on a golden-angle (Vogel) disc of the given radius, weighted toward the
  // center, an even approximation of a lens blur. Frosted adds what frosted glass does: each pixel
  // looks through a randomly tilted micro-facet (a random offset of 0.6 × the radius, fixed per
  // pixel), a milky haze (12% toward white) and fine grain.
  var BLUR_FRAG = [
    'precision highp float;',
    'uniform sampler2D cam;',
    'uniform vec2 size;',
    'uniform float radius, frost, seed, cell;',
    'varying vec2 uv;',
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'void main() {',
    '  vec2 px = uv * size;',
    '  if (cell > 1.0) px = (floor(px / cell) + 0.5) * cell;',
    '  if (frost > 0.5) px += (vec2(hash(floor(px)), hash(floor(px) + 17.0)) - 0.5) * 1.2 * radius;',
    '  vec3 sum = vec3(0.0); float wsum = 0.0;',
    '  for (int i = 0; i < 24; i++) {',
    '    float r = sqrt((float(i) + 0.5) / 24.0), a = float(i) * 2.39996;',
    '    float w = 1.0 - 0.5 * r;',
    '    sum += texture2D(cam, clamp((px + vec2(cos(a), sin(a)) * r * radius) / size, 0.0, 1.0)).rgb * w;',
    '    wsum += w;',
    '  }',
    '  vec3 c = sum / wsum;',
    '  if (frost > 0.5) c = mix(c, vec3(0.92), 0.12) + (hash(px + seed) - 0.5) * 0.05;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // Print faces for Prism and Triangle: the camera behind the shape, printed four ways on the same
  // paper (contrast stretched to the crop's own range, as in Print). Stipple faces are riso
  // stochastic screens: ink where the tone's coverage beats the paper grain at that pixel.
  //   0 Blue stipple: RISO Blue where the darkness 1 − L beats the grain.
  //   1 Green/yellow: RISO Green (#00A95C) on the shadows and Yellow on the midtones, multiplied.
  //   2 Pink stipple: Fluorescent Pink on shadows and midtones.
  //   3 Red dots: Bright Red amplitude-modulated halftone, dot radius r = c·√(darkness/π) (Dots).
  // Faces are drawn by clipping to each face's polygon and drawing the print registered to the
  // camera behind it, so the picture runs on across the folds; each face is then shaded by how
  // far it turns away (a Lambert-like 1 − cos term), which is what makes the paper read as folded.
  var GREEN = [0, 169, 92], PINK = [255, 72, 176], LIME = [184, 242, 90];
  function createFaces() {
    var src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
    var outs = [0, 1, 2, 3].map(function () { var c = document.createElement('canvas'); return { c: c, g: c.getContext('2d'), img: null }; });
    var lum = null;
    function mul(o, k, ink) { o[k] *= ink[0] / 255; o[k + 1] *= ink[1] / 255; o[k + 2] *= ink[2] / 255; }
    return function (frame, x0, y0, bw, bh, params) {
      var W = frame.width, H = frame.height, tw = TEX, th = Math.max(24, Math.min(TEX * 2, Math.round(TEX * bh / Math.max(1, bw))));
      if (src.width !== tw || src.height !== th) { src.width = tw; src.height = th; }
      sctx.setTransform(tw / bw, 0, 0, th / bh, -x0 * tw / bw, -y0 * th / bh);
      frame.draw(sctx, W, H);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      var px = sctx.getImageData(0, 0, tw, th).data, n = tw * th, i, x, y, lo = 1, hi = 0;
      if (!lum || lum.length !== n) lum = new Float32Array(n);
      for (i = 0; i < n; i++) { var L = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; lum[i] = L; if (L < lo) lo = L; if (L > hi) hi = L; }
      var span = Math.max(0.15, hi - lo);
      outs.forEach(function (o) {
        if (o.c.width !== tw || o.c.height !== th) { o.c.width = tw; o.c.height = th; o.img = null; }
        if (!o.img) o.img = o.g.createImageData(tw, th);
      });
      var d0 = outs[0].img.data, d1 = outs[1].img.data, d2 = outs[2].img.data, d3 = outs[3].img.data;
      var g = 0.25 + 0.75 * params.grain / 100, cell = 3 + params.dots * 1.5;
      for (y = 0; y < th; y++) {
        for (x = 0; x < tw; x++) {
          i = y * tw + x;
          var k = i * 4, L0 = (lum[i] - lo) / span, dark = 1 - L0;
          var t1 = 0.5 + (grainAt(x, y) - 0.5) * g, t2 = 0.5 + (grainAt(x + 911, y + 457) - 0.5) * g, t3 = 0.5 + (grainAt(x + 313, y + 1021) - 0.5) * g;
          [d0, d1, d2, d3].forEach(function (d) { d[k] = PAPER[0]; d[k + 1] = PAPER[1]; d[k + 2] = PAPER[2]; d[k + 3] = 255; });
          if (dark > t1) mul(d0, k, BLUE);
          if (smoothstep(0.6, 0.15, L0) > t2) mul(d1, k, GREEN);
          if (1 - Math.abs(L0 - 0.5) / 0.35 > t1) mul(d1, k, YELLOW);
          if (smoothstep(0.8, 0.25, L0) > t3) mul(d2, k, PINK);
          var ccx = (Math.floor(x / cell) + 0.5) * cell, ccy = (Math.floor(y / cell) + 0.5) * cell;
          var dk = 1 - (lum[Math.min(th - 1, ccy | 0) * tw + Math.min(tw - 1, ccx | 0)] - lo) / span;
          var cover = cell * Math.sqrt(Math.max(0, dk) / Math.PI) - Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy) + 0.5;
          if (cover > 0) { cover = Math.min(1, cover); d3[k] += (d3[k] * RED[0] / 255 - d3[k]) * cover; d3[k + 1] += (d3[k + 1] * RED[1] / 255 - d3[k + 1]) * cover; d3[k + 2] += (d3[k + 2] * RED[2] / 255 - d3[k + 2]) * cover; }
        }
      }
      outs.forEach(function (o) { o.g.putImageData(o.img, 0, 0); });
      return outs.map(function (o) { return o.c; });
    };
  }

  function bbox(pts, W, H) {
    var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
    var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
    var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
    var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
    return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
  }
  function face(ctx, poly, tex, b, shade) {
    ctx.save();
    ctx.beginPath();
    poly.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(tex, b.x0, b.y0, b.w, b.h);
    if (shade > 0) { ctx.fillStyle = 'rgba(0,0,0,' + shade.toFixed(3) + ')'; ctx.fill(); }
    ctx.restore();
  }
  function lerpP(a, b, k) { return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }

  // Prism: a folded paper kite. The four corners are the index and thumb tips of both hands; three
  // creases run across from the left hand to the right at 40%, 50% and 60% of the way from index to
  // thumb, so the paper folds into four facets: blue stipple, green/yellow, pink stipple, red dots.
  // The middle crease is the ridge, lifted toward you: the two narrow facets turn away by the fold
  // angle, which opens with the thumb–index spread (θ = 20° + 50° × spread), and are shaded by
  // 1 − cos θ; the outer facets face you.
  function createPrism() {
    var faces = createFaces();
    return function (frame, ctx, ix, params, outline) {
      var pair = ix.pair;
      if (!pair) return false;
      var L = pair.left.points, R = pair.right.points, W = frame.width, H = frame.height;
      var Li = L[INDEX_TIP], Lt = L[THUMB_TIP], Ri = R[INDEX_TIP], Rt = R[THUMB_TIP];
      var b = bbox([Li, Lt, Ri, Rt], W, H);
      if (b.w < 4 || b.h < 4) return true;
      var tex = faces(frame, b.x0, b.y0, b.w, b.h, params);
      var at = function (k) { return [lerpP(Li, Lt, k), lerpP(Ri, Rt, k)]; };
      var c1 = at(0.4), c2 = at(0.5), c3 = at(0.6);
      var spread = Math.min(1, (pair.left.pinchWith.index.distance + pair.right.pinchWith.index.distance) / 2 / 1.5);
      var fold = (20 + 50 * spread) * Math.PI / 180, side = 1 - Math.cos(fold);
      var polys = [[Li, Ri, c1[1], c1[0]], [c1[0], c1[1], c2[1], c2[0]], [c2[0], c2[1], c3[1], c3[0]], [c3[0], c3[1], Rt, Lt]];
      var shades = [0, side * 0.55, side * 0.3, 0.04];
      polys.forEach(function (poly, k) { face(ctx, poly, tex[k], b, shades[k]); });
      outline.push([Li, Ri, Rt, Lt], [c1[0], c1[1]], [c2[0], c2[1]], [c3[0], c3[1]]);
      return true;
    };
  }

  // Triangle: a three-sided paper prism stretched between your hands along the line joining the
  // midpoints of each hand's thumb and index tips; its radius is half their mean spread. Rolling
  // your hands spins it: φ = 1.5 × the hands' mean rotation. A vertex at angle θ sits at
  // n·r·cos θ across the axis and r·sin θ toward you (orthographic). A face between θa and θa + 120°
  // faces you when its normal's z, sin(θa + 60°), is positive; visible faces are drawn back to
  // front and shaded by 1 − that z. Faces print blue stipple, green/yellow and red dots.
  function createTriangle() {
    var faces = createFaces();
    return function (frame, ctx, ix, params, outline) {
      var pair = ix.pair;
      if (!pair) return false;
      var L = pair.left.points, R = pair.right.points, W = frame.width, H = frame.height;
      var ML = lerpP(L[INDEX_TIP], L[THUMB_TIP], 0.5), MR = lerpP(R[INDEX_TIP], R[THUMB_TIP], 0.5);
      var dx = MR.x - ML.x, dy = MR.y - ML.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      var r = Math.max(8, (Math.hypot(L[4].x - L[8].x, L[4].y - L[8].y) + Math.hypot(R[4].x - R[8].x, R[4].y - R[8].y)) / 4);
      var phi = (pair.left.rotation + pair.right.rotation) / 2 * Math.PI / 180 * 1.5;
      var off = function (P, th) { return { x: P.x + nx * r * Math.cos(th), y: P.y + ny * r * Math.cos(th) }; };
      var list = [0, 1, 2].map(function (k) {
        var a = phi + k * 2 * Math.PI / 3, bth = a + 2 * Math.PI / 3, z = Math.sin(a + Math.PI / 3);
        return { k: k, z: z, poly: [off(ML, a), off(MR, a), off(MR, bth), off(ML, bth)] };
      }).filter(function (f) { return f.z > 0; }).sort(function (a, b) { return a.z - b.z; });
      var all = [];
      list.forEach(function (f) { all = all.concat(f.poly); });
      if (!all.length) return true;
      var b = bbox(all, W, H);
      if (b.w < 4 || b.h < 4) return true;
      var tex = faces(frame, b.x0, b.y0, b.w, b.h, params);
      list.forEach(function (f) { face(ctx, f.poly, tex[[0, 1, 3][f.k]], b, (1 - f.z) * 0.6); outline.push(f.poly); });
      return true;
    };
  }

  // Mosaic (after a hand-framed album-cover collage): inside the L-hand window the camera is cut
  // into vertical slices (Slices), each shifted up or down by its own drifting offset, a sum of two
  // sines with a per-slice phase, up to Shift × a quarter of the window's height. Pinch with either
  // hand: the window's current picture is snapped onto a stack (up to 4), drawn behind the window
  // like album covers, each offset up and to the right; Mix sets the share of slices that show the
  // newest snapped layer instead of the camera, changing every half second. Your body, from the
  // selfie segmenter, lies over it as a flat lime silhouette (Silhouette sets its opacity).
  // The slice displacement is the same mechanism planned for the attachment-4 glitch, where it will
  // move into shared.js once both use it.
  function createMosaic() {
    var cam = document.createElement('canvas'), cctx = cam.getContext('2d');
    var sil = document.createElement('canvas'), silCtx = sil.getContext('2d'), silImg = null, lastSeg = null;
    var stack = [], wasPinched = false;
    function hash(i, j) { var h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    return function (frame, ctx, ix, pts, params) {
      var W = frame.width, H = frame.height, t = frame.time / 1000, u = frame.pxPerCss;
      if (cam.width !== W || cam.height !== H) { cam.width = W; cam.height = H; }
      frame.draw(cctx, W, H);
      var b = bbox(pts, W, H);
      if (b.w < 4 || b.h < 4) return;
      // A new pinch snaps the window onto the stack.
      var pinched = ix.hands.some(function (h) { return h.pinched; });
      if (pinched && !wasPinched) {
        var snap = document.createElement('canvas');
        snap.width = b.w; snap.height = b.h;
        snap.getContext('2d').drawImage(cam, b.x0, b.y0, b.w, b.h, 0, 0, b.w, b.h);
        stack.unshift(snap);
        if (stack.length > 4) stack.pop();
      }
      wasPinched = pinched;
      // The stack behind the window, oldest farthest back.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, u);
      for (var k = stack.length - 1; k >= 0; k--) {
        var ox = (k + 1) * b.w * 0.06, oy = -(k + 1) * b.h * 0.06;
        ctx.drawImage(stack[k], b.x0 + ox, b.y0 + oy, b.w, b.h);
        ctx.strokeRect(b.x0 + ox + 0.5, b.y0 + oy + 0.5, b.w, b.h);
      }
      ctx.restore();
      // Live slices, clipped to the window.
      ctx.save();
      ctx.beginPath();
      pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(b.x0, b.y0, b.w, b.h);
      var n = Math.max(1, Math.round(params.slices)), sw = b.w / n, amp = params.shift / 100 * 0.25 * b.h, epoch = Math.floor(t * 2);
      for (var i = 0; i < n; i++) {
        var ph = hash(i, 7) * 6.283, o = amp * (0.65 * Math.sin(t * 1.1 + ph) + 0.35 * Math.sin(t * 2.9 + ph * 1.7));
        var sx = b.x0 + i * sw, fromStack = stack.length && hash(i, epoch) < params.mix / 100;
        if (fromStack) ctx.drawImage(stack[0], i * sw * stack[0].width / b.w, 0, Math.max(1, sw * stack[0].width / b.w), stack[0].height, sx, b.y0 + o, sw + 0.5, b.h);
        else ctx.drawImage(cam, sx, Math.max(0, Math.min(H - b.h, b.y0 - o)), sw, b.h, sx, b.y0, sw + 0.5, b.h);
      }
      // Lime silhouette from the person mask.
      if (params.silhouette > 0) {
        var seg = Magi.tracking.body.detect(frame);
        if (seg && seg !== lastSeg) {
          lastSeg = seg;
          if (sil.width !== seg.width || sil.height !== seg.height) { sil.width = seg.width; sil.height = seg.height; silImg = null; }
          silImg = silImg || silCtx.createImageData(seg.width, seg.height);
          var sd = silImg.data;
          for (var q = 0; q < seg.width * seg.height; q++) {
            var m = smoothstep(0.35, 0.65, seg.mask[q]);
            sd[q * 4] = LIME[0]; sd[q * 4 + 1] = LIME[1]; sd[q * 4 + 2] = LIME[2]; sd[q * 4 + 3] = m * 255;
          }
          silCtx.putImageData(silImg, 0, 0);
        }
        if (seg) { ctx.globalAlpha = params.silhouette / 100; ctx.drawImage(sil, 0, 0, W, H); ctx.globalAlpha = 1; }
      }
      ctx.restore();
    };
  }

  function createPinchFrame() {
    var drawPrint = null, drawCode = null, drawLayers = null, drawPrism = null, drawTri = null, drawMosaic = null, blurPass;
    var work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
    var tint = document.createElement('canvas'), tctx = tint.getContext('2d');
    var lut = new Uint8ClampedArray(256 * 3);

    function buildLut(mode, bands, t) {
      for (var y = 0; y < 256; y++) {
        var x = y / 255, c;
        if (mode === 'thermal') {
          var u = (x * bands + t * 0.25) % 1;
          // Mirror alternate repeats so the ramp has no hard seam between bands.
          c = thermal(Math.floor(x * bands + t * 0.25) % 2 ? 1 - u : u);
        } else {
          var rgb = hsv((x * bands + t) % 1, 1, 0.55 + 0.45 * x);
          c = [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255];
        }
        lut[y * 3] = c[0];
        lut[y * 3 + 1] = c[1];
        lut[y * 3 + 2] = c[2];
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame);

        var drewCode = false, windowPts = null, outline = [];
        if (params.mode === 'print' && params.sheets >= 2) {
          drewCode = (drawLayers || (drawLayers = createLayers()))(frame, ctx, Magi.interaction.read(frame), params, outline) !== false;
        } else if (params.mode === 'code') {
          drewCode = (drawCode || (drawCode = createCode()))(frame, ctx, Magi.interaction.read(frame), params) !== false;
        } else if (params.mode === 'prism') {
          drewCode = (drawPrism || (drawPrism = createPrism()))(frame, ctx, Magi.interaction.read(frame), params, outline) !== false;
        } else if (params.mode === 'triangle') {
          drewCode = (drawTri || (drawTri = createTriangle()))(frame, ctx, Magi.interaction.read(frame), params, outline) !== false;
        } else if (hands.length >= 2 && params.mode === 'print') {
          (drawPrint || (drawPrint = createPrint()))(frame, ctx, hands, params, outline);
        } else if (hands.length >= 2) {
          var pts = [hands[0][THUMB_TIP], hands[0][INDEX_TIP], hands[1][INDEX_TIP], hands[1][THUMB_TIP]];
          var cx = 0, cy = 0;
          pts.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
          pts.sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
          windowPts = pts;
          var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
          var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
          var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
          var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
          var bw = x1 - x0, bh = y1 - y0;
          if (bw > 2 && bh > 2 && params.mode === 'mosaic') {
            (drawMosaic || (drawMosaic = createMosaic()))(frame, ctx, Magi.interaction.read(frame), pts, params);
          } else if (bw > 2 && bh > 2 && params.mode === 'blur') {
            // Blur: the window shows the camera through a soft (or frosted) pane.
            if (blurPass === undefined) blurPass = Magi.fx.shaderPass(BLUR_FRAG, ['cam']);
            if (blurPass) {
              blurPass.texture('cam', out);
              blurPass.run(W, H, { size: [W, H], radius: (2 + params.blur / 100 * 30) * Math.max(W, H) / 1280, frost: params.frost ? 1 : 0, seed: frame.time % 1000, cell: params.mosaic / 100 * 0.08 * H });
              ctx.save();
              ctx.beginPath();
              pts.forEach(function (p, k) { k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(blurPass.canvas, 0, 0);
              ctx.restore();
            }
          } else if (bw > 2 && bh > 2) {
            if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
            frame.draw(wctx, W, H);
            var img = wctx.getImageData(x0, y0, bw, bh), d = img.data;
            var mode = params.mode || 'acid';
            if (mode === 'invert') {
              for (var i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
            } else {
              buildLut(mode, params.bands, (frame.time / 1000) * (params.speed / 100));
              for (var j = 0; j < d.length; j += 4) {
                var Y = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) | 0;
                d[j] = lut[Y * 3]; d[j + 1] = lut[Y * 3 + 1]; d[j + 2] = lut[Y * 3 + 2];
              }
            }
            if (tint.width !== bw || tint.height !== bh) { tint.width = bw; tint.height = bh; }
            tctx.putImageData(img, 0, 0);
            ctx.save();
            ctx.beginPath();
            pts.forEach(function (p, k) { k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(tint, x0, y0);
            ctx.restore();
          }
        }

        // Line: a crisp outline around the filter window, or around each print sheet (and its fold).
        if (windowPts) outline.push(windowPts);
        if (params.line && outline.length && ['acid', 'thermal', 'invert', 'blur', 'print', 'prism', 'triangle', 'mosaic'].indexOf(params.mode || 'acid') >= 0) {
          ctx.save();
          ctx.strokeStyle = ['print', 'prism', 'triangle'].indexOf(params.mode) >= 0 ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.95)';
          ctx.lineWidth = Math.max(1, 1.25 * u);
          ctx.lineJoin = 'miter';
          ctx.beginPath();
          outline.forEach(function (poly) {
            poly.forEach(function (p, k) { k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
            if (poly.length > 2) ctx.closePath();
          });
          ctx.stroke();
          ctx.restore();
        }

        var C = Magi.tracking.connections;
        if (params.skeleton && C) {
          hands.forEach(function (p) {
            ctx.strokeStyle = 'rgb(255,40,40)';
            ctx.lineWidth = Math.max(1, 2.5 * u);
            ctx.beginPath();
            C.hand.forEach(function (c) { ctx.moveTo(p[c.start].x, p[c.start].y); ctx.lineTo(p[c.end].x, p[c.end].y); });
            ctx.stroke();
            ctx.fillStyle = 'rgb(48,255,48)';
            p.forEach(function (q) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, 3.5 * u), 0, Math.PI * 2); ctx.fill(); });
          });
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (['code', 'prism', 'triangle'].indexOf(params.mode) >= 0 || (params.mode === 'print' && params.sheets >= 2) ? !drewCode : hands.length < 2) {
          Magi.tracking.hint(ctx, frame, params.mode === 'print' && params.sheets >= 2
            ? 'Both hands: thumbs at the bottom; index, middle, ring and pinky each hold a sheet.'
            : params.mode === 'print' ? 'Hold a sheet: index fingers at its top corners, thumbs at the bottom.'
            : params.mode === 'code' ? 'Pinch with both hands to draw a box.'
            : params.mode === 'prism' ? 'Hold the paper: index fingers at its top corners, thumbs at the bottom. Open to deepen the fold.'
            : params.mode === 'triangle' ? 'Hold the prism between both hands; roll your hands to turn it.'
            : params.mode === 'mosaic' ? 'Make an L with thumb and index on both hands; pinch to snap a layer.'
            : 'Make an L with thumb and index finger on both hands.');
        }
      },
      reset: function () {}
    };
  }

  Magi.renderers['pinch-frame'] = createPinchFrame;
})();
