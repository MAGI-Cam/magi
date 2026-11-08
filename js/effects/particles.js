// Particles: a field of particles on springs that your fingertips push through (after "testing the
// particle spring system").
//
// Each particle has a rest position x₀ and is pulled back by a damped spring,
//   a = −k (x − x₀) − c v,   k = (2π f)² with f = 0.3–3 Hz (Stiffness), c from Damping,
// integrated with semi-implicit Euler in two substeps a frame. Every fingertip pushes particles
// away within a radius r (Reach, 4–20% of the frame height) with an acceleration that fades as
// (1 − d/r)² (Push), so your finger carves a path and the field springs back behind it.
// Rest shape (Shape): 0 the whole screen (a jittered grid); 2 an oval field like the reference
// (inside an ellipse, denser toward the middle); 1 a letter (the Letter slider, A–Z), its filled shape sampled
// from Literata on a hidden canvas.
// Look: each particle a small ring; moving ones light up white with a streak back along their
// motion, brighter the faster they go. Hide: resting particles are invisible, so only the reactive
// ones show. The index fingertips get a red dot, as in the reference.
(function () {
  var TIPS = [4, 8, 12, 16, 20];

  function restPoints(shape, letter, n, W, H) {
    var pts = [], cx = W * 0.35, cy = H * 0.48, rx = Math.min(W * 0.3, H * 0.55), ry = H * 0.3;
    if (shape === 1) {
      var S = 200, c = document.createElement('canvas'); c.width = c.height = S;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.font = '500 170px Literata, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
      g.fillText('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letter], S / 2, S / 2);
      var d = g.getImageData(0, 0, S, S).data, inside = [];
      for (var y = 0; y < S; y += 2) for (var x = 0; x < S; x += 2) if (d[(y * S + x) * 4 + 3] > 127) inside.push([x, y]);
      var sc = H * 0.8 / S;
      for (var i = 0; i < n && inside.length; i++) {
        var q = inside[Math.floor(Math.random() * inside.length)];
        pts.push([cx + (q[0] + Math.random() * 2 - S / 2) * sc, cy + (q[1] + Math.random() * 2 - S / 2) * sc]);
      }
      return pts;
    }
    if (shape === 2) {
      // Oval field: rejection-sampled inside the ellipse, denser toward the middle.
      while (pts.length < n) {
        var u = Math.random() * 2 - 1, v = Math.random() * 2 - 1, r2 = u * u + v * v;
        if (r2 > 1 || Math.random() > 1.15 - 0.5 * r2) continue;
        pts.push([cx + u * rx, cy + v * ry]);
      }
      return pts;
    }
    // Screen: a jittered grid over the whole frame (cells of equal area, one particle each, offset
    // by up to 40% of a cell), so the field is even edge to edge.
    var cell = Math.sqrt(W * H / n), cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    for (var gy = 0; gy < rows; gy++) for (var gx = 0; gx < cols; gx++) {
      pts.push([(gx + 0.5 + (Math.random() - 0.5) * 0.8) * cell, (gy + 0.5 + (Math.random() - 0.5) * 0.8) * cell]);
    }
    return pts;
  }

  function createParticles() {
    var P = null, key = '', lastT = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var shape = Math.round(params.shape), n = Math.round(params.count), letter = Math.round(params.letter);
        if (shape === 1 && !Magi.fx.fontReady('Literata')) { frame.say('Loading the typeface…'); return; }
        var k2 = [W, H, shape, n, letter].join(':');
        if (k2 !== key) {
          key = k2;
          P = restPoints(shape, letter, n, W, H).map(function (q) { return { x0: q[0], y0: q[1], x: q[0], y: q[1], vx: 0, vy: 0, px: q[0], py: q[1] }; });
        }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var ix = Magi.interaction.read(frame), tips = [];
        ix.hands.forEach(function (h) { TIPS.forEach(function (k) { tips.push(h.points[k]); }); });
        var f = 0.3 + params.stiffness / 100 * 2.7, K = (2 * Math.PI * f) * (2 * Math.PI * f), C = 1 + params.damping / 100 * 14;
        var r = H * (0.04 + params.reach / 100 * 0.16), push = H * (20 + params.push / 100 * 140), h = dt / 2;
        for (var s = 0; s < 2; s++) {
          for (var i = 0; i < P.length; i++) {
            var q = P[i], ax = -K * (q.x - q.x0) - C * q.vx, ay = -K * (q.y - q.y0) - C * q.vy;
            for (var j = 0; j < tips.length; j++) {
              var dx = q.x - tips[j].x, dy = q.y - tips[j].y, d = Math.hypot(dx, dy);
              if (d < r && d > 1e-3) { var w = (1 - d / r) * (1 - d / r) * push / d; ax += dx * w; ay += dy * w; }
            }
            if (s === 0) { q.px = q.x; q.py = q.y; }
            q.vx += ax * h; q.vy += ay * h; q.x += q.vx * h; q.y += q.vy * h;
          }
        }
        // Drawing: rings at rest; moving particles light up with a streak.
        var rr = Math.max(1.2, 1.8 * u), still = [], moving = [];
        P.forEach(function (q) { var sp = Math.hypot(q.vx, q.vy) / H; (sp > 0.08 ? moving : still).push([q, Math.min(1, sp / 0.8)]); });
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(0.8, 0.8 * u);
        ctx.beginPath();
        // Hide: resting particles are invisible; only the ones your hand sets moving show.
        if (!params.hide) still.forEach(function (e) { ctx.moveTo(e[0].x + rr, e[0].y); ctx.arc(e[0].x, e[0].y, rr, 0, Math.PI * 2); });
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        // Moving particles in four brightness bands, one path each.
        [0, 1, 2, 3].forEach(function (band) {
          var lo = band / 4, hi = (band + 1) / 4, b = (band + 0.5) / 4;
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.65 * b).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1, (1 + 1.6 * b) * u);
          ctx.beginPath();
          moving.forEach(function (e) { if (e[1] < lo || (e[1] >= hi && band < 3)) return; var q = e[0]; ctx.moveTo(q.x - q.vx * dt * 3, q.y - q.vy * dt * 3); ctx.lineTo(q.x, q.y); });
          ctx.stroke();
        });
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ff3b30';
        ix.hands.forEach(function (hd) { var q = hd.points[8]; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5 * u, 0, Math.PI * 2); ctx.fill(); });
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and push through the particles.');
      },
      reset: function () { key = ''; lastT = null; }
    };
  }

  Magi.renderers.particles = createParticles;
})();
