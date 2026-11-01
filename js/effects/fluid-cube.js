// Fluid Cube: a wireframe cube you hold with your hands, filled with a particle fluid.
//
// Fluid: double density relaxation (Clavet, Beaudoin & Poulin, "Particle-based Viscoelastic
// Fluid Simulation", 2005). Each step: apply gravity and viscosity to velocities, move every
// particle, then for each particle sum its neighbors within radius h,
//     ρ = Σ(1 − r/h)²,  ρ_near = Σ(1 − r/h)³,  P = k(ρ − ρ₀),  P_near = k_near·ρ_near,
// and push each neighbor pair apart (or together) by dt²·(P(1 − r/h) + P_near(1 − r/h)²).
// Velocity is then (position − previous position)/dt. ρ₀ is measured from a cubic lattice at the
// fluid's rest spacing; with k = 20 the fluid settles at about 92% of ρ₀ (checked numerically).
//
// The fluid lives in the cube's own coordinates (−1…1 on each axis). Gravity always points down
// the screen, so it is rotated into the cube (Rᵀ·g) every frame: tilt the cube and the fluid
// pours to the new low side. Moving the cube quickly adds the opposite of its acceleration
// (the fictitious force you feel in a braking car), so the fluid sloshes.
//
// Hands: two hands hold the cube between their index fingertips; their distance sets its size and
// the line between them its tilt. One hand: thumb–index spread sets the size, the hand's own
// rotation its tilt. With no hands the cube stays where it was and keeps spinning.
(function () {
  var THUMB_TIP = 4, INDEX_TIP = 8, WRIST = 0, MIDDLE_MCP = 9;
  var K = 20, K_NEAR = 40, FILL = 0.3, SUBSTEPS = 2, DT = 1 / 120, TILT = 0.42, FOCAL = 4, JIGGLE = 0.12;
  var EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

  function hsv(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  }

  // Rotation R = Rz(roll)·Rx(tilt)·Ry(yaw), row-major 3×3.
  function rotation(roll, yaw) {
    var cz = Math.cos(roll), sz = Math.sin(roll), cx = Math.cos(TILT), sx = Math.sin(TILT), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var a = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];                 // Ry
    var b = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];                 // Rx
    var c = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];                 // Rz
    function mul(m, n) {
      return [0, 1, 2].map(function (i) { return [0, 1, 2].map(function (j) { return m[i][0] * n[0][j] + m[i][1] * n[1][j] + m[i][2] * n[2][j]; }); });
    }
    return mul(c, mul(b, a));
  }

  function createFluidCube() {
    var N = 0, x, p, v, s0, h, rho0, lim, nbr = [];
    var cube = null, yaw = 0, last = 0, hist = [];
    var sprite = document.createElement('canvas'), spriteKey = '';
    sprite.width = sprite.height = 64;

    function init(count) {
      N = count;
      x = new Float32Array(N * 3); p = new Float32Array(N * 3); v = new Float32Array(N * 3);
      s0 = Math.cbrt(FILL * 8 / N); h = 2.2 * s0; lim = 1 - s0 * 0.5;
      rho0 = 0;
      var m = Math.ceil(h / s0);
      for (var i = -m; i <= m; i++) for (var j = -m; j <= m; j++) for (var k = -m; k <= m; k++) {
        var r = Math.hypot(i, j, k) * s0;
        if ((i || j || k) && r < h) rho0 += Math.pow(1 - r / h, 2);
      }
      for (var n = 0; n < N; n++) { // start as a block in the lower part of the cube
        x[n * 3] = (Math.random() - 0.5) * 1.8;
        x[n * 3 + 1] = 1 - Math.random() * 0.9;
        x[n * 3 + 2] = (Math.random() - 0.5) * 1.8;
      }
    }

    function step(gx, gy, gz, visc) {
      var n, i;
      // Gravity, plus a small random thermal jiggle that keeps the settled fluid from packing
      // into a visible crystal lattice.
      for (n = 0; n < N; n++) {
        v[n * 3] += gx * DT + (Math.random() - 0.5) * JIGGLE;
        v[n * 3 + 1] += gy * DT + (Math.random() - 0.5) * JIGGLE;
        v[n * 3 + 2] += gz * DT + (Math.random() - 0.5) * JIGGLE;
      }
      // Viscosity (Clavet §5.3): damp the approaching part of each neighbor pair's velocity.
      if (visc > 0) {
        var sigma = visc * 4, beta = visc * 2;
        for (i = 0; i < nbr.length; i += 6) {
          var a = nbr[i], b = nbr[i + 1], ux = nbr[i + 2], uy = nbr[i + 3], uz = nbr[i + 4], q = nbr[i + 5];
          var u = (v[a * 3] - v[b * 3]) * ux + (v[a * 3 + 1] - v[b * 3 + 1]) * uy + (v[a * 3 + 2] - v[b * 3 + 2]) * uz;
          if (u <= 0) continue;
          var I = DT * q * (sigma * u + beta * u * u) / 2;
          v[a * 3] -= I * ux; v[a * 3 + 1] -= I * uy; v[a * 3 + 2] -= I * uz;
          v[b * 3] += I * ux; v[b * 3 + 1] += I * uy; v[b * 3 + 2] += I * uz;
        }
      }
      for (n = 0; n < N * 3; n++) { p[n] = x[n]; x[n] += v[n] * DT; }

      // Neighbors on a uniform grid of cell size h.
      var G = Math.ceil(2 / h) + 2, cells = new Map();
      for (n = 0; n < N; n++) {
        var key = Math.floor((x[n * 3] + 1) / h) + G * (Math.floor((x[n * 3 + 1] + 1) / h) + G * Math.floor((x[n * 3 + 2] + 1) / h));
        (cells.get(key) || cells.set(key, []).get(key)).push(n);
      }
      nbr = [];
      for (n = 0; n < N; n++) {
        var cx = Math.floor((x[n * 3] + 1) / h), cy = Math.floor((x[n * 3 + 1] + 1) / h), cz = Math.floor((x[n * 3 + 2] + 1) / h);
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
          var list = cells.get((cx + dx) + G * ((cy + dy) + G * (cz + dz)));
          if (!list) continue;
          for (var t = 0; t < list.length; t++) {
            var o = list[t];
            if (o <= n) continue; // each pair once
            var rx = x[o * 3] - x[n * 3], ry = x[o * 3 + 1] - x[n * 3 + 1], rz = x[o * 3 + 2] - x[n * 3 + 2];
            var r2 = rx * rx + ry * ry + rz * rz;
            if (r2 >= h * h || r2 < 1e-12) continue;
            var r = Math.sqrt(r2);
            nbr.push(n, o, rx / r, ry / r, rz / r, 1 - r / h);
          }
        }
      }
      relax();
      for (n = 0; n < N * 3; n++) {
        if (x[n] > lim) x[n] = lim;
        else if (x[n] < -lim) x[n] = -lim;
        v[n] = (x[n] - p[n]) / DT;
      }
    }

    // Double density relaxation over the pairs found this step.
    function relax() {
      var rho = new Float32Array(N), rhoN = new Float32Array(N), i;
      for (i = 0; i < nbr.length; i += 6) {
        var q = nbr[i + 5], q2 = q * q, q3 = q2 * q;
        rho[nbr[i]] += q2; rho[nbr[i + 1]] += q2;
        rhoN[nbr[i]] += q3; rhoN[nbr[i + 1]] += q3;
      }
      for (i = 0; i < nbr.length; i += 6) {
        var a = nbr[i], b = nbr[i + 1], qq = nbr[i + 5];
        var P = K * ((rho[a] + rho[b]) / 2 - rho0), PN = K_NEAR * (rhoN[a] + rhoN[b]) / 2;
        var D = DT * DT * (P * qq + PN * qq * qq) / 2;
        var ux = nbr[i + 2] * D, uy = nbr[i + 3] * D, uz = nbr[i + 4] * D;
        x[a * 3] -= ux; x[a * 3 + 1] -= uy; x[a * 3 + 2] -= uz;
        x[b * 3] += ux; x[b * 3 + 1] += uy; x[b * 3 + 2] += uz;
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (N !== params.particles) init(params.particles);
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;

        // Where the hands want the cube.
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), want = null;
        if (hands.length >= 2) {
          var A = hands[0][INDEX_TIP], B = hands[1][INDEX_TIP];
          if (A.x > B.x) { var tmp = A; A = B; B = tmp; }
          want = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, s: Math.hypot(B.x - A.x, B.y - A.y) * 0.42, roll: Math.atan2(B.y - A.y, B.x - A.x) };
        } else if (hands.length === 1) {
          var hp = hands[0], T = hp[THUMB_TIP], I = hp[INDEX_TIP];
          var palm = Math.hypot(hp[MIDDLE_MCP].x - hp[WRIST].x, hp[MIDDLE_MCP].y - hp[WRIST].y);
          want = { x: (T.x + I.x) / 2, y: (T.y + I.y) / 2, s: Math.hypot(T.x - I.x, T.y - I.y) * 0.6 + palm * 0.3,
            roll: Math.atan2(hp[MIDDLE_MCP].x - hp[WRIST].x, -(hp[MIDDLE_MCP].y - hp[WRIST].y)) };
        }
        if (!cube) cube = { x: W / 2, y: H / 2, s: Math.min(W, H) * 0.22, roll: 0 };
        if (want) {
          var e = 1 - Math.exp(-dt / 0.08);
          cube.x += (want.x - cube.x) * e; cube.y += (want.y - cube.y) * e;
          cube.s += (want.s - cube.s) * e;
          var dr = Math.atan2(Math.sin(want.roll - cube.roll), Math.cos(want.roll - cube.roll));
          cube.roll += dr * e;
        }
        var S = Math.max(12, cube.s * (params.size / 100));
        yaw += (params.spin / 100) * 1.2 * dt;
        var R = rotation(cube.roll, yaw);

        // The cube's acceleration on screen, in cube units, from its last three positions.
        hist.push({ x: cube.x, y: cube.y, t: dt });
        if (hist.length > 3) hist.shift();
        var ax = 0, ay = 0;
        if (hist.length === 3) {
          var d2 = hist[2].t * hist[1].t;
          ax = (hist[2].x - 2 * hist[1].x + hist[0].x) / d2 / S;
          ay = (hist[2].y - 2 * hist[1].y + hist[0].y) / d2 / S;
          var am = Math.hypot(ax, ay);
          if (am > 40) { ax *= 40 / am; ay *= 40 / am; }
        }
        // World force (gravity down the screen minus the cube's acceleration), into cube space: Rᵀ·f.
        var g = 4 + (params.gravity / 100) * 30, fx = -ax, fy = g - ay;
        var gx = R[0][0] * fx + R[1][0] * fy, gy = R[0][1] * fx + R[1][1] * fy, gz = R[0][2] * fx + R[1][2] * fy;
        for (var s = 0; s < SUBSTEPS; s++) step(gx, gy, gz, params.viscosity / 100);

        function project(px, py, pz) {
          var X = R[0][0] * px + R[0][1] * py + R[0][2] * pz, Y = R[1][0] * px + R[1][1] * py + R[1][2] * pz, Z = R[2][0] * px + R[2][1] * py + R[2][2] * pz;
          var k = FOCAL / (FOCAL + Z);
          return [cube.x + S * X * k, cube.y + S * Y * k, k];
        }

        var hue = params.color > 0 ? (params.color - 1) / 99 : 0;
        var col = params.color > 0 ? hsv(hue, 0.9, 1) : [1, 1, 1];
        var rgb = col.map(function (c) { return Math.round(c * 255); }).join(',');
        // Each particle is a soft round sprite (a radial falloff), so neighbors blend into one body
        // of liquid; Glow adds their light where they overlap.
        if (spriteKey !== rgb) {
          spriteKey = rgb;
          var sg = sprite.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
          gr.addColorStop(0, 'rgba(' + rgb + ',1)');
          gr.addColorStop(0.35, 'rgba(' + rgb + ',0.75)');
          gr.addColorStop(1, 'rgba(' + rgb + ',0)');
          sg.clearRect(0, 0, 64, 64);
          sg.fillStyle = gr;
          sg.fillRect(0, 0, 64, 64);
        }
        ctx.save();
        ctx.globalCompositeOperation = params.glow ? 'lighter' : 'source-over';
        var pr = Math.max(2, S * 0.05);
        for (var n = 0; n < N; n++) {
          var q = project(x[n * 3], x[n * 3 + 1], x[n * 3 + 2]), r = pr * q[2];
          ctx.globalAlpha = params.glow ? 0.28 + 0.22 * q[2] : 0.55 + 0.35 * q[2];
          ctx.drawImage(sprite, q[0] - r, q[1] - r, r * 2, r * 2);
        }
        ctx.restore();

        if (params.outline) {
          var corners = [];
          for (var c = 0; c < 8; c++) corners.push(project(c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1));
          ctx.save();
          ctx.strokeStyle = 'rgb(' + rgb + ')';
          ctx.lineWidth = Math.max(1, 1.5 * u);
          ctx.beginPath();
          EDGES.forEach(function (ed) {
            ctx.moveTo(corners[ed[0]][0], corners[ed[0]][1]);
            ctx.lineTo(corners[ed[1]][0], corners[ed[1]][1]);
          });
          ctx.stroke();
          ctx.restore();
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Hold the cube between your index fingers. Spread to scale, tilt to turn.');
      },
      reset: function () { N = 0; cube = null; last = 0; hist = []; }
    };
  }

  Magi.renderers['fluid-cube'] = createFluidCube;
})();
