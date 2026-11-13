// Polar: a ball of fur — tens of thousands of short, fine, straight strands combed into locks —
// that breathes, rolls and twists round a pole, in perspective (after a reference of
// a "polar coordinates" fur study in TouchDesigner).
//
// Every strand is computed on the GPU each frame from its own fixed random numbers, so the fur is
// coherent and moves smoothly:
//   Root: a direction û on the unit sphere and a depth ρ ∈ [0, 1], placed at û·ρ^0.42·R(û, t). The
//     outline is a radius in polar (spherical) coordinates, R(û, t) = R₀(1 + 0.35·n(1.3û, t) +
//     0.15·n(3.1û, −t)) with n simplex noise (Gustavson's 3D simplex), so the ball's edge ripples
//     and its shape slowly changes; ρ^0.42 spreads them through the volume, a little denser inside.
//   Direction: a 3D field d = (n(q), n(q + a), n(q + b)), q the root scaled by Comb and drifting in
//     time: neighboring strands point alike, so they read as combed locks of hair. Twist blends d
//     toward the circle around the pole's axis, ŷ × p (azimuthal in polar coordinates about it).
//   The strand: a segment of length ∝ Length through its root along d, its root swaying with the
//     noise (Turbulence).
// Drawing: segments added as light, then a soft halo (the same picture at a quarter size, scaled
// up). The view is a perspective camera 3.2 units from the ball's plane: k = f/(f + z), so the near
// side of the ball is drawn larger than the far side.
// Color: white strands tinted by two colors that blend by a slow noise across the ball; Color 0
// drifts through lilac, teal and white, or pick one.
//
// Gesture: your hand is the pole. The ball sits at your palm. A fist packs it small and dense; an
// open hand lets it swell and the strands fly (the outline ripples harder). Roll your wrist to twist
// the fur round the pole (either way). Pinch and drag to spin the ball; it coasts when you let go.
// Two hands: the ball sits between them and grows as they move apart. No hand: it
// rolls slowly in the middle.
(function () {
  var NOISE = [
    // Simplex noise 3D (Stefan Gustavson, Ian McEwan; MIT), returns about −1…1.
    'vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }',
    'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
    'float snoise(vec3 v) {',
    '  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
    '  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);',
    '  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);',
    '  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;',
    '  i = mod(i, 289.0);',
    '  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
    '  float n_ = 1.0 / 7.0; vec3 ns = n_ * D.wyz - D.xzx;',
    '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);',
    '  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);',
    '  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);',
    '  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));',
    '  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;',
    '  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);',
    '  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));',
    '  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;',
    '  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;',
    '  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));',
    '}'
  ].join('\n');

  var VS = [
    '#version 300 es',
    'precision highp float;',
    'uniform float time, len, R, turb, comb, twist, ripple, focal, aspect, alpha;',
    'uniform vec3 center, colA, colB;',
    'uniform mat3 view;',
    'out vec3 vC;',
    NOISE,
    // Integer hash (lowbias32, Chris Wellons): every strand gets its own independent random
    // numbers. (fract(sin(n)·43758) loses precision past a few thousand strands, so many shared
    // the same numbers and stacked into a few bright spikes.)
    'uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }',
    'uint SID;',
    'float h(float k) { return float(hu(SID * 16u + uint(k * 100.0))) / 4294967295.0; }',
    'void main() {',
    '  int sid = gl_VertexID / 2; float end = float(gl_VertexID - sid * 2), fi = 0.0; SID = uint(sid);',
    '  float z = h(fi) * 2.0 - 1.0, a = h(fi + 0.13) * 6.2831853, rs = sqrt(max(0.0, 1.0 - z * z));',
    '  vec3 u = vec3(rs * cos(a), z, rs * sin(a));',
    '  float bound = R * (1.0 + ripple * (0.35 * snoise(u * 1.3 + vec3(0.0, 0.0, time * 0.15)) + 0.15 * snoise(u * 3.1 - vec3(time * 0.1))));',
    '  vec3 p = u * pow(h(fi + 0.29), 0.42) * bound;',
    '  vec3 q = p / R * comb + vec3(0.0, 0.0, time * 0.12);',
    '  vec3 d = vec3(snoise(q), snoise(q + vec3(31.4, 0.0, 0.0)), snoise(q + vec3(0.0, 47.2, 0.0))) + 1e-4;',
    '  vec3 tw = cross(vec3(0.0, 1.0, 0.0), p) + 1e-4;',
    '  d = normalize(mix(normalize(d), normalize(tw) * sign(twist + 1e-6), clamp(abs(twist), 0.0, 0.95)));',
    '  p += d * turb * 0.12 * R * snoise(q * 0.5 + vec3(time * 0.3));',
    '  float L = len * R * (0.4 + h(fi + 0.41));',
    '  vec3 w = view * (p + d * L * (end - 0.5)) + center;',
    '  float kp = focal / max(0.05, focal + w.z);',
    '  gl_Position = vec4(w.x * kp / aspect, w.y * kp, 0.0, 1.0);',
    '  float m = 0.5 + 0.5 * snoise(p / R * 0.8 + vec3(time * 0.05));',
    '  vec3 c = mix(vec3(1.0), mix(colA, colB, m), 0.25 + 0.6 * h(fi + 0.53));',
    '  vC = c * alpha * (0.5 + 0.5 * h(fi + 0.67)) * (0.75 + 0.5 * (1.0 - length(p) / max(R, 1e-3)));',
    '}'
  ].join('\n');
  var FS = '#version 300 es\nprecision highp float; in vec3 vC; out vec4 o; void main() { o = vec4(vC, 1.0); }';

  var DRIFT = [[[0.78, 0.6, 1.0], [0.55, 0.95, 0.9]], [[0.6, 0.95, 0.9], [1.0, 1.0, 1.0]], [[0.75, 0.42, 1.0], [0.85, 0.75, 1.0]], [[0.6, 0.78, 1.0], [0.9, 0.6, 1.0]]];
  var FOCAL = 3.2;
  function toWorld(q, W, H) { var a = W / H; return [(q.x / W * 2 - 1) * a, 1 - q.y / H * 2, 0]; }
  function openness(h) { var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0); return Math.max(0, Math.min(1, (o - 0.25) / 0.6)); }

  function createGL() {
    var c = document.createElement('canvas'), gl = c.getContext('webgl2', { premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('Magi polar:', gl.getShaderInfoLog(s)); return s; }
    var pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    var vao = gl.createVertexArray(), loc = {};
    function U(n) { return n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(pr, n)); }
    return {
      canvas: c,
      draw: function (w, h, n, u) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(pr); gl.bindVertexArray(vao);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        Object.keys(u).forEach(function (k) {
          var v = u[k], l = U(k);
          if (typeof v === 'number') gl.uniform1f(l, v);
          else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
          else gl.uniform3f(l, v[0], v[1], v[2]);
        });
        gl.drawArrays(gl.LINES, 0, n * 2);
      }
    };
  }

  Magi.renderers.polar = function () {
    var g, lastT = null, S = { c: [0, 0, 0], open: 0.5, twist: 0, span: 1 }, spin = { yaw: 0, pitch: 0.3, vy: 0.15, vp: 0 }, grab = null;
    var halo = document.createElement('canvas'), hctx = halo.getContext('2d');
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (g === undefined) g = createGL();
        if (!g) { frame.say('This effect needs WebGL2, which this browser doesn’t offer.'); return; }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 20, t - lastT)); lastT = t;
        var ix = Magi.interaction.read(frame), hands = ix.hands.slice(0, 2), hd = hands[0];

        var T = { c: [0, 0, 0], open: 0.45, twist: 0, span: 1 };
        if (hands.length === 2) {
          var a = toWorld(hands[0].center, W, H), b = toWorld(hands[1].center, W, H);
          var d = Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) / W;
          // Two hands: the ball sits between them and grows as they move apart (0.6× to 1.8×).
          T.span = 0.6 + 1.2 * Math.max(0, Math.min(1, (d - 0.15) / 0.6));
          T.c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
          T.open = (openness(hands[0]) + openness(hands[1])) / 2;
          T.twist = ((hands[0].rotation || 0) + (hands[1].rotation || 0)) / 2 / 50;
        } else if (hd) {
          T.c = toWorld(hd.center, W, H); T.open = hd.fist ? 0 : openness(hd); T.twist = (hd.rotation || 0) / 50;
        }
        var e = 1 - Math.exp(-dt / 0.3);
        S.c = S.c.map(function (v, i) { return v + (T.c[i] - v) * e; });
        S.open += (T.open - S.open) * e;
        S.twist += (Math.max(-1, Math.min(1, T.twist)) - S.twist) * e;
        S.span += (T.span - S.span) * e;

        // Pinch and drag: spin the ball (trackball); it coasts and slows when released.
        var pin = hands.filter(function (h) { return h.pinched; })[0];
        if (pin) {
          var pm = { x: (pin.points[4].x + pin.points[8].x) / 2, y: (pin.points[4].y + pin.points[8].y) / 2 };
          if (grab) { spin.vy = (pm.x - grab.x) / W * 6 / Math.max(dt, 1e-3) * 0.5 + spin.vy * 0.5; spin.vp = (pm.y - grab.y) / H * 6 / Math.max(dt, 1e-3) * 0.5 + spin.vp * 0.5; }
          grab = pm;
        } else {
          grab = null;
          spin.vy += ((hands.length ? 0.05 : 0.15) - spin.vy) * (1 - Math.exp(-dt / 1.5)); spin.vp *= Math.exp(-dt / 1.2);
        }
        spin.yaw += spin.vy * dt; spin.pitch = Math.max(-1.2, Math.min(1.2, spin.pitch + spin.vp * dt));
        var cy = Math.cos(spin.yaw), sy = Math.sin(spin.yaw), cp = Math.cos(spin.pitch), sp = Math.sin(spin.pitch);
        var M = [cy, sy * sp, -sy * cp, 0, cp, sp, sy, -cy * sp, cy * cp];

        // Colors: two tints blending across the ball (Color 0: a slow drift through the pairs).
        var A, B;
        if (params.color) { A = Magi.fx.inkColor(params.color); B = A.map(function (v) { return 0.6 + 0.4 * v; }); }
        else {
          var k = (t * 0.06) % DRIFT.length, i0 = Math.floor(k), f = k - i0, P0 = DRIFT[i0], P1 = DRIFT[(i0 + 1) % DRIFT.length];
          f = f * f * (3 - 2 * f);
          A = P0[0].map(function (v, j) { return v + (P1[0][j] - v) * f; }); B = P0[1].map(function (v, j) { return v + (P1[1][j] - v) * f; });
        }
        var R = (0.32 + 0.28 * S.open) * (0.5 + params.size / 100) * S.span, N = Math.round(params.count) * 1000;
        var sL = Math.min(1, 1280 / Math.max(W, H)), w = Math.max(1, Math.round(W * sL)), h = Math.max(1, Math.round(H * sL));
        // Brightness per strand: the ball's area over the strands' total ink, so density reads the
        // same at any count.
        var alpha = (0.01 + params.exposure / 100 * 0.06) * Math.min(2, 60000 / N);
        g.draw(w, h, N, {
          time: t * (0.6 + params.speed / 100 * 1.6), len: 0.04 + params.length / 100 * 0.2, R: R, turb: 0.3 + params.turbulence / 100 * 1.4 * (0.6 + S.open),
          comb: 1.2 + params.turbulence / 100 * 2.5, twist: S.twist * params.twist / 100 * 1.6 + (hands.length ? 0 : 0.15 * params.twist / 100), ripple: 0.6 + 0.8 * S.open,
          focal: FOCAL, aspect: w / h, alpha: alpha, center: S.c, colA: A, colB: B, view: M
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(g.canvas, 0, 0, W, H);
        if (params.glow > 0) {
          var hw = Math.max(1, Math.round(W / 6)), hh = Math.max(1, Math.round(H / 6));
          if (halo.width !== hw || halo.height !== hh) { halo.width = hw; halo.height = hh; }
          hctx.clearRect(0, 0, hw, hh); hctx.drawImage(g.canvas, 0, 0, hw, hh);
          ctx.globalAlpha = params.glow / 100 * 0.9;
          ctx.drawImage(halo, 0, 0, W, H);
          ctx.drawImage(halo, -W * 0.03, -H * 0.03, W * 1.06, H * 1.06);
        }
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise your hand: it is the pole. Close it for a tight ball, open it to let the fur fly, roll your wrist to twist it, pinch and drag to spin.');
      },
      reset: function () { lastT = null; }
    };
  };
})();
