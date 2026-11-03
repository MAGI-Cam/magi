// Wisp: moving your fingers stirs the video like smoke. The picture itself swirls, drags and curls
// where your hand passed, then settles back.
//
// Fluid: Stam, "Stable Fluids" (SIGGRAPH 1999), run as WebGL2 shaders on half-float textures at a
// quarter of the frame. Each frame:
//   1. forces — the fluid under a moving hand takes its velocity (Flow); curl noise (the curl of a
//      stream function, divergence-free) stirs wherever the fluid is active (Swirl); the active
//      fluid rises like warm smoke (Rise);
//   2. vorticity confinement (Fedkiw, Stam & Jensen 2001): the curl ω = ∂v/∂x − ∂u/∂y is measured
//      and a force ε·(N × ω), N = ∇|ω| / |∇|ω||, pushes the flow back around its own eddies, so
//      fine curls survive instead of blurring away;
//   3. projection: Jacobi iterations solve ∇²p = ∇·v and v −= ∇p, so the flow is incompressible;
//   4. semi-Lagrangian advection of the velocity, u(x) ← u(x − u·dt).
// Activity is a smoke density: each hand bone adds it in proportion to its own speed (0.6 frame
// heights per second → full), it moves with the flow and fades with a half-life (Trail). Swirl and
// Rise act only where there is activity, so the rest of the picture stays still.
//
// Distortion: a map C(x) of where each pixel's image comes from, carried by the flow. Advecting
// C(x) ← C(x − v·dt) as a texture of coordinates is the standard fluid image warp; stored as an
// offset D = C − x, one step is D(x) ← D(x − v·dt) − v·dt. The offset then relaxes toward zero
// with the same half-life, so the video settles back; while you pinch it relaxes in 0.12 s and the
// flow is damped, sucking the picture back to normal. The output is the live camera sampled at C.
(function () {
  var WRIST = 0, MIDDLE_MCP = 9;
  // Capsules that fill the palm, on top of MediaPipe's bone connections.
  var PALM = [[0, 5], [0, 9], [0, 13], [0, 17], [1, 5], [5, 9], [9, 13], [13, 17], [2, 5]];

  var VS = '#version 300 es\nin vec2 p; uniform vec2 texel; out vec2 uv, vL, vR, vT, vB;\n' +
    'void main() { uv = p * 0.5 + 0.5; vL = uv - vec2(texel.x, 0.0); vR = uv + vec2(texel.x, 0.0); ' +
    'vT = uv + vec2(0.0, texel.y); vB = uv - vec2(0.0, texel.y); gl_Position = vec4(p, 0.0, 1.0); }';
  var HEAD = '#version 300 es\nprecision highp float;\nin vec2 uv, vL, vR, vT, vB;\nout vec4 o;\n';
  var FS = {
    // Hand drag, curl-noise swirl (ψ = sin·sin, force = (∂ψ/∂y, −∂ψ/∂x)) and buoyant rise, both
    // scaled by the local activity.
    force: 'uniform sampler2D vel, mask, act; uniform vec2 size; uniform float flow, dt, swirl, rise, t, damp;\n' +
      'void main() { vec2 v = texture(vel, uv).xy; vec4 m = texture(mask, uv); float a = texture(act, uv).x;\n' +
      '  v = mix(v, m.yz, clamp(m.w * flow, 0.0, 1.0));\n' +
      '  vec2 q = uv * size; float a1 = 6.2832 / (size.x / 3.1), a2 = 6.2832 / (size.x / 7.3);\n' +
      '  vec2 f = swirl * vec2(sin(a1 * q.x + t * 0.7) * cos(a1 * q.y - t * 0.5) + 0.5 * sin(a2 * q.x - t * 1.3) * cos(a2 * q.y + t * 1.1),\n' +
      '    -(cos(a1 * q.x + t * 0.7) * sin(a1 * q.y - t * 0.5) + 0.5 * cos(a2 * q.x - t * 1.3) * sin(a2 * q.y + t * 1.1)));\n' +
      '  f.y += rise;\n' +
      '  o = vec4((v + f * a * dt) * damp, 0.0, 1.0); }',
    // Activity: the larger of what's there and what the hands add now.
    emit: 'uniform sampler2D act, mask;\nvoid main() { o = vec4(max(texture(act, uv).x, texture(mask, uv).x), 0.0, 0.0, 1.0); }',
    curl: 'uniform sampler2D vel;\n' +
      'void main() { float L = texture(vel, vL).y, R = texture(vel, vR).y, T = texture(vel, vT).x, B = texture(vel, vB).x;\n' +
      '  o = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0); }',
    vorticity: 'uniform sampler2D vel, curl; uniform float strength, dt;\n' +
      'void main() { float L = texture(curl, vL).x, R = texture(curl, vR).x, T = texture(curl, vT).x, B = texture(curl, vB).x, C = texture(curl, uv).x;\n' +
      '  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); f /= length(f) + 1e-4; f *= strength * C; f.y *= -1.0;\n' +
      '  o = vec4(texture(vel, uv).xy + f * dt, 0.0, 1.0); }',
    // Divergence with solid walls: outside the frame the normal velocity is reflected.
    divergence: 'uniform sampler2D vel;\n' +
      'void main() { vec2 C = texture(vel, uv).xy; float L = texture(vel, vL).x, R = texture(vel, vR).x, T = texture(vel, vT).y, B = texture(vel, vB).y;\n' +
      '  if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;\n' +
      '  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0); }',
    scale: 'uniform sampler2D src; uniform float k;\nvoid main() { o = texture(src, uv) * k; }',
    pressure: 'uniform sampler2D pr, dv;\n' +
      'void main() { o = vec4((texture(pr, vL).x + texture(pr, vR).x + texture(pr, vB).x + texture(pr, vT).x - texture(dv, uv).x) * 0.25, 0.0, 0.0, 1.0); }',
    gradient: 'uniform sampler2D vel, pr;\n' +
      'void main() { o = vec4(texture(vel, uv).xy - 0.5 * vec2(texture(pr, vR).x - texture(pr, vL).x, texture(pr, vT).x - texture(pr, vB).x), 0.0, 1.0); }',
    // Semi-Lagrangian advection: look back along the velocity, then fade.
    advect: 'uniform sampler2D vel, src; uniform vec2 velTexel; uniform float dt, keep;\n' +
      'void main() { vec2 back = uv - dt * texture(vel, uv).xy * velTexel; o = keep * texture(src, back); }',
    // The image map: D(x) ← D(x − v·dt) − v·dt, then relaxed toward zero.
    warp: 'uniform sampler2D vel, map; uniform vec2 velTexel; uniform float dt, keep;\n' +
      'void main() { vec2 st = dt * texture(vel, uv).xy * velTexel; o = vec4((texture(map, uv - st).xy - st) * keep, 0.0, 1.0); }',
    show: 'uniform sampler2D cam, map;\nvoid main() { o = vec4(texture(cam, clamp(uv + texture(map, uv).xy, 0.0, 1.0)).rgb, 1.0); }'
  };

  function createWisp() {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: false });
    var ok = !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    var progs = {};
    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('Magi wisp shader:', gl.getShaderInfoLog(sh));
      return sh;
    }
    if (ok) {
      var vs = compile(gl.VERTEX_SHADER, VS);
      Object.keys(FS).forEach(function (name) {
        var pr = gl.createProgram();
        gl.attachShader(pr, vs);
        gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, HEAD + FS[name]));
        gl.bindAttribLocation(pr, 0, 'p');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) ok = false;
        progs[name] = { p: pr, u: {} };
      });
    }
    if (ok) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    function texture(w, h, internal, format, type) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      return t;
    }
    function target(w, h) {
      var t = texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT), f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex: t, fbo: f, w: w, h: h };
    }
    function pair(w, h) {
      return { read: target(w, h), write: target(w, h), swap: function () { var x = this.read; this.read = this.write; this.write = x; } };
    }
    // Runs a program into `out` (null: the canvas). Uniforms: numbers, [x, y], or textures.
    function run(name, values, out, texel) {
      var pr = progs[name], unit = 0;
      gl.useProgram(pr.p);
      function loc(n) { return n in pr.u ? pr.u[n] : (pr.u[n] = gl.getUniformLocation(pr.p, n)); }
      gl.uniform2f(loc('texel'), texel[0], texel[1]);
      Object.keys(values).forEach(function (n) {
        var v = values[n], l = loc(n);
        if (v && (v.tex || v instanceof WebGLTexture)) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v.tex || v);
          gl.uniform1i(l, unit++);
        } else if (typeof v === 'number') gl.uniform1f(l, v);
        else gl.uniform2f(l, v[0], v[1]);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    var W = 0, H = 0, sw, sh, vel, act, map, prs, div, curl, camTex, maskTex, mask, lastHands = null, prev = {}, lastT = null;
    function alloc(w, h) {
      W = w; H = h;
      sw = Math.max(32, Math.round(w / 4)); sh = Math.max(32, Math.round(h / 4));
      vel = pair(sw, sh); act = pair(sw, sh); map = pair(Math.round(w / 2), Math.round(h / 2));
      prs = pair(sw, sh); div = target(sw, sh); curl = target(sw, sh);
      camTex = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      maskTex = texture(sw, sh, gl.RGBA16F, gl.RGBA, gl.FLOAT);
      mask = new Float32Array(sw * sh * 4);
      canvas.width = w; canvas.height = h;
      prev = {};
    }

    // Hand bones as capsules on the velocity grid, rows bottom-up for GL. Each cell gets
    // x = activity to add (coverage × the bone's speed, 0.6 frame heights per second → full),
    // y, z = the bone's velocity in texels per second (y up), w = coverage (for Flow).
    function raster(hands, details, dt) {
      mask.fill(0);
      var bones = (Magi.tracking.connections && Magi.tracking.connections.hand) || [];
      var cell = W / sw, seen = {};
      hands.forEach(function (p, hi) {
        var key = (details[hi] && details[hi].key) || 'hand' + hi, last = prev[key];
        seen[key] = true;
        var vk = p.map(function (q, i) {
          return last && dt > 0 ? [(q.x - last[i].x) / dt / cell, -(q.y - last[i].y) / dt / cell] : [0, 0];
        });
        prev[key] = p.map(function (q) { return { x: q.x, y: q.y }; });
        var palm = Math.hypot(p[MIDDLE_MCP].x - p[WRIST].x, p[MIDDLE_MCP].y - p[WRIST].y);
        function cap(ia, ib, r, weight) {
          var a = p[ia], b = p[ib], ax = a.x / cell, ay = sh - a.y / cell, bx = b.x / cell, by = sh - b.y / cell;
          var va = vk[ia], vb = vk[ib];
          var i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), i1 = Math.min(sw - 1, Math.ceil(Math.max(ax, bx) + r + 1));
          var j0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), j1 = Math.min(sh - 1, Math.ceil(Math.max(ay, by) + r + 1));
          var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6;
          for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
            var px = i + 0.5 - ax, py = j + 0.5 - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
            var ex = px - t * dx, ey = py - t * dy, m = Math.min(1, r - Math.sqrt(ex * ex + ey * ey) + 0.5);
            if (m <= 0) continue;
            var o = (j * sw + i) * 4;
            if (m < mask[o + 3]) continue;
            var vx = va[0] + (vb[0] - va[0]) * t, vy = va[1] + (vb[1] - va[1]) * t;
            var speed = Math.hypot(vx, vy) * cell / H;
            mask[o] = m * weight * Math.min(1, speed / 0.6); mask[o + 1] = vx; mask[o + 2] = vy; mask[o + 3] = m;
          }
        }
        bones.forEach(function (c) { cap(c.start, c.end, palm * 0.11 / cell, 1); });
        PALM.forEach(function (c) { cap(c[0], c[1], palm * 0.2 / cell, 0.4); });
      });
      Object.keys(prev).forEach(function (k) { if (!seen[k]) delete prev[k]; });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        if (out.width !== frame.width || out.height !== frame.height) { out.width = frame.width; out.height = frame.height; }
        var ctx = out.getContext('2d');
        if (!ok) { frame.draw(ctx, frame.width, frame.height); frame.say('Wisp needs WebGL2, which this browser doesn’t offer.'); return; }
        if (frame.width !== W || frame.height !== H) alloc(frame.width, frame.height);
        frame.draw(ctx, W, H);
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), t = frame.time / 1000;
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 120, Math.min(1 / 30, t - lastT));
        lastT = t;
        // The hands' mask changes only with a new camera frame; motion is measured between them.
        if (hands !== lastHands) {
          raster(hands, tracker.details(), lastHands && lastHands.t ? t - lastHands.t : 0);
          lastHands = hands; lastHands.t = t;
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, sh, 0, gl.RGBA, gl.FLOAT, mask);
        }
        gl.bindTexture(gl.TEXTURE_2D, camTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, out);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

        // Pinch: the stirred picture is drawn back to normal quickly (0.12 s half-life) and the flow
        // is damped, as if sucked back up.
        var sucking = Magi.interaction.read(frame).hands.some(function (h) { return h.pinched; });
        var vt = [1 / sw, 1 / sh], keep = Math.pow(2, -dt / (sucking ? 0.12 : 0.15 * Math.pow(2, params.trail / 20)));
        run('emit', { act: act.read, mask: maskTex }, act.write, vt); act.swap();
        run('force', { vel: vel.read, mask: maskTex, act: act.read, size: [sw, sh], flow: params.flow / 100, dt: dt,
          swirl: params.swirl / 100 * 220, rise: params.rise / 100 * 160, t: t, damp: Math.exp(-dt * (sucking ? 8 : 0.8)) }, vel.write, vt);
        vel.swap();
        run('curl', { vel: vel.read }, curl, vt);
        run('vorticity', { vel: vel.read, curl: curl, strength: 10 + params.swirl * 0.35, dt: dt }, vel.write, vt);
        vel.swap();
        run('divergence', { vel: vel.read }, div, vt);
        run('scale', { src: prs.read, k: 0.8 }, prs.write, vt);
        prs.swap();
        for (var i = 0; i < 20; i++) { run('pressure', { pr: prs.read, dv: div }, prs.write, vt); prs.swap(); }
        run('gradient', { vel: vel.read, pr: prs.read }, vel.write, vt);
        vel.swap();
        run('advect', { vel: vel.read, src: vel.read, velTexel: vt, dt: dt, keep: 1 }, vel.write, vt);
        vel.swap();
        run('advect', { vel: vel.read, src: act.read, velTexel: vt, dt: dt, keep: keep }, act.write, vt);
        act.swap();
        run('warp', { vel: vel.read, map: map.read, velTexel: vt, dt: dt, keep: keep }, map.write, [1 / map.read.w, 1 / map.read.h]);
        map.swap();
        run('show', { cam: camTex, map: map.read }, null, [1 / W, 1 / H]);
        ctx.drawImage(canvas, 0, 0);

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and move your fingers through the picture.');
      },
      reset: function () {
        if (!ok || !W) return;
        [vel.read, vel.write, act.read, act.write, map.read, map.write, prs.read, prs.write].forEach(function (tg) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fbo);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        });
        prev = {}; lastHands = null; lastT = null;
      }
    };
  }

  Magi.renderers.wisp = createWisp;
})();
