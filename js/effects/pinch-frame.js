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
//   Code    — pinch with both hands: the two pinch points (midpoint of thumb and index tips) are
//             opposite corners of a box, read out as a 1-bit code. The box is divided into cells
//             (Cells sets their size); each cell's mean luma is thresholded at the median of all
//             cells, so half the cells are always white. A thin box reads as barcode bars, a tall
//             one as a coarse 1-bit image. Guide lines run across the frame through both
//             corners, which carry their normalized coordinates.
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
      var cell = 3 + params.dots * 1.5, mx = Math.round(tw * MARGIN), my = Math.round(th * MARGIN);
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

    return function (frame, ctx, hands, params) {
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
    };
  }

  function createCode() {
    var small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
    var bits = document.createElement('canvas'), bctx = bits.getContext('2d'), img = null, lum = null;

    return function (frame, ctx, hands, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss;
      var corners = hands.slice(0, 2).map(function (p) {
        return { x: (p[THUMB_TIP].x + p[INDEX_TIP].x) / 2, y: (p[THUMB_TIP].y + p[INDEX_TIP].y) / 2 };
      });
      var x0 = Math.max(0, Math.min(corners[0].x, corners[1].x)), x1 = Math.min(W, Math.max(corners[0].x, corners[1].x));
      var y0 = Math.max(0, Math.min(corners[0].y, corners[1].y)), y1 = Math.min(H, Math.max(corners[0].y, corners[1].y));
      var bw = x1 - x0, bh = y1 - y0;
      var line = Math.max(1, u);

      // Guides across the whole frame through both corners.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = line;
      ctx.beginPath();
      corners.forEach(function (c) {
        ctx.moveTo(0, c.y); ctx.lineTo(W, c.y);
        ctx.moveTo(c.x, 0); ctx.lineTo(c.x, H);
      });
      ctx.stroke();

      if (bw >= 2 && bh >= 2) {
        var cell = (3 + params.cells * 2.5) * u;
        var cols = Math.max(1, Math.round(bw / cell)), rows = Math.max(1, Math.round(bh / cell)), n = cols * rows;
        if (small.width !== cols || small.height !== rows) {
          small.width = bits.width = cols; small.height = bits.height = rows;
          img = bctx.createImageData(cols, rows); lum = new Float32Array(n);
        }
        // Each cell's mean: the box drawn down to one pixel per cell, smoothed.
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.setTransform(cols / bw, 0, 0, rows / bh, -x0 * cols / bw, -y0 * rows / bh);
        frame.draw(sctx, W, H);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        var d = sctx.getImageData(0, 0, cols, rows).data, i;
        for (i = 0; i < n; i++) lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        var sorted = Array.prototype.slice.call(lum).sort(function (a, b) { return a - b; });
        var median = sorted[n >> 1], o = img.data;
        for (i = 0; i < n; i++) {
          var v = lum[i] > median || (n === 1 && lum[i] > 127) ? 255 : 0;
          o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255;
        }
        bctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bits, x0, y0, bw, bh);
        ctx.imageSmoothingEnabled = true;
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(x0 + line / 2, y0 + line / 2, bw - line, bh - line);
      }

      // Corner markers and their normalized coordinates, full precision.
      var fs = Math.round(8 * u), sq = 5 * u;
      ctx.fillStyle = '#fff';
      ctx.font = fs + 'px ' + Magi.fx.MONO;
      ctx.textBaseline = 'top';
      corners.forEach(function (c) {
        ctx.fillRect(c.x - sq / 2, c.y - sq / 2, sq, sq);
        var left = c.x > W * 0.7, above = c.y > H * 0.85;
        ctx.textAlign = left ? 'right' : 'left';
        var tx = c.x + (left ? -sq : sq), ty = c.y + (above ? -fs * 2.6 : sq);
        ctx.fillText(String(c.x / W), tx, ty);
        ctx.fillText(String(c.y / H), tx, ty + fs * 1.2);
      });
      ctx.restore();
    };
  }

  function createPinchFrame() {
    var drawPrint = null, drawCode = null;
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

        if (hands.length >= 2 && params.mode === 'code') {
          (drawCode || (drawCode = createCode()))(frame, ctx, hands, params);
        } else if (hands.length >= 2 && params.mode === 'print') {
          (drawPrint || (drawPrint = createPrint()))(frame, ctx, hands, params);
        } else if (hands.length >= 2) {
          var pts = [hands[0][THUMB_TIP], hands[0][INDEX_TIP], hands[1][INDEX_TIP], hands[1][THUMB_TIP]];
          var cx = 0, cy = 0;
          pts.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
          pts.sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
          var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
          var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
          var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
          var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
          var bw = x1 - x0, bh = y1 - y0;
          if (bw > 2 && bh > 2) {
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
        else if (hands.length < 2) {
          Magi.tracking.hint(ctx, frame, params.mode === 'print'
            ? 'Hold a sheet: index fingers at its top corners, thumbs at the bottom.'
            : params.mode === 'code' ? 'Pinch with both hands to draw a box.'
            : 'Make an L with thumb and index finger on both hands.');
        }
      },
      reset: function () {}
    };
  }

  Magi.renderers['pinch-frame'] = createPinchFrame;
})();
