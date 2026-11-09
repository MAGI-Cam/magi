// Media effects: your uploaded images (Magi.media, session only) composed into moving posts, after
// a set of image-motion tool references. Upload with the toolbar's Add images button; until you do,
// they run on snapshots of the camera. Save with the shutter as usual.
// Shared: Format (0 the source's shape, 1 4:5, 2 9:16, 3 1:1, sized for posts), Dark (black
// instead of white), Grayscale, Density (copies of each image), Size, Speed.
//
// Drift — thumbnails, each captioned with its file name, pop in at random places, wander on a
//   smooth flow and fade, like a desktop filling with screenshots. Each tile lives on its own cycle
//   (4–9 s ÷ Speed, random phase) and comes back somewhere new every cycle (positions from a hash of
//   the tile and the cycle number). It pops in with an overshooting ease (back-out) and drifts on
//   the flow u = A·(sin(0.7t + φ), cos(0.5t + 1.3φ)). Intensity: how many are showing at once and
//   how far they wander. Captions: the file names.
// Crossing — every image a card on its own orbit around the center: an ellipse (semi-major axis a,
//   minor b = a·(0.35–1)) tilted by a random inclination and node, so the paths cross in 3D. Cards
//   go round by Kepler's third law, angular speed ω ∝ a^(−3/2), inner ones faster; drawn in
//   perspective, far to near, the whole cluster turning slowly.
// Anatomy — small square tiles (center-cropped) travel along a pattern on the poster like goods on
//   conveyor lines: Pattern 0 a diamond lattice (lines at ±45°), 1 a grid, 2 waves. Tiles ride
//   their line at Speed and wrap round; Density sets how close they follow each other.
// Cube — image cubes (each a small cube showing an image on every visible face, sides shaded) that
//   move between a loose scatter, a tight 3 × 3 × 3 cube and an open 5 × 5 × 5 lattice, holding each
//   for Hold seconds and morphing (smoothstep, 1.2 s), turning slowly. The same cubes are a
//   Landmarks mode driven by your hands (see landmark-modes.js).
(function () {
  function hash(a, b) { var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); }
  function backOut(k) { var c = 1.7; k = Math.max(0, Math.min(1, k)) - 1; return 1 + (c + 1) * k * k * k + c * k * k; }
  function pic(it, gray) { return gray ? Magi.media.gray(it) : it.img; }
  function bg(ctx, W, H, dark) { ctx.fillStyle = dark ? '#000' : '#f4f3f1'; ctx.fillRect(0, 0, W, H); }
  // Center-cropped square source rectangle of an image.
  function square(it) { var s = Math.min(it.w, it.h); return [(it.w - s) / 2, (it.h - s) / 2, s, s]; }
  function waitSay(frame) { if (!Magi.media.items.length) frame.say(Magi.media.loading ? 'Loading your images…' : 'Add images with the upload button (any number at once). Showing the camera until then.'); }

  // Drift
  Magi.renderers['media-drift'] = function () {
    return {
      animated: true,
      render: function (frame, out, params) {
        var S = Magi.media.size(out, frame, params.format), W = S[0], H = S[1], t = frame.time / 1000, ctx = out.getContext('2d'), hud = frame.hud;
        bg(ctx, W, H, params.dark);
        var items = Magi.media.list(frame);
        if (!items.length) return waitSay(frame);
        var n = Math.min(260, items.length * Math.round(params.density)), sp = 0.25 + params.speed / 100 * 1.75, inten = params.intensity / 100;
        var tw = W * (0.04 + params.size / 100 * 0.16), k = W / 1080, shown = [];
        for (var i = 0; i < n; i++) {
          var period = (4 + 5 * hash(i, 1)) / sp, ph = hash(i, 2) * period, tt = t + ph, cyc = Math.floor(tt / period), f = (tt - cyc * period) / period;
          // Showing for a share of each cycle that grows with Intensity.
          var on = 0.25 + 0.6 * inten;
          if (f > on) continue;
          var it = items[i % items.length], x0 = W * (0.08 + 0.84 * hash(i, cyc + 3)), y0 = H * (0.08 + 0.78 * hash(i + 0.5, cyc + 7));
          var A = W * 0.03 * inten, x = x0 + A * Math.sin(0.7 * t + i), y = y0 + A * Math.cos(0.5 * t + 1.3 * i);
          var s = backOut(f / 0.06) * (f > on - 0.05 ? (on - f) / 0.05 : 1), w = tw * (0.7 + 0.6 * hash(i, 9)), h = w * it.h / it.w;
          shown.push({ it: it, x: x, y: y, w: w * s, h: h * s, a: s, born: cyc * period - ph + 0.0001 * i });
        }
        shown.sort(function (a, b) { return a.born - b.born; });
        ctx.save();
        shown.forEach(function (q) { ctx.globalAlpha = Math.max(0, Math.min(1, q.a)); ctx.drawImage(pic(q.it, params.gray), q.x - q.w / 2, q.y - q.h / 2, q.w, q.h); });
        ctx.restore();
        if (params.captions) {
          hud.save(); hud.fillStyle = params.dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)'; hud.font = '400 ' + Math.max(10, Math.round(20 * k)) + 'px Inter, sans-serif'; hud.textAlign = 'center'; hud.textBaseline = 'top';
          shown.forEach(function (q) { if (q.a < 0.6) return; var nm = q.it.name.length > 34 ? q.it.name.slice(0, 31) + '…' : q.it.name; hud.globalAlpha = Math.min(1, q.a); hud.fillText(nm, q.x, q.y + q.h / 2 + 5 * k); });
          hud.restore();
        }
        waitSay(frame);
      },
      reset: function () {}
    };
  };

  // Crossing
  Magi.renderers['media-crossing'] = function () {
    var yaw = 0, lastT = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var S = Magi.media.size(out, frame, params.format), W = S[0], H = S[1], t = frame.time / 1000, ctx = out.getContext('2d');
        var dt = lastT === null ? 1 / 60 : Math.min(0.1, t - lastT); lastT = t;
        bg(ctx, W, H, params.dark);
        var items = Magi.media.list(frame);
        if (!items.length) return waitSay(frame);
        var n = Math.min(400, items.length * Math.round(params.density)), sp = params.speed / 100 * 1.2 + 0.05, R = Math.min(W, H) * 0.42, F = 3;
        yaw += dt * 0.15 * sp;
        var cy = Math.cos(yaw), sy = Math.sin(yaw), cards = [];
        for (var i = 0; i < n; i++) {
          var a = 0.25 + 0.75 * Math.sqrt(hash(i, 1)), b = a * (0.35 + 0.65 * hash(i, 2)), inc = (hash(i, 3) - 0.5) * Math.PI, node = hash(i, 4) * Math.PI * 2;
          // Kepler's third law: ω ∝ a^(−3/2).
          var th = hash(i, 5) * Math.PI * 2 + t * sp * 0.6 * Math.pow(a, -1.5);
          var x = a * Math.cos(th), y = b * Math.sin(th), z = 0;
          var y1 = y * Math.cos(inc), z1 = y * Math.sin(inc);
          var x2 = x * Math.cos(node) - y1 * Math.sin(node), y2 = x * Math.sin(node) + y1 * Math.cos(node);
          var x3 = x2 * cy + z1 * sy, z3 = -x2 * sy + z1 * cy, kp = F / (F + z3);
          cards.push({ it: items[i % items.length], x: W / 2 + x3 * R * kp, y: H / 2 + y2 * R * kp, k: kp, z: z3 });
        }
        cards.sort(function (p, q) { return q.z - p.z; });
        var base = Math.min(W, H) * (0.04 + params.size / 100 * 0.12);
        cards.forEach(function (c) {
          var w = base * c.k, h = w * c.it.h / c.it.w;
          ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * c.k);
          ctx.drawImage(pic(c.it, params.gray), c.x - w / 2, c.y - h / 2, w, h);
        });
        ctx.globalAlpha = 1;
        waitSay(frame);
      },
      reset: function () { lastT = null; }
    };
  };

  // Anatomy
  Magi.renderers['media-anatomy'] = function () {
    return {
      animated: true,
      render: function (frame, out, params) {
        var S = Magi.media.size(out, frame, params.format), W = S[0], H = S[1], t = frame.time / 1000, ctx = out.getContext('2d');
        bg(ctx, W, H, params.dark);
        var items = Magi.media.list(frame);
        if (!items.length) return waitSay(frame);
        var m = Math.min(W, H) * 0.08, x0 = m, y0 = m, iw = W - 2 * m, ih = H - 2 * m;
        var cell = Math.min(W, H) * (0.12 + (100 - params.size) / 100 * 0.1), ts = Math.min(W, H) * (0.012 + params.size / 100 * 0.04);
        var gap = ts * (1.2 + (100 - params.density * 100 / 44) / 100 * 3), v = (params.speed / 100) * Math.min(W, H) * 0.08, pat = Math.round(params.pattern);
        var lines = [];
        if (pat === 1) {
          for (var gx = x0; gx <= x0 + iw + 0.5; gx += cell) lines.push({ p: function (s, g) { return [g, y0 + s]; }.bind(null), g: gx, L: ih, dir: 1 });
          for (var gy = y0; gy <= y0 + ih + 0.5; gy += cell) lines.push({ p: function (s, g) { return [x0 + s, g]; }, g: gy, L: iw, dir: -1 });
        } else if (pat === 2) {
          for (var wy = y0; wy <= y0 + ih + 0.5; wy += cell * 0.7) lines.push({ p: function (s, g) { return [x0 + s, g + Math.sin(s / cell * 1.4 + g) * cell * 0.25]; }, g: wy, L: iw, dir: Math.round(wy / cell) % 2 ? 1 : -1 });
        } else {
          // Diamond lattice: lines at +45° and −45°, clipped to the poster's inner rectangle.
          var span = iw + ih;
          for (var c = -ih; c <= iw + 0.5; c += cell) {
            lines.push({ p: function (s, g) { return [x0 + g + s / Math.SQRT2, y0 + s / Math.SQRT2]; }, g: c, L: span * Math.SQRT2, dir: 1 });
            lines.push({ p: function (s, g) { return [x0 + g + ih - s / Math.SQRT2, y0 + s / Math.SQRT2]; }, g: c, L: span * Math.SQRT2, dir: -1 });
          }
        }
        var k = 0;
        lines.forEach(function (ln, li) {
          var off = ((t * v * ln.dir) % gap + gap) % gap;
          for (var s = off; s < ln.L; s += gap, k++) {
            var q = ln.p(s, ln.g);
            if (q[0] < x0 - 1 || q[0] > x0 + iw + 1 || q[1] < y0 - 1 || q[1] > y0 + ih + 1) continue;
            var it = items[(li * 7 + Math.floor((s - off) / gap)) % items.length], sq = square(it);
            ctx.drawImage(pic(it, params.gray), sq[0], sq[1], sq[2], sq[3], q[0] - ts / 2, q[1] - ts / 2, ts, ts);
          }
        });
        waitSay(frame);
      },
      reset: function () {}
    };
  };

  // Cubes, shared with the Landmarks Cube mode. cubes(ctx, W, H, items, o): o.spread 0 (tight cube)
  // to 1 (open lattice), o.scatter 0–1, o.n grid side, o.yaw, o.pitch, o.roll, o.size (cube edge in
  // px), o.cx, o.cy, o.gray. Each cube's visible faces (normal toward the viewer) are drawn as
  // parallelograms (an affine map of a center-cropped square image), shaded by how far they turn
  // away; cubes are drawn far to near.
  Magi.mediaCubes = function (ctx, W, H, items, o) {
    var n = o.n, half = (n - 1) / 2, e = o.size, gap = e * (1.08 + o.spread * 2.4), F = Math.min(W, H) * 2.2;
    var cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch), cr = Math.cos(o.roll || 0), sr = Math.sin(o.roll || 0);
    function rot(v) {
      var x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy, y = v[1] * cp - z * sp, z2 = v[1] * sp + z * cp;
      return [x * cr - y * sr, x * sr + y * cr, z2];
    }
    function proj(v) { var k = F / (F + v[2]); return [o.cx + v[0] * k, o.cy + v[1] * k, v[2]]; }
    var FACES = [[[0, 0, -1], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[-1, 0, 0], [0, 0, -1], [0, 1, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]]];
    var list = [], idx = 0;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) for (var k = 0; k < n; k++, idx++) {
      var p = [(i - half) * gap, (j - half) * gap, (k - half) * gap];
      if (o.scatter > 0) { var sc = o.scatter * Math.min(W, H) * 0.5; p = [p[0] * (1 - o.scatter) + (hash(idx, 1) - 0.5) * 2 * sc, p[1] * (1 - o.scatter) + (hash(idx, 2) - 0.5) * 2 * sc, p[2] * (1 - o.scatter) + (hash(idx, 3) - 0.5) * 2 * sc]; }
      var c = rot(p);
      list.push({ c: c, it: items[idx % items.length], idx: idx });
    }
    list.sort(function (a, b) { return b.c[2] - a.c[2]; });
    var h = e / 2;
    list.forEach(function (q) {
      var im = o.gray ? Magi.media.gray(q.it) : q.it.img, sq = square(q.it);
      FACES.forEach(function (f) {
        var nrm = rot(f[0]);
        if (nrm[2] > -0.02) return; // facing away
        var u = rot(f[1]), v = rot(f[2]);
        var o0 = [q.c[0] + nrm[0] * h - u[0] * h - v[0] * h, q.c[1] + nrm[1] * h - u[1] * h - v[1] * h, q.c[2] + nrm[2] * h - u[2] * h - v[2] * h];
        var A = proj(o0), B = proj([o0[0] + u[0] * e, o0[1] + u[1] * e, o0[2] + u[2] * e]), C = proj([o0[0] + v[0] * e, o0[1] + v[1] * e, o0[2] + v[2] * e]);
        ctx.save();
        ctx.setTransform((B[0] - A[0]) / sq[2], (B[1] - A[1]) / sq[2], (C[0] - A[0]) / sq[3], (C[1] - A[1]) / sq[3], A[0], A[1]);
        ctx.drawImage(im, sq[0], sq[1], sq[2], sq[3], 0, 0, sq[2], sq[3]);
        var shade = 1 + nrm[2];
        if (shade > 0.02) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.7, shade * 0.9).toFixed(3) + ')'; ctx.fillRect(0, 0, sq[2], sq[3]); }
        ctx.restore();
      });
    });
  };

  // Cube (Media): scatter → cube → lattice, on its own.
  Magi.renderers['media-cube'] = function () {
    var yaw = 0.6, lastT = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var S = Magi.media.size(out, frame, params.format), W = S[0], H = S[1], t = frame.time / 1000, ctx = out.getContext('2d');
        var dt = lastT === null ? 1 / 60 : Math.min(0.1, t - lastT); lastT = t;
        bg(ctx, W, H, params.dark);
        var items = Magi.media.list(frame);
        if (!items.length) return waitSay(frame);
        var hold = 1.5 + params.hold / 100 * 4, cycle = (hold + 1.2) * 3, ph = t % cycle, st = Math.floor(ph / (hold + 1.2)), into = ph - st * (hold + 1.2);
        var g = into < 1.2 ? (function (x) { return x * x * (3 - 2 * x); })(into / 1.2) : 1;
        // States: 0 scatter, 1 cube (3³), 2 lattice (5³). Morph from the previous state.
        var STATES = [{ n: 4, spread: 0.6, scatter: 1 }, { n: 3, spread: 0, scatter: 0 }, { n: 5, spread: 1, scatter: 0 }];
        var A = STATES[(st + 2) % 3], B = STATES[st], n = g < 0.5 ? A.n : B.n;
        yaw += dt * (0.1 + params.speed / 100 * 0.8);
        var edge = Math.min(W, H) * (0.03 + params.size / 100 * 0.07) * (n === 5 ? 0.75 : 1);
        Magi.mediaCubes(ctx, W, H, items, { n: n, spread: A.spread + (B.spread - A.spread) * g, scatter: A.scatter + (B.scatter - A.scatter) * g, yaw: yaw, pitch: -0.45, roll: 0, size: edge, cx: W / 2, cy: H / 2, gray: params.gray });
        waitSay(frame);
      },
      reset: function () { lastT = null; }
    };
  };
})();
