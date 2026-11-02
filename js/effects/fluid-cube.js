// Fluid Cube: a wireframe cube of particle fluid that floats at your fingertip and turns with your
// hand.
//
// Fluid: double density relaxation (Clavet, Beaudoin & Poulin, "Particle-based Viscoelastic
// Fluid Simulation", 2005). Each step: apply gravity and viscosity to velocities, move every
// particle, then for each particle sum its neighbors within radius h,
//     ρ = Σ(1 − r/h)²,  ρ_near = Σ(1 − r/h)³,  P = k(ρ − ρ₀),  P_near = k_near·ρ_near,
// and push each neighbor pair apart (or together) by dt²·(P(1 − r/h) + P_near(1 − r/h)²).
// Velocity is then (position − previous position)/dt. ρ₀ is measured from a cubic lattice at the
// fluid's rest spacing; with k = 20 the fluid settles at about 92% of ρ₀ (checked numerically).
// Neighbors come from a uniform grid of cell size h, built by counting sort each step.
//
// The fluid lives in the cube's own coordinates (−1…1 on each axis). Gravity always points down
// the screen, so it is rotated into the cube (Rᵀ·g) every frame: tilt the cube and the fluid
// pours to the new low side. Moving the cube quickly adds the opposite of its acceleration
// (the fictitious force you feel in a braking car), so the fluid sloshes.
//
// Hand (one hand, like the reference): the cube sits just past your index fingertip, along the
// finger. Its orientation is your hand's: x along the knuckles (5 → 17), y along the palm (wrist →
// middle knuckle), z out of the palm, from MediaPipe's metric world points, then tipped 25° and
// turned 30° so it always reads in 3D. Its size follows your palm's apparent size, so bringing the
// hand closer makes it bigger. A flick (Interaction Engine) throws the fluid the flick's way; a
// shake churns it for 0.6 s. With no hand the cube stays and turns slowly.
//
// Drawing: each simulated particle is a small cluster of 14 tiny glowing points (WebGL, additive),
// so 1,200 particles read as a dense cloud of about 17,000 specks, like the reference. (The
// simulation measured about 8 ms per frame at 1,200 particles in headless tests; Particles goes to 3,000.)
(function () {
  var INDEX_TIP = 8, INDEX_MCP = 5;
  var K = 20, K_NEAR = 40, FILL = 0.3, SUBSTEPS = 2, DT = 1 / 120, TILT = 0.42, FOCAL = 4, JIGGLE = 0.12;
  var CLUSTER = 14;
  var EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

  function hsv(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  }
  function mul(m, n) {
    return [0, 1, 2].map(function (i) { return [0, 1, 2].map(function (j) { return m[i][0] * n[0][j] + m[i][1] * n[1][j] + m[i][2] * n[2][j]; }); });
  }
  // Rotation R = Rz(roll)·Rx(tilt)·Ry(yaw), row-major 3×3.
  function rotation(roll, yaw) {
    var cz = Math.cos(roll), sz = Math.sin(roll), cx = Math.cos(TILT), sx = Math.sin(TILT), cy = Math.cos(yaw), sy = Math.sin(yaw);
    return mul([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], mul([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]));
  }
  // The fixed 3D view added to the hand's orientation: tip 25° about x, turn 30° about y.
  var VIEW = mul([[1, 0, 0], [0, Math.cos(0.44), -Math.sin(0.44)], [0, Math.sin(0.44), Math.cos(0.44)]],
    [[Math.cos(0.52), 0, Math.sin(0.52)], [0, 1, 0], [-Math.sin(0.52), 0, Math.cos(0.52)]]);

  function v3(a, b) { return [b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  // Hand orientation as a rotation matrix whose columns are the hand's x, y, z axes on screen.
  function handFrame(q) {
    var y = norm(v3(q[9], q[0]));                         // down the palm, toward the wrist
    var s = norm(v3(q[5], q[17])), x = norm([s[0] - y[0] * dot(s, y), s[1] - y[1] * dot(s, y), s[2] - y[2] * dot(s, y)]);
    var z = cross(x, y);
    return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  }
  // Eases rotation A toward B and re-orthonormalizes (Gram–Schmidt on the columns).
  function easeRot(A, B, e) {
    var c = [0, 1, 2].map(function (j) { return [0, 1, 2].map(function (i) { return A[i][j] + (B[i][j] - A[i][j]) * e; }); });
    var x = norm(c[0]), y = norm([c[1][0] - x[0] * dot(c[1], x), c[1][1] - x[1] * dot(c[1], x), c[1][2] - x[2] * dot(c[1], x)]), z = cross(x, y);
    return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
  }

  // Additive point sprites in WebGL: each point is a soft disc.
  function createPoints() {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, [
      'attribute vec4 a;', 'uniform vec2 res;', 'varying float al;',
      'void main() { al = a.w; gl_Position = vec4(a.x / res.x * 2.0 - 1.0, 1.0 - a.y / res.y * 2.0, 0.0, 1.0); gl_PointSize = a.z; }'
    ].join('\n')));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, [
      'precision mediump float;', 'uniform vec3 col;', 'varying float al;',
      'void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float k = al * max(0.0, 1.0 - d * d); gl_FragColor = vec4(col * k, k); }'
    ].join('\n')));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    var buf = gl.createBuffer(), loc = gl.getAttribLocation(prog, 'a');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    var uRes = gl.getUniformLocation(prog, 'res'), uCol = gl.getUniformLocation(prog, 'col');
    return {
      canvas: c,
      draw: function (w, h, data, count, rgb) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uRes, w, h);
        gl.uniform3f(uCol, rgb[0], rgb[1], rgb[2]);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 4), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, count);
      }
    };
  }

  function createFluidCube() {
    var N = 0, x, p, v, s0, h, rho0, lim, offs;
    var nA = new Int32Array(0), nB = new Int32Array(0), nU = new Float32Array(0), pairs = 0;
    var cube = null, Rot = null, yaw = 0, last = 0, hist = [], seenEvent = 0, churn = 0;
    var points, pointData = null;

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
      // Screen-space offsets of each particle's cluster of specks (in units of the particle spacing).
      offs = new Float32Array(N * CLUSTER * 2);
      for (i = 0; i < offs.length; i++) offs[i] = (Math.random() + Math.random() + Math.random() - 1.5) * 0.7;
      pointData = new Float32Array(N * CLUSTER * 4);
    }

    function step(gx, gy, gz, visc, extra) {
      var n, i, jig = JIGGLE + extra;
      // Gravity, plus a small random thermal jiggle that keeps the settled fluid from packing
      // into a visible crystal lattice (a shake adds more).
      for (n = 0; n < N; n++) {
        v[n * 3] += gx * DT + (Math.random() - 0.5) * jig;
        v[n * 3 + 1] += gy * DT + (Math.random() - 0.5) * jig;
        v[n * 3 + 2] += gz * DT + (Math.random() - 0.5) * jig;
      }
      // Viscosity (Clavet §5.3): damp the approaching part of each neighbor pair's velocity.
      if (visc > 0) {
        var sigma = visc * 4, beta = visc * 2;
        for (i = 0; i < pairs; i++) {
          var a = nA[i], b = nB[i], ux = nU[i * 4], uy = nU[i * 4 + 1], uz = nU[i * 4 + 2], q = nU[i * 4 + 3];
          var u = (v[a * 3] - v[b * 3]) * ux + (v[a * 3 + 1] - v[b * 3 + 1]) * uy + (v[a * 3 + 2] - v[b * 3 + 2]) * uz;
          if (u <= 0) continue;
          var I = DT * q * (sigma * u + beta * u * u) / 2;
          v[a * 3] -= I * ux; v[a * 3 + 1] -= I * uy; v[a * 3 + 2] -= I * uz;
          v[b * 3] += I * ux; v[b * 3 + 1] += I * uy; v[b * 3 + 2] += I * uz;
        }
      }
      for (n = 0; n < N * 3; n++) { p[n] = x[n]; x[n] += v[n] * DT; }
      neighbors();
      relax();
      for (n = 0; n < N * 3; n++) {
        if (x[n] > lim) x[n] = lim;
        else if (x[n] < -lim) x[n] = -lim;
        v[n] = (x[n] - p[n]) / DT;
      }
    }

    // Neighbor pairs within h: particles sorted into grid cells (counting sort), then each
    // particle checks the 27 cells around its own.
    var cellOf = null, start = null, sorted = null;
    function neighbors() {
      var G = Math.ceil(2 / h) + 2, cells = G * G * G, n, c;
      if (!cellOf || cellOf.length !== N || start.length !== cells + 1) {
        cellOf = new Int32Array(N); start = new Int32Array(cells + 1); sorted = new Int32Array(N);
      }
      start.fill(0);
      for (n = 0; n < N; n++) {
        var ix = Math.min(G - 1, Math.max(0, Math.floor((x[n * 3] + 1) / h))), iy = Math.min(G - 1, Math.max(0, Math.floor((x[n * 3 + 1] + 1) / h)));
        var iz = Math.min(G - 1, Math.max(0, Math.floor((x[n * 3 + 2] + 1) / h)));
        c = ix + G * (iy + G * iz);
        cellOf[n] = c;
        start[c + 1]++;
      }
      for (c = 0; c < cells; c++) start[c + 1] += start[c];
      var fill = start.slice(0, cells);
      for (n = 0; n < N; n++) sorted[fill[cellOf[n]]++] = n;
      pairs = 0;
      var h2 = h * h;
      for (n = 0; n < N; n++) {
        var cn = cellOf[n], cx = cn % G, cy = Math.floor(cn / G) % G, cz = Math.floor(cn / (G * G));
        for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var X = cx + dx, Y = cy + dy, Z = cz + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= G || Y >= G || Z >= G) continue;
          var cc = X + G * (Y + G * Z);
          for (var t = start[cc]; t < start[cc + 1]; t++) {
            var o = sorted[t];
            if (o <= n) continue; // each pair once
            var rx = x[o * 3] - x[n * 3], ry = x[o * 3 + 1] - x[n * 3 + 1], rz = x[o * 3 + 2] - x[n * 3 + 2];
            var r2 = rx * rx + ry * ry + rz * rz;
            if (r2 >= h2 || r2 < 1e-12) continue;
            if (pairs >= nA.length) grow();
            var r = Math.sqrt(r2);
            nA[pairs] = n; nB[pairs] = o;
            nU[pairs * 4] = rx / r; nU[pairs * 4 + 1] = ry / r; nU[pairs * 4 + 2] = rz / r; nU[pairs * 4 + 3] = 1 - r / h;
            pairs++;
          }
        }
      }
    }
    function grow() {
      var size = Math.max(1024, nA.length * 2), a = new Int32Array(size), b = new Int32Array(size), u = new Float32Array(size * 4);
      a.set(nA); b.set(nB); u.set(nU);
      nA = a; nB = b; nU = u;
    }

    // Double density relaxation over the pairs found this step.
    var rho = null, rhoN = null;
    function relax() {
      if (!rho || rho.length !== N) { rho = new Float32Array(N); rhoN = new Float32Array(N); }
      rho.fill(0); rhoN.fill(0);
      var i;
      for (i = 0; i < pairs; i++) {
        var q = nU[i * 4 + 3], q2 = q * q, q3 = q2 * q;
        rho[nA[i]] += q2; rho[nB[i]] += q2;
        rhoN[nA[i]] += q3; rhoN[nB[i]] += q3;
      }
      for (i = 0; i < pairs; i++) {
        var a = nA[i], b = nB[i], qq = nU[i * 4 + 3];
        var P = K * ((rho[a] + rho[b]) / 2 - rho0), PN = K_NEAR * (rhoN[a] + rhoN[b]) / 2;
        var D = DT * DT * (P * qq + PN * qq * qq) / 2;
        var ux = nU[i * 4] * D, uy = nU[i * 4 + 1] * D, uz = nU[i * 4 + 2] * D;
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

        // One hand: where it wants the cube, and its orientation.
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), hd = ix.hands[0];
        var details = tracker.details(), want = null, target = null;
        if (!cube) cube = { x: W / 2, y: H / 2, s: Math.min(W, H) * 0.22 };
        if (hd) {
          var hp = hd.points, tip = hp[INDEX_TIP], base = hp[INDEX_MCP];
          var dl = Math.hypot(tip.x - base.x, tip.y - base.y) || 1, size = hd.size * 1.3;
          want = { x: tip.x + (tip.x - base.x) / dl * size * 1.1, y: tip.y + (tip.y - base.y) / dl * size * 1.1, s: size };
          var world = details[0] && details[0].world;
          var q = world && world.length === 21 ? world : hp.map(function (r) { return { x: r.x, y: r.y, z: (r.z || 0) * W }; });
          target = mul(handFrame(q), VIEW);
          ix.events.forEach(function (e) {
            if (e.n <= seenEvent) return;
            seenEvent = e.n;
            if (e.type === 'flick') {
              // Throw the fluid the flick's way: a screen-space kick, into cube space (Rᵀ·f).
              var f = e.dir === 'left' ? [-9, 0, 0] : e.dir === 'right' ? [9, 0, 0] : e.dir === 'up' ? [0, -9, 0] : [0, 9, 0], R0 = Rot || target;
              var kx = R0[0][0] * f[0] + R0[1][0] * f[1], ky = R0[0][1] * f[0] + R0[1][1] * f[1], kz = R0[0][2] * f[0] + R0[1][2] * f[1];
              for (var n = 0; n < N; n++) { v[n * 3] += kx; v[n * 3 + 1] += ky; v[n * 3 + 2] += kz; }
            } else if (e.type === 'shake') churn = 0.6;
          });
        }
        var e = 1 - Math.exp(-dt / 0.08);
        if (want) {
          cube.x += (want.x - cube.x) * e; cube.y += (want.y - cube.y) * e; cube.s += (want.s - cube.s) * e;
          Rot = Rot ? easeRot(Rot, target, e) : target;
        } else {
          yaw += (params.spin / 100) * 1.2 * dt;
          var idle = rotation(0, yaw);
          Rot = Rot ? easeRot(Rot, idle, 1 - Math.exp(-dt / 0.6)) : idle;
        }
        var R = Rot, S = Math.max(12, cube.s * (params.size / 100));
        churn = Math.max(0, churn - dt);

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
        for (var s = 0; s < SUBSTEPS; s++) step(gx, gy, gz, params.viscosity / 100, churn > 0 ? 1.5 : 0);

        function project(px, py, pz) {
          var X = R[0][0] * px + R[0][1] * py + R[0][2] * pz, Y = R[1][0] * px + R[1][1] * py + R[1][2] * pz, Z = R[2][0] * px + R[2][1] * py + R[2][2] * pz;
          var k = FOCAL / (FOCAL + Z);
          return [cube.x + S * X * k, cube.y + S * Y * k, k];
        }

        var hue = params.color > 0 ? (params.color - 1) / 99 : 0;
        var col = params.color > 0 ? hsv(hue, 0.9, 1) : [1, 1, 1];
        var rgb = col.map(function (c) { return Math.round(c * 255); }).join(',');

        // Specks: each particle's cluster, projected, as additive points.
        if (points === undefined) points = createPoints();
        var spread = S * s0 * 0.9, dotSize = Math.max(1.5, 2.2 * u), m = 0;
        for (var n = 0; n < N; n++) {
          var c = project(x[n * 3], x[n * 3 + 1], x[n * 3 + 2]), a = (params.glow ? 0.35 : 0.6) * (0.6 + 0.4 * Math.min(1, c[2]));
          for (var j = 0; j < CLUSTER; j++) {
            var o = (n * CLUSTER + j) * 2;
            pointData[m * 4] = c[0] + offs[o] * spread * c[2];
            pointData[m * 4 + 1] = c[1] + offs[o + 1] * spread * c[2];
            pointData[m * 4 + 2] = dotSize * c[2];
            pointData[m * 4 + 3] = a;
            m++;
          }
        }
        ctx.save();
        if (points) {
          points.draw(W, H, pointData, m, col);
          ctx.globalCompositeOperation = params.glow ? 'lighter' : 'source-over';
          ctx.drawImage(points.canvas, 0, 0);
        } else {
          ctx.fillStyle = 'rgb(' + rgb + ')';
          for (n = 0; n < N; n++) { var q2 = project(x[n * 3], x[n * 3 + 1], x[n * 3 + 2]); ctx.fillRect(q2[0] - 1, q2[1] - 1, 2, 2); }
        }
        ctx.restore();

        if (params.outline) {
          var corners = [];
          for (var cc = 0; cc < 8; cc++) corners.push(project(cc & 1 ? 1 : -1, cc & 2 ? 1 : -1, cc & 4 ? 1 : -1));
          ctx.save();
          ctx.strokeStyle = 'rgba(' + rgb + ',0.9)';
          ctx.lineWidth = Math.max(1, 1.1 * u);
          ctx.beginPath();
          EDGES.forEach(function (ed) {
            ctx.moveTo(corners[ed[0]][0], corners[ed[0]][1]);
            ctx.lineTo(corners[ed[1]][0], corners[ed[1]][1]);
          });
          ctx.stroke();
          ctx.restore();
        }

        if (params.readouts) {
          // Readouts like the reference: the simulation's parameters on the left, the hand on the right.
          var fs = Math.round(9 * u), lh = Math.round(fs * 1.35), pad = Math.round(14 * u);
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '400 ' + Math.round(fs * 1.4) + 'px Inter, sans-serif';
          ctx.textBaseline = 'top';
          ctx.fillText('Fluid Particle Simulation', pad, pad);
          ctx.font = '400 ' + fs + 'px ' + Magi.fx.MONO;
          [['particles', N], ['radius', h.toFixed(3)], ['rest density', rho0.toFixed(2)], ['stiffness', K], ['near stiffness', K_NEAR],
            ['viscosity', (params.viscosity / 100).toFixed(2)], ['gravity', g.toFixed(1)], ['pairs', pairs], ['dt', DT.toFixed(4)]
          ].forEach(function (r, i) { ctx.fillText(r[0] + '  ' + r[1], pad, pad + fs * 2.2 + i * lh); });
          if (hd) {
            ctx.textAlign = 'right';
            [['HAND_1_ROTATION', hd.rotation.toFixed(1)], ['HAND_1_POSITION_X', (hd.center.x / W).toFixed(2)],
              ['HAND_1_POSITION_Y', (hd.center.y / H).toFixed(2)], ['HAND_1_POSITION_Z', (-hd.size / H).toFixed(2)]
            ].forEach(function (r, i) { ctx.fillText('+ ' + r[0] + '  ' + r[1], W - pad, pad + fs * 2.2 + i * lh); });
          }
          ctx.restore();
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hd) Magi.tracking.hint(ctx, frame, 'Point at the cube: it floats at your fingertip and turns with your hand. Flick to slosh, shake to churn.');
      },
      reset: function () { N = 0; cube = null; Rot = null; last = 0; hist = []; churn = 0; }
    };
  }

  Magi.renderers['fluid-cube'] = createFluidCube;
})();
