// Particle Life: colored particles that chase and flee each other by a hidden table of likes and
// dislikes, and organize themselves into cells, worms and swarms (after Jeffrey Ventrella's
// "Clusters" and Tom Mohr's particle life).
//
// There are Types colors. A table A[i][j] in [−1, 1] says how much a type-i particle is drawn to
// type j (negative: pushed away); it's random and not symmetric, so chases happen. Between two
// particles at distance r, as a share of the interaction radius R (Radius), the force on i is
//   F(r) = r/β − 1                          for r < β   (everyone repels up close),
//   F(r) = A[i][j] · (1 − |2r − 1 − β|/(1 − β))   for β ≤ r < 1  (a tent peaking at (1 + β)/2),
//   F(r) = 0 beyond,   β = 0.3,
// along the line between them, scaled by Force · R. Velocity keeps a share of itself each step
// (friction with a half-life, Friction) and the particles move semi-implicitly; the frame wraps
// around like a torus. Neighbors are found with a uniform grid of cell R, so each step costs about
// N × (neighbors), not N².
// Hand: your index fingertip shows the color it holds — hold up 1 to 5 fingers to pick it.
// Pinch: particles near the pinch become that color, so you inject a species. Point (index only):
// your fingertip pulls particles in like a current. Make a fist: particles flee your hand. Clap:
// a new random table, a new world.
// Look (modes): Worms, each particle trailing its last few positions as a short worm (Trail), like
// the reference. Glow, like neon: the same worms drawn as light, added together ('lighter'
// compositing sums the colors, so dense clusters burn toward white): a wide faint halo, a brighter
// band and a white-hot core (the color mixed toward white); Glow sets all three (at 0 only a plain
// line remains). Profile: the species' palette (Original, Pastel, Neon, Ember, Ocean, Forest, Mono).
// Size: each particle's head, a round dot of radius 0.5–8 px (screen) at its current position.
(function () {
  var BETA = 0.3, MAXN = 2000;
  // Color profiles (Profile slider): eight species colors each, in the same order of roles.
  var PROFILES = [
    ['#ff4d2e', '#ffd23f', '#3fa7ff', '#8cff5a', '#c06bff', '#ff6bd1', '#5affe9', '#ffffff'], // Original
    ['#ffadad', '#ffd6a5', '#9bf6ff', '#caffbf', '#bdb2ff', '#ffc6ff', '#a0c4ff', '#fdffb6'], // Pastel
    ['#ff006e', '#ffbe0b', '#3a86ff', '#06d6a0', '#8338ec', '#fb5607', '#00f5d4', '#f8f8f8'], // Neon
    ['#ff5400', '#ff8500', '#ffb700', '#d00000', '#9d0208', '#ffd166', '#e85d04', '#fff3b0'], // Ember
    ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#48cae4', '#023e8a', '#caf0f8', '#ade8f4'], // Ocean
    ['#2d6a4f', '#52b788', '#95d5b2', '#d8f3dc', '#b7e4c7', '#40916c', '#74c69d', '#1b4332'], // Forest
    ['#ffffff', '#d9d9d9', '#b0b0b0', '#8a8a8a', '#666666', '#f2f2f2', '#c4c4c4', '#9e9e9e']  // Mono
  ];
  var COLORS = PROFILES[0];

  function createParticleLife() {
    var P = [], A = [], key = '', lastT = null, seenClap = 0, grid = null;
    function table(n) {
      A = [];
      for (var i = 0; i < n; i++) { A.push([]); for (var j = 0; j < n; j++) A[i].push(Math.random() * 2 - 1); }
    }
    function spawn(n, types, W, H) {
      P = [];
      for (var i = 0; i < n; i++) {
        var x = Math.random() * W, y = Math.random() * H;
        P.push({ x: x, y: y, vx: 0, vy: 0, t: Math.floor(Math.random() * types), h: [] });
      }
    }
    return {
      animated: true,
      render: function (frame, out, params) {
        COLORS = PROFILES[Math.max(0, Math.min(PROFILES.length - 1, Math.round((params.profile || 0) / 100 * (PROFILES.length - 1))))];
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var types = Math.round(params.types), n = Math.min(MAXN, Math.round(params.count));
        var k2 = [W, H, types, n].join(':');
        if (k2 !== key) { key = k2; table(types); spawn(n, types, W, H); }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var ix = Magi.interaction.read(frame);
        ix.events.forEach(function (e) { if (e.type === 'clap' && e.n > seenClap) { seenClap = e.n; table(types); } });

        // Hand: chosen color, pinch to inject, point to pull, fist to scatter.
        var hd = ix.hands[0], held = 0, pulls = [], pushes = [];
        if (hd) {
          held = Math.max(0, Math.min(types - 1, (hd.count || 1) - 1));
          if (hd.pinched) {
            var pm = { x: (hd.points[4].x + hd.points[8].x) / 2, y: (hd.points[4].y + hd.points[8].y) / 2 }, rr = H * 0.08;
            P.forEach(function (q) { if (Math.hypot(q.x - pm.x, q.y - pm.y) < rr) q.t = held; });
          } else if (hd.fist) pushes.push(hd.center);
          else if (hd.pointing) pulls.push(hd.points[8]);
        }

        // Physics: grid of cell R, then forces, friction, motion, wrap.
        var R = H * (0.04 + params.radius / 100 * 0.16), force = (params.force / 100) * 12 * R;
        var keep = Math.pow(0.5, dt / (0.02 + params.friction / 100 * 0.3));
        var gw = Math.max(1, Math.floor(W / R)), gh = Math.max(1, Math.floor(H / R)), cw = W / gw, ch = H / gh;
        grid = new Array(gw * gh);
        for (var g = 0; g < grid.length; g++) grid[g] = [];
        P.forEach(function (q, i) { grid[(Math.min(gh - 1, Math.floor(q.y / ch)) * gw + Math.min(gw - 1, Math.floor(q.x / cw)))].push(i); });
        for (var i = 0; i < P.length; i++) {
          var q = P[i], fx = 0, fy = 0, gx = Math.min(gw - 1, Math.floor(q.x / cw)), gy = Math.min(gh - 1, Math.floor(q.y / ch)), row = A[q.t];
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
            var cell = grid[((gy + oy + gh) % gh) * gw + ((gx + ox + gw) % gw)];
            for (var c = 0; c < cell.length; c++) {
              var o = P[cell[c]];
              if (o === q) continue;
              var dx = o.x - q.x, dy = o.y - q.y;
              if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
              if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
              var d = Math.sqrt(dx * dx + dy * dy), r = d / R;
              if (r >= 1 || d < 1e-6) continue;
              var F = r < BETA ? r / BETA - 1 : row[o.t] * (1 - Math.abs(2 * r - 1 - BETA) / (1 - BETA));
              fx += dx / d * F; fy += dy / d * F;
            }
          }
          q.vx = q.vx * keep + fx * force * dt;
          q.vy = q.vy * keep + fy * force * dt;
          pulls.forEach(function (pt) { var dx2 = pt.x - q.x, dy2 = pt.y - q.y, d2 = Math.hypot(dx2, dy2) + 1; if (d2 < H * 0.35) { q.vx += dx2 / d2 * H * 2 * dt; q.vy += dy2 / d2 * H * 2 * dt; } });
          pushes.forEach(function (pt) { var dx3 = q.x - pt.x, dy3 = q.y - pt.y, d3 = Math.hypot(dx3, dy3) + 1; if (d3 < H * 0.3) { q.vx += dx3 / d3 * H * 6 * dt; q.vy += dy3 / d3 * H * 6 * dt; } });
        }
        var keepTrail = Math.max(1, Math.round(params.trail / 100 * 10));
        P.forEach(function (q) {
          q.h.push(q.x, q.y);
          while (q.h.length > keepTrail * 2) q.h.splice(0, 2);
          q.x += q.vx * dt; q.y += q.vy * dt;
          var wrapped = false;
          if (q.x < 0) { q.x += W; wrapped = true; } else if (q.x >= W) { q.x -= W; wrapped = true; }
          if (q.y < 0) { q.y += H; wrapped = true; } else if (q.y >= H) { q.y -= H; wrapped = true; }
          if (wrapped) q.h = [];
        });

        // Drawing: worms, one path per color (per pass in Glow).
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        var lw = Math.max(1, (1 + params.thickness / 100 * 3) * u), glowMode = params.mode === 'glow', gk = (params.glow === undefined ? 60 : params.glow) / 100;
        var trace = function (ty) {
          ctx.beginPath();
          P.forEach(function (q) {
            if (q.t !== ty) return;
            var h = q.h;
            if (h.length) { ctx.moveTo(h[0], h[1]); for (var k = 2; k < h.length; k += 2) ctx.lineTo(h[k], h[k + 1]); ctx.lineTo(q.x, q.y); }
            else { ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + 0.1, q.y); }
          });
        };
        var passes = glowMode
          ? [{ w: lw * 6, a: 0.07 * gk, white: 0 }, { w: lw * 2.6, a: 0.04 + 0.3 * gk, white: 0 }, { w: Math.max(1, lw * 0.7), a: 0.35 + 0.55 * gk, white: 0.6 * gk }]
          : [{ w: lw, a: 1, white: 0 }];
        if (glowMode) ctx.globalCompositeOperation = 'lighter';
        passes.forEach(function (ps) {
          if (ps.a <= 0) return;
          ctx.lineWidth = ps.w; ctx.globalAlpha = Math.min(1, ps.a);
          for (var ty = 0; ty < types; ty++) {
            var hx = COLORS[ty % COLORS.length], c = [1, 3, 5].map(function (i) { var v = parseInt(hx.slice(i, i + 2), 16); return Math.round(v + (255 - v) * ps.white); });
            ctx.strokeStyle = 'rgb(' + c.join(',') + ')';
            trace(ty);
            ctx.stroke();
          }
        });
        // Heads: one path of dots per color.
        var hr = (0.5 + (params.size === undefined ? 20 : params.size) / 100 * 7.5) * u;
        if (hr > 0.6 * u) {
          ctx.globalAlpha = 1;
          for (var ty2 = 0; ty2 < types; ty2++) {
            var hx2 = COLORS[ty2 % COLORS.length];
            ctx.fillStyle = glowMode ? 'rgb(' + [1, 3, 5].map(function (i) { var v = parseInt(hx2.slice(i, i + 2), 16); return Math.round(v + (255 - v) * 0.5); }).join(',') + ')' : hx2;
            ctx.beginPath();
            P.forEach(function (q) { if (q.t !== ty2) return; ctx.moveTo(q.x + hr, q.y); ctx.arc(q.x, q.y, hr, 0, Math.PI * 2); });
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        // The color your index fingertip holds.
        if (hd) {
          var tp = hd.points[8];
          ctx.fillStyle = COLORS[held % COLORS.length];
          ctx.beginPath(); ctx.arc(tp.x, tp.y, 6 * u, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
      },
      reset: function () { key = ''; lastT = null; }
    };
  }

  Magi.renderers['particle-life'] = createParticleLife;
})();
