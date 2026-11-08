// Font: a gestural font editor (after the reference "i made a gestural font editor": pinch-rotate
// like a knob that switches modes). One letter is held in a dial; your hand grips it like a knob.
//
// Glyph: the letter is drawn in a web font MAGI loads (Face: Literata, the default, a sturdy serif
// with wedge serifs like the reference's; Bodoni Moda, Inter, Silkscreen, VT323) on a hidden
// 256 px canvas, and its outline is traced with marching squares: each 2×2 block of pixels is
// classed by which corners are inside the letter (16 cases), a segment joins the midpoints of the
// block edges the outline crosses, and segments chain into closed loops. Loops are resampled at an
// even spacing and drawn as a thin line with a small square at every other point. Cached per
// letter and face.
// Envelope: the letter grown outward (its shape stroked with a pen 11% of the canvas wide), its
// outer contour traced the same way and simplified with Douglas–Peucker (tolerance 2.5% of the
// canvas), so at rest it is a straight-edged polygon that follows the letter at a distance.
// Distortion: every point moves through a smooth displacement field, two octaves of sine waves per
// axis drifting in time, by up to 14% of the letter's size; the envelope moves with a lower octave.
// Smoothness: Taubin smoothing (1995): each pass moves a point toward the mean of two neighbors by
// λ = 0.5, then away by μ = −0.53, which rounds corners without shrinking the shape the way plain
// Laplacian smoothing does. Smoothness sets the passes (0–30) and how far apart those neighbors
// are (1–13 points), so high values melt the letter into a blob; the envelope turns smooth too.
// Gestures (the reference's grips): the fingers you hold out pick the control, as if gripping a
// knob with them — thumb and index (an L): the letter; thumb, index and middle: Distortion; all
// five: Smoothness. The grip must hold for 0.15 s. Then turning it turns the value like a knob
// (the angle of the thumb-to-index line, unwrapped) (letter: one per 12°; Distortion and Smoothness: one unit per degree), the dial turns, and
// the sliders move with it. Rings mark the gripping fingertips. The HUD reads the control being
// adjusted and the three values.
(function () {
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', SIZE = 256, STEP = 3.2;
  var FACES = [
    { name: 'Literata', family: 'Literata', css: '500 140px Literata, Georgia, serif' },
    { name: 'Bodoni', family: 'Bodoni Moda', css: '400 145px "Bodoni Moda", Didot, Georgia, serif' },
    { name: 'Inter', family: 'Inter', css: '400 145px Inter, Helvetica, Arial, sans-serif' },
    { name: 'Silkscreen', family: 'Silkscreen', css: '400 120px Silkscreen, monospace' },
    { name: 'VT323', family: 'VT323', css: '400 170px VT323, monospace' }
  ];
  var GRIPS = { character: [4, 8], distortion: [4, 8, 12], smoothness: [4, 8, 12, 16, 20] };
  var cache = {};

  function draw(ch, face, pen) {
    var c = document.createElement('canvas');
    c.width = c.height = SIZE;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.font = face.css;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = g.strokeStyle = '#fff';
    g.lineJoin = 'round';
    g.fillText(ch, SIZE / 2, SIZE / 2);
    if (pen) { g.lineWidth = pen; g.strokeText(ch, SIZE / 2, SIZE / 2); }
    return g.getImageData(0, 0, SIZE, SIZE).data;
  }

  // Marching squares over coverage `d`; returns closed loops of [x, y].
  function trace(d) {
    var on = function (x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE && d[(y * SIZE + x) * 4 + 3] > 127 ? 1 : 0; };
    var adj = {}, pt = {};
    function link(a, b) { (adj[a] || (adj[a] = [])).push(b); (adj[b] || (adj[b] = [])).push(a); }
    for (var y = -1; y < SIZE; y++) {
      for (var x = -1; x < SIZE; x++) {
        var k = on(x, y) * 8 + on(x + 1, y) * 4 + on(x + 1, y + 1) * 2 + on(x, y + 1);
        if (k === 0 || k === 15) continue;
        var T = 'h' + x + ',' + y, R = 'v' + (x + 1) + ',' + y, B = 'h' + x + ',' + (y + 1), L = 'v' + x + ',' + y;
        pt[T] = [x + 0.5, y]; pt[R] = [x + 1, y + 0.5]; pt[B] = [x + 0.5, y + 1]; pt[L] = [x, y + 0.5];
        ({ 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
          8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] })[k]
          .forEach(function (s) { link(s[0], s[1]); });
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
      if (loop.length > 8) loops.push(loop);
    });
    return loops;
  }

  function resample(loop, step) {
    var out = [loop[0].slice()], acc = 0, n = loop.length;
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

  // Douglas–Peucker on a closed loop: keep the points farther than eps from the chord.
  function simplify(loop, eps) {
    function dp(pts) {
      if (pts.length < 3) return pts;
      var a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-6, best = -1, bd = 0;
      for (var i = 1; i < pts.length - 1; i++) {
        var d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
        if (d > bd) { bd = d; best = i; }
      }
      if (bd <= eps) return [a, b];
      return dp(pts.slice(0, best + 1)).slice(0, -1).concat(dp(pts.slice(best)));
    }
    var far = 0, fd = 0;
    loop.forEach(function (q, i) { var d = Math.hypot(q[0] - loop[0][0], q[1] - loop[0][1]); if (d > fd) { fd = d; far = i; } });
    return dp(loop.slice(0, far + 1)).slice(0, -1).concat(dp(loop.slice(far).concat([loop[0]])).slice(0, -1));
  }

  function taubin(loop, passes, span) {
    var p = loop.map(function (q) { return q.slice(); }), n = p.length, tmp = new Array(n);
    if (n < 3 || !passes) return p;
    span = Math.max(1, Math.min(span || 1, Math.floor((n - 1) / 2)));
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

  function field(x, y, t, f) {
    return [0.65 * Math.sin(y * 0.045 * f + t * 0.7) + 0.35 * Math.sin(x * 0.11 * f - t * 0.9 + 1.3),
      0.65 * Math.sin(x * 0.04 * f - t * 0.6 + 2.1) + 0.35 * Math.sin(y * 0.12 * f + t * 0.8 + 0.7)];
  }

  function glyph(letter, face) {
    var key = face.name + ':' + letter;
    if (cache[key]) return cache[key];
    var loops = trace(draw(LETTERS[letter], face)).map(function (lp) { return resample(lp, STEP); });
    var grown = trace(draw(LETTERS[letter], face, SIZE * 0.11)), outer = grown.sort(function (a, b) { return b.length - a.length; })[0] || [];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    loops.forEach(function (lp) { lp.forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }); });
    return (cache[key] = { loops: loops, env: outer.length ? simplify(outer, SIZE * 0.025) : [], box: [x0, y0, x1, y1] });
  }

  Magi.fontEditor = function () {
    var shown = null, mode = 'character', grab = null, cand = null, candSince = 0, vals = null;
    return function (ctx, frame, ix, u, params) {
      var W = frame.width, H = frame.height, t = frame.time / 1000, hud = frame.hud;
      var face = FACES[Math.max(0, Math.min(FACES.length - 1, Math.round(params.face || 0)))];
      Magi.fx.fontReady(face.family);
      // Values kept with decimals here; the sliders get them rounded. A slider moved by hand wins.
      if (!vals) vals = { letter: params.letter, distortion: params.distortion, smoothness: params.smoothness };
      ['letter', 'distortion', 'smoothness'].forEach(function (k) {
        var mine = k === 'letter' ? ((Math.round(vals[k]) % 26) + 26) % 26 : Math.round(vals[k]);
        if (mine !== params[k]) vals[k] = params[k];
      });
      var letter = ((Math.round(vals.letter) % 26) + 26) % 26;
      var G = Magi.fx.fontReady(face.family) ? glyph(letter, face) : null;
      if (shown === null) shown = letter;
      var dl = letter - shown; dl -= Math.round(dl / 26) * 26; shown += dl * 0.2;

      // Grips: which fingers are held out picks the control; held 0.15 s, then turning turns it.
      var hd = ix.hands[0], grip = null;
      if (hd) {
        var f = hd.fingers, out = function (n) { return f[n].extended; };
        if (out('thumb') && out('index') && out('middle') && out('ring') && out('pinky')) grip = 'smoothness';
        else if (out('thumb') && out('index') && out('middle') && !out('ring') && !out('pinky')) grip = 'distortion';
        else if (out('thumb') && out('index') && !out('middle') && !out('ring') && !out('pinky')) grip = 'character';
      }
      if (grip !== cand) { cand = grip; candSince = t; }
      var active = cand && t - candSince > 0.15 ? cand : null;
      if (active) {
        mode = active;
        var key = active === 'character' ? 'letter' : active;
        // The knob's angle: the thumb-to-index line (it twists as you turn the grip), unwrapped.
        var pp = hd.points, ang = Math.atan2(pp[8].y - pp[4].y, pp[8].x - pp[4].x) * 180 / Math.PI;
        if (!grab || grab.what !== active) grab = { what: active, last: ang, acc: 0, v: vals[key] };
        var dA = ang - grab.last; dA -= Math.round(dA / 360) * 360; grab.acc += dA; grab.last = ang;
        var turn = grab.acc;
        if (active === 'character') vals.letter = grab.v + turn / 12;
        else vals[key] = Math.max(0, Math.min(100, grab.v + turn));
        var rounded = active === 'character' ? ((Math.round(vals.letter) % 26) + 26) % 26 : Math.round(vals[key]);
        if (rounded !== params[key]) frame.setParam(key, rounded);
      } else grab = null;

      // Layout: the dial on the left; the letter nearly fills it.
      var R = H * 0.3, cx = Math.max(R * 1.25, W * 0.24), cy = H * 0.46;
      var D = vals.distortion / 100 * 0.14 * SIZE, sm = vals.smoothness / 100, passes = Math.round(sm * 30), span = 1 + Math.round(sm * 12);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1, 0.8 * u);
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R * 1.05);
      ctx.stroke();
      if (G) {
        var bw = G.box[2] - G.box[0], bh = G.box[3] - G.box[1], sc = (R * 1.7) / Math.max(bw, bh);
        var gx = (G.box[0] + G.box[2]) / 2, gy = (G.box[1] + G.box[3]) / 2;
        var place = function (q) { return [cx + (q[0] - gx) * sc, cy + (q[1] - gy) * sc]; };
        var move = function (q, k) { var fv = field(q[0], q[1], t, k); return [q[0] + fv[0] * D, q[1] + fv[1] * D]; };
        // Envelope: straight-edged at rest; wavy with Distortion; smooth with Smoothness.
        var env = G.env;
        if (env.length > 2) {
          if (D > 0 || sm > 0) env = taubin(resample(env.concat([env[0]]), 4).map(function (q) { return move(q, 0.4); }), Math.round(passes * 0.6) + (D > 0 ? 3 : 0), span + 2);
          ctx.beginPath();
          env.map(place).forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
          ctx.closePath();
          ctx.stroke();
        }
        // Letter: thin outline, small squares on every other point.
        var shaped = G.loops.map(function (lp) { return taubin(lp.map(function (q) { return move(q, 1); }), passes, span).map(place); });
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        shaped.forEach(function (lp) { lp.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); });
        ctx.stroke();
        ctx.globalAlpha = 1;
        var sq = Math.max(2, 2.8 * u);
        ctx.beginPath();
        shaped.forEach(function (lp) { for (var i = 0; i < lp.length; i += 2) ctx.rect(lp[i][0] - sq / 2, lp[i][1] - sq / 2, sq, sq); });
        ctx.stroke();
      }
      // Rings on the gripping fingertips.
      if (hd && grip) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(1, 1.6 * u);
        ctx.beginPath();
        GRIPS[grip].forEach(function (k) { var q = hd.points[k]; ctx.moveTo(q.x + 10 * u, q.y); ctx.arc(q.x, q.y, 10 * u, 0, Math.PI * 2); });
        ctx.stroke();
      }
      ctx.restore();

      // Dial letters, then the readouts, on the HUD.
      hud.save();
      hud.fillStyle = 'rgba(255,255,255,0.9)';
      hud.textAlign = 'center';
      hud.textBaseline = 'middle';
      hud.font = '500 ' + Math.round(8.5 * u) + 'px ' + Magi.fx.MONO;
      for (var k2 = 0; k2 < 26; k2++) {
        var a = -Math.PI / 2 + (k2 - shown) * Math.PI * 2 / 26;
        hud.fillText(LETTERS[k2], cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12);
      }
      if ('letterSpacing' in hud) hud.letterSpacing = Math.round(2 * u) + 'px';
      hud.textAlign = 'left';
      hud.textBaseline = 'alphabetic';
      hud.font = '500 ' + Math.round(13 * u) + 'px ' + Magi.fx.MONO;
      hud.fillText('ADJUSTING: ' + mode.toUpperCase(), W * 0.03, H * 0.93);
      if ('letterSpacing' in hud) hud.letterSpacing = Math.round(1 * u) + 'px';
      hud.font = '500 ' + Math.round(7.5 * u) + 'px ' + Magi.fx.MONO;
      var rx = W * 0.72, ry = H * 0.66, col = 120 * u;
      [['CHARACTER:', LETTERS[letter]], ['DISTORTION:', vals.distortion.toFixed(2)], ['SMOOTHNESS:', vals.smoothness.toFixed(2)]].forEach(function (row, i) {
        hud.textAlign = 'left'; hud.fillText(row[0], rx, ry + i * 15 * u);
        hud.textAlign = 'right'; hud.fillText(row[1], rx + col, ry + i * 15 * u);
      });
      if (params.guide !== false) {
        // The reference's instructions, as a small legend.
        hud.textAlign = 'left';
        hud.font = '500 ' + Math.round(7.5 * u) + 'px ' + Magi.fx.MONO;
        hud.fillStyle = 'rgba(255,255,255,0.7)';
        ['GRIP AND TURN LIKE A KNOB', 'THUMB + INDEX  →  PICK THE LETTER', 'THUMB + INDEX + MIDDLE  →  WARP ITS GLYPHS', 'ALL FIVE  →  SMOOTH THE LINES'].forEach(function (l, i) { hud.fillText(l, W * 0.03, H * 0.06 + i * 13 * u); });
      }
      if ('letterSpacing' in hud) hud.letterSpacing = '0px';
      hud.restore();
      if (!G) frame.say('Loading the typeface…');
    };
  };

  // The tile: the room darkened behind the letter.
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
