// Font: edit a letter in the air with one hand (its own tile in Hand Tracking).
//
// Glyph: the letter is drawn in a web font MAGI already loads (Face: Bodoni Moda, Inter,
// Silkscreen, VT323) on a hidden 256 px canvas, and its outline is traced with marching squares:
// each 2×2 block of pixels is classed by which corners are inside the letter (16 cases), and a
// segment joins the midpoints of the block edges the outline crosses; segments are chained into
// closed loops. Loops are resampled at an even spacing, so the outline is a string of evenly spaced
// points, drawn as small squares. Traced once per letter and face, then cached.
// Distortion: each point moves through a smooth displacement field, a sum of two sine waves per
// axis drifting slowly in time, by up to 18% of the glyph's size (Distortion).
// Smoothness: Taubin smoothing (1995), λ|μ: each pass moves a point toward the mean of two
// neighbors by λ = 0.5, then away by μ = −0.53, which rounds corners without shrinking the shape
// the way plain Laplacian smoothing does. Smoothness sets both the passes (0–30) and how far apart
// those neighbors are (1–13 points along the outline), so high values round at a large scale.
// Envelope: the points' convex hull (Andrew's monotone chain), pushed out 10% from the centroid and
// put through the same field at a lower frequency, smoothed, drawn as a thin closed curve.
// Dial: A–Z around a ring; the chosen letter sits at the top and the ring turns as it changes.
// Gestures (after the reference): which fingers touch the thumb picks what you adjust — index:
// the letter; index + middle: Distortion; all four: Smoothness. While they touch, turning your
// hand turns that value like a knob (letter: one per 15°; the others: one unit per degree), and the
// sliders move with it. The touching fingertips get white rings. The HUD reads what's adjusted
// and the values.
(function () {
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', SIZE = 256, STEP = 3.2;
  var FACES = [
    { name: 'Bodoni', family: 'Bodoni Moda', css: '400 200px "Bodoni Moda", Didot, Georgia, serif' },
    { name: 'Inter', family: 'Inter', css: '400 200px Inter, Helvetica, Arial, sans-serif' },
    { name: 'Silkscreen', family: 'Silkscreen', css: '400 180px Silkscreen, monospace' },
    { name: 'VT323', family: 'VT323', css: '400 230px VT323, monospace' }
  ];
  var cache = {};

  // Marching squares over the glyph's coverage; returns closed loops of [x, y] in pixels.
  function trace(ch, face) {
    var c = document.createElement('canvas');
    c.width = c.height = SIZE;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.font = face.css;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(ch, SIZE / 2, SIZE / 2);
    var d = g.getImageData(0, 0, SIZE, SIZE).data;
    var on = function (x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE && d[(y * SIZE + x) * 4 + 3] > 127 ? 1 : 0; };
    // Edge keys: 'h' + x,y is the edge from (x,y) to (x+1,y); 'v' + x,y from (x,y) to (x,y+1).
    var adj = {}, pt = {};
    function link(a, b) { (adj[a] || (adj[a] = [])).push(b); (adj[b] || (adj[b] = [])).push(a); }
    for (var y = -1; y < SIZE; y++) {
      for (var x = -1; x < SIZE; x++) {
        var k = on(x, y) * 8 + on(x + 1, y) * 4 + on(x + 1, y + 1) * 2 + on(x, y + 1);
        if (k === 0 || k === 15) continue;
        var T = 'h' + x + ',' + y, R = 'v' + (x + 1) + ',' + y, B = 'h' + x + ',' + (y + 1), L = 'v' + x + ',' + y;
        pt[T] = [x + 0.5, y]; pt[R] = [x + 1, y + 0.5]; pt[B] = [x + 0.5, y + 1]; pt[L] = [x, y + 0.5];
        var segs = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
          8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] }[k];
        segs.forEach(function (s) { link(s[0], s[1]); });
      }
    }
    var seen = {}, loops = [];
    Object.keys(adj).forEach(function (start) {
      if (seen[start]) return;
      var loop = [], cur = start, prev = null;
      while (cur && !seen[cur]) {
        seen[cur] = true;
        loop.push(pt[cur]);
        var nb = adj[cur], next = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = next;
      }
      if (loop.length > 8) loops.push(resample(loop, STEP));
    });
    return loops;
  }

  function resample(loop, step) {
    var out = [], acc = 0, n = loop.length;
    out.push(loop[0].slice());
    for (var i = 0; i < n; i++) {
      var a = loop[i], b = loop[(i + 1) % n], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + seg >= step) {
        var k = (step - acc) / seg;
        a = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        out.push(a.slice());
        seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc = 0;
      }
      acc += seg;
    }
    return out;
  }

  function taubin(loop, passes, span) {
    span = span || 1;
    var p = loop.map(function (q) { return q.slice(); }), n = p.length, tmp = new Array(n);
    if (n < 3) return p;
    span = Math.min(span, Math.floor((n - 1) / 2));
    for (var it = 0; it < passes * 2; it++) {
      var f = it % 2 ? -0.53 : 0.5;
      for (var i = 0; i < n; i++) {
        var a = p[(i + n - span) % n], b = p[(i + span) % n];
        tmp[i] = [p[i][0] + f * ((a[0] + b[0]) / 2 - p[i][0]), p[i][1] + f * ((a[1] + b[1]) / 2 - p[i][1])];
      }
      for (i = 0; i < n; i++) p[i] = tmp[i];
    }
    return p;
  }

  function field(x, y, t, freq) {
    return [Math.sin(y * 0.031 * freq + t * 0.6) * 0.6 + Math.sin(x * 0.019 * freq - t * 0.45 + 1.3) * 0.4,
      Math.sin(x * 0.027 * freq - t * 0.5 + 2.1) * 0.6 + Math.sin(y * 0.022 * freq + t * 0.35 + 0.7) * 0.4];
  }

  function hull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    p.forEach(function (q) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    p.slice().reverse().forEach(function (q) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); });
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  Magi.fontEditor = function () {
    var shown = null, mode = 'character', grab = null;
    return function (ctx, frame, ix, u, params) {
      var W = frame.width, H = frame.height, t = frame.time / 1000, hud = frame.hud;
      var face = FACES[Math.max(0, Math.min(3, Math.round(params.face || 0)))];
      Magi.fx.fontReady(face.family);
      var letter = Math.max(0, Math.min(25, Math.round(params.letter || 0)));
      var key = face.name + ':' + letter;
      if (!cache[key] && Magi.fx.fontReady(face.family)) cache[key] = trace(LETTERS[letter], face);
      var loops = cache[key] || [];
      if (shown === null) shown = letter;
      shown += (letter - shown) * 0.2;

      // Gestures: the fingers touching the thumb choose the control; turning the hand turns it.
      var hd = ix.hands[0], active = null;
      if (hd) {
        var pw = hd.pinchWith;
        if (pw.index.on && pw.middle.on && pw.ring.on && pw.pinky.on) active = 'smoothness';
        else if (pw.index.on && pw.middle.on) active = 'distortion';
        else if (pw.index.on) active = 'character';
      }
      if (active) {
        mode = active;
        if (!grab || grab.what !== active) grab = { what: active, r: hd.rotation, v: active === 'character' ? letter : params[active] };
        var turn = hd.rotation - grab.r;
        if (active === 'character') {
          var nl = ((Math.round(grab.v + turn / 15) % 26) + 26) % 26;
          if (nl !== letter) frame.setParam('letter', nl);
        } else {
          var nv = Math.max(0, Math.min(100, Math.round(grab.v + turn)));
          if (nv !== params[active]) frame.setParam(active, nv);
        }
      } else grab = null;

      // Layout: the glyph on the left half, scaled to 62% of the frame height.
      var cx = W * 0.32, cy = H * 0.5, sc = H * 0.62 / SIZE, R = H * 0.38;
      var D = (params.distortion / 100) * 0.18 * SIZE, sm = params.smoothness / 100, passes = Math.round(sm * 30), span = 1 + Math.round(sm * 12);
      var shaped = loops.map(function (lp) {
        var moved = lp.map(function (q) { var f = field(q[0], q[1], t, 1); return [q[0] + f[0] * D, q[1] + f[1] * D]; });
        return taubin(moved, passes, span).map(function (q) { return [cx + (q[0] - SIZE / 2) * sc, cy + (q[1] - SIZE / 2) * sc]; });
      });

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, 0.8 * u);
      // Crosshair and envelope.
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      var all = [].concat.apply([], shaped);
      if (all.length > 3) {
        var hl = hull(all), mx = 0, my = 0;
        hl.forEach(function (q) { mx += q[0] / hl.length; my += q[1] / hl.length; });
        var env = resample(hl.map(function (q) { return [mx + (q[0] - mx) * 1.1, my + (q[1] - my) * 1.1]; }).concat([]), 6 * u);
        env = taubin(env.map(function (q) { var f = field(q[0], q[1], t * 0.6, 0.5); return [q[0] + f[0] * D * sc * 1.4, q[1] + f[1] * D * sc * 1.4]; }), 6);
        ctx.beginPath();
        env.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
        ctx.closePath();
        ctx.stroke();
      }
      // Glyph: thin outline with a small square at every point.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      shaped.forEach(function (lp) { lp.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); });
      ctx.stroke();
      ctx.globalAlpha = 1;
      var sq = Math.max(2, 2.6 * u);
      ctx.beginPath();
      shaped.forEach(function (lp) { for (var i = 0; i < lp.length; i += 2) ctx.rect(lp[i][0] - sq / 2, lp[i][1] - sq / 2, sq, sq); });
      ctx.stroke();
      // Fingertip rings on the thumb and the fingers touching it.
      if (hd) {
        var tips = [4].concat(active === 'smoothness' ? [8, 12, 16, 20] : active === 'distortion' ? [8, 12] : active ? [8] : []);
        ctx.lineWidth = Math.max(1, 1.4 * u);
        ctx.beginPath();
        tips.forEach(function (k) { var q = hd.points[k]; ctx.moveTo(q.x + 9 * u, q.y); ctx.arc(q.x, q.y, 9 * u, 0, Math.PI * 2); });
        ctx.stroke();
      }
      ctx.restore();

      // Dial letters, tick marks and readouts on the HUD.
      hud.save();
      hud.fillStyle = 'rgba(255,255,255,0.85)';
      hud.strokeStyle = 'rgba(255,255,255,0.6)';
      hud.lineWidth = Math.max(1, 0.8 * u);
      hud.textAlign = 'center';
      hud.textBaseline = 'middle';
      hud.font = '500 ' + Math.round(9 * u) + 'px ' + Magi.fx.MONO;
      hud.beginPath();
      for (var k = 0; k < 26; k++) {
        var a = -Math.PI / 2 + (k - shown) * Math.PI * 2 / 26;
        hud.fillText(LETTERS[k], cx + Math.cos(a) * R * 1.08, cy + Math.sin(a) * R * 1.08);
        var a2 = a + Math.PI / 26;
        hud.moveTo(cx + Math.cos(a2) * R * 1.02, cy + Math.sin(a2) * R * 1.02);
        hud.lineTo(cx + Math.cos(a2) * R * 1.06, cy + Math.sin(a2) * R * 1.06);
      }
      hud.stroke();
      hud.textAlign = 'left';
      hud.textBaseline = 'alphabetic';
      hud.font = '500 ' + Math.round(10 * u) + 'px ' + Magi.fx.MONO;
      hud.fillStyle = '#fff';
      hud.fillText('ADJUSTING: ' + mode.toUpperCase(), W * 0.03, H * 0.95);
      var lines = ['CHARACTER:  ' + LETTERS[letter], 'DISTORTION: ' + (+params.distortion).toFixed(2), 'SMOOTHNESS: ' + (+params.smoothness).toFixed(2)];
      lines.forEach(function (l, i) { hud.fillText(l, W * 0.74, H * 0.5 + i * 14 * u); });
      hud.restore();
      if (!loops.length) frame.say('Loading the typeface…');
    };
  };

  // The tile: the room darkened behind the letter; no skeleton, only the fingertip rings.
  Magi.renderers.font = function () {
    var editor = Magi.fontEditor();
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        editor(ctx, frame, Magi.interaction.read(frame), frame.pxPerCss, params);
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
      },
      reset: function () {}
    };
  };
})();
