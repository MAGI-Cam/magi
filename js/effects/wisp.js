// Wisp: your hands turn to liquid. Wherever a hand is, it pours dye into a 2D fluid; moving the
// hand drags the fluid along, so the hand leaves wisps that drip, curl and fade.
//
// Fluid: Stam, "Stable Fluids" (SIGGRAPH 1999) on a coarse grid. Each frame:
//   1. forces — hand motion (the fluid under a hand takes the hand's velocity, by Flow),
//      curl noise (Swirl; the curl of a stream function is divergence-free), and gravity on the
//      dye (Drip): v_y += g·ρ·dt;
//   2. semi-Lagrangian advection of the velocity: u(x) ← u(x − u·dt);
//   3. projection: solve ∇²p = ∇·u (Gauss–Seidel) and subtract ∇p, so the flow is incompressible
//      and swirls instead of piling up;
//   4. advection of the dye density ρ and its color, then decay ρ ← ρ·2^(−dt/half-life) (Trail);
//   5. the hands, rasterized as capsules along MediaPipe's bones, set ρ = max(ρ, mask).
//
// Surface: the blurred density is a height field h. Its 0.3 level set is the liquid's edge, which
// is why trails bead into drops (the same isosurface as metaballs).
//   Liquid — the camera seen through the liquid. For small slopes Snell's law shifts the image by
//            Δ ≈ −(1 − 1/n)·H·∇h with n = 1.33 (water) and H the layer's thickness (Refract);
//            trails carry the color of the hand that made them.
//   Smoke  — the height field alone, lit, on black.
// The fluid runs on the CPU; Liquid's per-pixel refraction is a WebGL fragment shader.
// Gloss adds Blinn–Phong highlights (exponent 48) and a Schlick Fresnel rim, F0 = 0.02 (water).
(function () {
  var WRIST = 0, MIDDLE_MCP = 9;
  var N_WATER = 1.33, ITER = 16, LEVEL_LO = 0.18, LEVEL_HI = 0.42;
  // Capsules that fill the palm, on top of MediaPipe's bone connections.
  var PALM = [[0, 5], [0, 9], [0, 13], [0, 17], [1, 5], [5, 9], [9, 13], [13, 17], [2, 5]];
  var LIGHT = norm([-0.45, -0.65, 1]), HALF = norm([-0.45, -0.65, 2]);

  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  function smoothstep(a, b, x) { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }

  // Bilinear sample of field f (w×h) at cell coordinates (x, y), clamped to the edges.
  function sample(f, w, h, x, y) {
    if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
    var i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * w + i;
    return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + w] * (1 - fx) + f[k + w + 1] * fx) * fy;
  }

  // Separable box blur, radius r, of src into dst (tmp is scratch).
  function blur(src, dst, tmp, w, h, r) {
    var n = 2 * r + 1, x, y, s, k;
    for (y = 0; y < h; y++) {
      k = y * w; s = 0;
      for (x = -r; x <= r; x++) s += src[k + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp[k + x] = s / n;
        s += src[k + Math.min(w - 1, x + r + 1)] - src[k + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        dst[y * w + x] = s / n;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function createWisp() {
    var W = 0, H = 0, DC = 4, gw = 0, gh = 0, vw = 0, vh = 0;
    var u, v, u0, v0, pr, dv;                  // velocity grid (2 dye cells per velocity cell)
    var D, D0, R, G, B, R0, G0, B0, M, MU, MV;  // dye grid: density, premultiplied color, hand mask
    var Db, tmp;
    var small, sctx, smoke, smCtx, smImg;
    var prev = {}, vel = {}, lastT = null;

    function alloc(w, h) {
      W = w; H = h;
      DC = Math.max(2, Math.round(Math.max(w, h) / 256));
      gw = Math.ceil(w / DC); gh = Math.ceil(h / DC);
      vw = Math.ceil(gw / 2); vh = Math.ceil(gh / 2);
      var nv = vw * vh, nd = gw * gh;
      u = new Float32Array(nv); v = new Float32Array(nv); u0 = new Float32Array(nv); v0 = new Float32Array(nv);
      pr = new Float32Array(nv); dv = new Float32Array(nv);
      D = new Float32Array(nd); D0 = new Float32Array(nd); M = new Float32Array(nd);
      R = new Float32Array(nd); G = new Float32Array(nd); B = new Float32Array(nd);
      R0 = new Float32Array(nd); G0 = new Float32Array(nd); B0 = new Float32Array(nd);
      MU = new Float32Array(nd); MV = new Float32Array(nd);
      Db = new Float32Array(nd); tmp = new Float32Array(nd);
      small = canvas(gw, gh); sctx = small.getContext('2d', { willReadFrequently: true });
      smoke = canvas(gw, gh); smCtx = smoke.getContext('2d'); smImg = smCtx.createImageData(gw, gh);
      prev = {}; vel = {};
    }

    // A hand bone as a capsule of radius r (dye cells) from a to b, soft over one cell. Each cell
    // also takes the bone's velocity, interpolated along it, for the Flow force.
    function capsule(a, b, r, va, vb) {
      var ax = a.x / DC, ay = a.y / DC, bx = b.x / DC, by = b.y / DC;
      var i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), i1 = Math.min(gw - 1, Math.ceil(Math.max(ax, bx) + r + 1));
      var j0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), j1 = Math.min(gh - 1, Math.ceil(Math.max(ay, by) + r + 1));
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6;
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var px = i + 0.5 - ax, py = j + 0.5 - ay;
          var t = (px * dx + py * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var ex = px - t * dx, ey = py - t * dy;
          var m = r - Math.sqrt(ex * ex + ey * ey) + 0.5;
          if (m <= 0) continue;
          if (m > 1) m = 1;
          var k = j * gw + i;
          if (m > M[k]) {
            M[k] = m;
            MU[k] = va[0] + (vb[0] - va[0]) * t;
            MV[k] = va[1] + (vb[1] - va[1]) * t;
          }
        }
      }
    }

    function rasterHands(hands, details, dt) {
      M.fill(0);
      var bones = (Magi.tracking.connections && Magi.tracking.connections.hand) || [];
      var seen = {};
      hands.forEach(function (p, h) {
        var key = (details[h] && details[h].key) || 'hand' + h;
        seen[key] = true;
        // Landmark velocities in dye cells per second, eased so a repeated detection doesn't
        // read as a stop.
        var last = prev[key], vk = vel[key] || (vel[key] = p.map(function () { return [0, 0]; }));
        p.forEach(function (q, i) {
          var rx = last ? (q.x - last[i].x) / dt / DC : 0, ry = last ? (q.y - last[i].y) / dt / DC : 0;
          var cap = 900 / DC;
          rx = Math.max(-cap, Math.min(cap, rx)); ry = Math.max(-cap, Math.min(cap, ry));
          vk[i][0] += (rx - vk[i][0]) * 0.5;
          vk[i][1] += (ry - vk[i][1]) * 0.5;
        });
        prev[key] = p.map(function (q) { return { x: q.x, y: q.y }; });
        var palm = Math.hypot(p[MIDDLE_MCP].x - p[WRIST].x, p[MIDDLE_MCP].y - p[WRIST].y);
        var rf = palm * 0.11 / DC, rp = palm * 0.2 / DC;
        bones.forEach(function (c) { capsule(p[c.start], p[c.end], rf, vk[c.start], vk[c.end]); });
        PALM.forEach(function (c) { capsule(p[c[0]], p[c[1]], rp, vk[c[0]], vk[c[1]]); });
      });
      Object.keys(prev).forEach(function (k) { if (!seen[k]) { delete prev[k]; delete vel[k]; } });
    }

    function step(dt, t, params, cam) {
      var i, j, k, x, y;
      var flow = params.flow / 100, swirl = params.swirl / 100 * 160, drip = params.drip / 100 * 260;

      // 1. Forces. Curl noise: ψ = Σ sin(a·x + φ)·sin(a·y + φ′), force = (∂ψ/∂y, −∂ψ/∂x).
      var a1 = 2 * Math.PI / (vw / 3.1), a2 = 2 * Math.PI / (vw / 7.3);
      var sx1 = new Float32Array(vw), cx1 = new Float32Array(vw), sx2 = new Float32Array(vw), cx2 = new Float32Array(vw);
      var sy1 = new Float32Array(vh), cy1 = new Float32Array(vh), sy2 = new Float32Array(vh), cy2 = new Float32Array(vh);
      for (i = 0; i < vw; i++) {
        sx1[i] = Math.sin(a1 * i + t * 0.7); cx1[i] = Math.cos(a1 * i + t * 0.7);
        sx2[i] = Math.sin(a2 * i - t * 1.3); cx2[i] = Math.cos(a2 * i - t * 1.3);
      }
      for (j = 0; j < vh; j++) {
        sy1[j] = Math.sin(a1 * j - t * 0.5); cy1[j] = Math.cos(a1 * j - t * 0.5);
        sy2[j] = Math.sin(a2 * j + t * 1.1); cy2[j] = Math.cos(a2 * j + t * 1.1);
      }
      var damp = Math.exp(-dt * 1.2);
      for (j = 0; j < vh; j++) {
        for (i = 0; i < vw; i++) {
          k = j * vw + i;
          // The four dye cells under this velocity cell.
          var di = Math.min(2 * i, gw - 2), dj = Math.min(2 * j, gh - 2), d = dj * gw + di;
          var m = (M[d] + M[d + 1] + M[d + gw] + M[d + gw + 1]) / 4;
          var rho = (D[d] + D[d + 1] + D[d + gw] + D[d + gw + 1]) / 4;
          var fu = swirl * (sx1[i] * cy1[j] + 0.5 * sx2[i] * cy2[j]);
          var fv = -swirl * (cx1[i] * sy1[j] + 0.5 * cx2[i] * sy2[j]) + drip * rho * (1 - m);
          u[k] = u[k] * damp + fu * dt;
          v[k] = v[k] * damp + fv * dt;
          if (m > 0) {
            var ms = m * 4;
            var mu = (M[d] * MU[d] + M[d + 1] * MU[d + 1] + M[d + gw] * MU[d + gw] + M[d + gw + 1] * MU[d + gw + 1]) / ms;
            var mv = (M[d] * MV[d] + M[d + 1] * MV[d + 1] + M[d + gw] * MV[d + gw] + M[d + gw + 1] * MV[d + gw + 1]) / ms;
            var w = m * flow;
            u[k] += (mu - u[k]) * w;
            v[k] += (mv - v[k]) * w;
          }
        }
      }

      // 2. Advect velocity. Velocities are in dye cells per second; a velocity cell is two.
      u0.set(u); v0.set(v);
      var h = dt / 2;
      for (j = 0; j < vh; j++) {
        for (i = 0; i < vw; i++) {
          k = j * vw + i;
          x = i - u0[k] * h; y = j - v0[k] * h;
          u[k] = sample(u0, vw, vh, x, y);
          v[k] = sample(v0, vw, vh, x, y);
        }
      }

      // 3. Project: ∇²p = ∇·u, u −= ∇p, with no flow through the frame's edges.
      for (i = 0; i < vw; i++) { u[i] = v[i] = 0; k = (vh - 1) * vw + i; u[k] = v[k] = 0; }
      for (j = 0; j < vh; j++) { k = j * vw; u[k] = v[k] = 0; u[k + vw - 1] = v[k + vw - 1] = 0; }
      pr.fill(0);
      for (j = 1; j < vh - 1; j++) {
        for (i = 1; i < vw - 1; i++) {
          k = j * vw + i;
          dv[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + vw] - v[k - vw]);
        }
      }
      for (var it = 0; it < ITER; it++) {
        for (j = 1; j < vh - 1; j++) {
          for (i = 1; i < vw - 1; i++) {
            k = j * vw + i;
            pr[k] = (dv[k] + pr[k - 1] + pr[k + 1] + pr[k - vw] + pr[k + vw]) / 4;
          }
        }
      }
      for (j = 1; j < vh - 1; j++) {
        for (i = 1; i < vw - 1; i++) {
          k = j * vw + i;
          u[k] -= 0.5 * (pr[k + 1] - pr[k - 1]);
          v[k] -= 0.5 * (pr[k + vw] - pr[k - vw]);
        }
      }

      // 4. Advect dye and its color, then decay. Half-life 0.15 s (Trail 0) to 4.8 s (Trail 100).
      var decay = Math.pow(2, -dt / (0.15 * Math.pow(2, params.trail / 20)));
      D0.set(D); R0.set(R); G0.set(G); B0.set(B);
      for (j = 0; j < gh; j++) {
        for (i = 0; i < gw; i++) {
          k = j * gw + i;
          var cx = (i - 0.5) / 2, cy = (j - 0.5) / 2;
          x = i - sample(u, vw, vh, cx, cy) * dt;
          y = j - sample(v, vw, vh, cx, cy) * dt;
          // One set of bilinear weights for density and color.
          if (x < 0) x = 0; else if (x > gw - 1.001) x = gw - 1.001;
          if (y < 0) y = 0; else if (y > gh - 1.001) y = gh - 1.001;
          var xi = x | 0, yj = y | 0, fx = x - xi, fy = y - yj, s0 = yj * gw + xi;
          var w00 = (1 - fx) * (1 - fy) * decay, w10 = fx * (1 - fy) * decay, w01 = (1 - fx) * fy * decay, w11 = fx * fy * decay;
          var s1 = s0 + 1, s2 = s0 + gw, s3 = s2 + 1;
          D[k] = D0[s0] * w00 + D0[s1] * w10 + D0[s2] * w01 + D0[s3] * w11;
          R[k] = R0[s0] * w00 + R0[s1] * w10 + R0[s2] * w01 + R0[s3] * w11;
          G[k] = G0[s0] * w00 + G0[s1] * w10 + G0[s2] * w01 + G0[s3] * w11;
          B[k] = B0[s0] * w00 + B0[s1] * w10 + B0[s2] * w01 + B0[s3] * w11;
        }
      }

      // 5. The hands are the source: ρ = max(ρ, mask), color moves toward the hand's own.
      for (k = 0; k < gw * gh; k++) {
        var mk = M[k];
        if (mk <= 0) continue;
        var o = k * 4, cr = cam[o] / 255, cg = cam[o + 1] / 255, cb = cam[o + 2] / 255;
        var dk = D[k], nr = cr, ng = cg, nb = cb;
        if (dk > 1e-4) { nr = R[k] / dk; ng = G[k] / dk; nb = B[k] / dk; }
        nr += (cr - nr) * mk; ng += (cg - ng) * mk; nb += (cb - nb) * mk;
        var nd = dk > mk ? dk : mk;
        D[k] = nd; R[k] = nr * nd; G[k] = ng * nd; B[k] = nb * nd;
      }
      blur(D, Db, tmp, gw, gh, 2);
      blur(Db, Db, tmp, gw, gh, 1);
    }

    // Liquid runs on the GPU: one fragment shader per pixel reads the height field (bilinear),
    // takes its gradient, refracts the camera, mixes in the trail color and adds the highlights.
    var FRAG = [
      'precision highp float;',
      'uniform sampler2D cam, field, dye;',
      'uniform vec2 fieldScale, texel, size;',
      'uniform float shift, k, gloss, lo, hi;',
      'uniform vec3 halfVec;',
      'varying vec2 uv;',
      'void main() {',
      '  vec2 f = uv * fieldScale;',
      '  vec4 here = texture2D(field, f);',
      '  float s = smoothstep(lo, hi, here.r);',
      '  if (s <= 0.0) { gl_FragColor = texture2D(cam, uv); return; }',
      // Central differences of the blurred density, one cell apart.
      '  float gx = texture2D(field, f + vec2(texel.x, 0.0)).r - texture2D(field, f - vec2(texel.x, 0.0)).r;',
      '  float gy = texture2D(field, f + vec2(0.0, texel.y)).r - texture2D(field, f - vec2(0.0, texel.y)).r;',
      // Δ = −(1 − 1/n)·H·∇h, in pixels, only inside the liquid's edge.
      '  vec2 d = -shift * vec2(gx, gy) * s;',
      '  vec3 col = texture2D(cam, clamp(uv + d / size, 0.0, 1.0)).rgb;',
      '  col = mix(col, texture2D(dye, f).rgb, s * (1.0 - here.g));',
      // Surface normal n ∝ (−∂h/∂x, −∂h/∂y, 1) with ∇h = −Δ / ((1 − 1/n)·H).
      '  vec3 n = normalize(vec3(d / k, 1.0));',
      '  float spec = pow(max(0.0, dot(n, halfVec)), 48.0);',
      '  float fres = pow(1.0 - n.z, 5.0) * 0.98;',
      '  col += (1.0 - col) * clamp(spec * 0.85 + fres * 0.9, 0.0, 1.0) * gloss;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
    var pass, fieldBytes = null, dyeBytes = null;

    function renderLiquid(ctx, frame, params) {
      if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, ['cam', 'field', 'dye']);
      frame.draw(ctx, W, H);
      if (!pass) return renderSmoke(ctx, params, true);
      var n = gw * gh;
      if (!fieldBytes || fieldBytes.length !== n * 4) { fieldBytes = new Uint8Array(n * 4); dyeBytes = new Uint8Array(n * 4); }
      var any = false;
      for (var k = 0; k < n; k++) {
        var o = k * 4, d = Db[k], dk = D[k] > 1e-4 ? D[k] : 1;
        if (d > LEVEL_LO) any = true;
        fieldBytes[o] = Math.min(255, d * 255); fieldBytes[o + 1] = M[k] * 255; fieldBytes[o + 3] = 255;
        dyeBytes[o] = Math.min(255, R[k] / dk * 255); dyeBytes[o + 1] = Math.min(255, G[k] / dk * 255);
        dyeBytes[o + 2] = Math.min(255, B[k] / dk * 255); dyeBytes[o + 3] = 255;
      }
      if (!any) return;
      pass.texture('cam', ctx.canvas);
      pass.data('field', gw, gh, fieldBytes);
      pass.data('dye', gw, gh, dyeBytes);
      var Hpx = params.refract / 100 * 60, kk = (1 - 1 / N_WATER) * Hpx;
      pass.run(W, H, {
        fieldScale: [W / (gw * DC), H / (gh * DC)],
        texel: [1 / gw, 1 / gh],
        size: [W, H],
        // ∇h per pixel is H·Δρ / (2·DC) for the one-cell central difference above.
        shift: kk * Hpx / (2 * DC),
        k: Math.max(1e-3, kk),
        gloss: params.gloss && Hpx > 0 ? 1 : 0,
        lo: LEVEL_LO,
        hi: LEVEL_HI,
        halfVec: HALF
      });
      ctx.drawImage(pass.canvas, 0, 0);
    }

    // The height field alone on black: a soft body, lit from the top left.
    // Also the fallback for Liquid where WebGL is unavailable (overlay: keep the camera beneath).
    function renderSmoke(ctx, params, overlay) {
      var d = smImg.data, ink = Magi.fx.inkColor(params.color);
      for (var j = 0; j < gh; j++) {
        for (var i = 0; i < gw; i++) {
          var k = j * gw + i, o = k * 4, h = Db[k];
          var body = smoothstep(0.04, 0.55, h);
          var val = 0;
          if (body > 0) {
            var gx = (Db[k + (i < gw - 1 ? 1 : 0)] - Db[k - (i > 0 ? 1 : 0)]) * 6;
            var gy = (Db[k + (j < gh - 1 ? gw : 0)] - Db[k - (j > 0 ? gw : 0)]) * 6;
            var l = Math.sqrt(gx * gx + gy * gy + 1), nx = -gx / l, ny = -gy / l, nz = 1 / l;
            var diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
            // Thicker liquid reads brighter, so fresh hands stand out from old trails.
            val = body * (0.25 + 0.6 * diff) * (0.5 + 0.5 * Math.min(1, h * 1.4));
            if (params.gloss) {
              val += body * 0.9 * Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 48);
              val += body * 0.8 * Math.pow(1 - nz, 5);
            }
          }
          val = Math.min(1, val) * 255;
          d[o] = val * ink[0]; d[o + 1] = val * ink[1]; d[o + 2] = val * ink[2]; d[o + 3] = overlay ? val : 255;
        }
      }
      smCtx.putImageData(smImg, 0, 0);
      if (!overlay) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(smoke, 0, 0, gw * DC, gh * DC);
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        if (out.width !== frame.width || out.height !== frame.height) { out.width = frame.width; out.height = frame.height; }
        if (frame.width !== W || frame.height !== H) alloc(frame.width, frame.height);
        var ctx = out.getContext('2d');
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame);
        var t = frame.time / 1000;
        var dt = lastT === null ? 1 / 30 : Math.max(1 / 120, Math.min(1 / 15, t - lastT));
        lastT = t;

        frame.draw(sctx, gw, gh);
        var cam = sctx.getImageData(0, 0, gw, gh).data;
        rasterHands(hands, tracker.details(), dt);
        step(dt, t, params, cam);

        if (params.mode === 'smoke') renderSmoke(ctx, params);
        else renderLiquid(ctx, frame, params);

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and move it.');
      },
      reset: function () {
        W = H = 0;
        lastT = null;
      }
    };
  }

  Magi.renderers.wisp = createWisp;
})();
