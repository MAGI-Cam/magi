// GPU particles: a particle system that lives on the graphics card, after TouchDesigner's
// Particle POP and Lookup Texture POP, so effects can run hundreds of thousands of particles.
//
// State: two float textures, side × side texels, one particle per texel:
//   position (x, y, z, age) and velocity (x, y, z, lifespan).
// Every frame one full-screen pass reads both and writes both (two render targets at once, then
// the pairs swap): the textures are the particles.
// Motion, per particle (semi-implicit Euler, v ← v + a·dt, p ← p + v·dt):
//   a = (u(p, t)·Turbulence − v)·Follow   Stokes drag toward the local flow u: the particle is carried
//                                         by the air and catches up with it at rate Follow
//     − Shell·(|p − c| − R)·n              a spring holding it to a sphere of radius R about c
//     + g                                  gravity
//     + Σ wᵢ·(aᵢ − p)/(|aᵢ − p|² + s²)^(3/2) softened inverse-square attractors (w < 0 repels)
// The flow u is Kinematic Simulation (Kraichnan 1970; Fung et al. 1992), synthetic turbulence as a
// sum of eight Fourier modes,
//   u(x, t) = Σₙ Aₙ cos(kₙ·x + ωₙt) + Bₙ sin(kₙ·x + ωₙt),   Aₙ, Bₙ ⟂ kₙ,
// so ∇·u = 0 (it swirls without sources or sinks). Wavenumbers are spaced geometrically over four
// octaves; amplitudes follow Kolmogorov's spectrum E(k) ∝ k^(−5/3), |Aₙ| ∝ √(E(kₙ)Δkₙ) ∝ kₙ^(−1/3);
// each mode turns over at its eddy frequency ωₙ ∝ kₙ^(2/3). It costs eight sin/cos pairs per
// particle, cheap enough for a phone.
//     + T·(3(r·n̂)n̂ − r)                    tidal acceleration from a distant mass in direction n̂
//                                         (r = p − c): the differential pull that raises two
//                                         opposite bulges, the ocean's tides (T = GM/d³)
//     − P·((p − q)·m)·m                    a spring to a plane through q with normal m (Horizon)
// Life: age counts up; past its lifespan (random between two bounds) a particle is reborn on the
// emitter: a sphere's surface, a line segment, points (landmarks) or a solid ball (uniform in
// volume: radius ∝ ∛u), with no velocity. With emission off, the reborn wait out of sight.
// Drawing: each particle is a 1–3 px point, faded in and out over its life and brighter nearer the
// eye, added ('one, one' blending) into a half-float image, so brightness is density. Trails are
// frame feedback: before drawing, the image is multiplied by Trails (decay per frame), so old
// positions fade like a long exposure. Bloom: the image at a quarter size, Gaussian-blurred
// (9 taps, two passes), added back. Tone mapping: light = 1 − e^(−E·x) (never clips, keeps the
// density gradient); ink = e^(−E·x), Beer–Lambert absorption, so dense particles go dark on paper.
// Lookup (Lookup Texture POP): a particle can take its color from the camera at its place on screen.
// Flash: particles near a point light up (a Gaussian glow) and a thin shell of light at radius
// waveR passes through them, so a strike lights the particles themselves and ripples outward.
// Emitters can be up to 42 points (two hands' landmarks); with emitByIndex each particle is always
// born at point (index mod count), so particles a multiple of that count apart share a birthplace.
// Pseudo plexus (lines): each particle i is joined to particle (i + stride) mod N, and the line's
// brightness falls with its length, (1 − smoothstep(0, maxLen, d))², so only partners that happen
// to be near draw: the plexus look (lines between near neighbors) without a neighbor search, after
// TouchDesigner's "pseudo plexus" trick. Strides that are multiples of the emitter count join
// particles from the same birthplace; one more joins the next landmark along the hand.
(function () {
  var MODES = 8;

  var VS_QUAD = '#version 300 es\nin vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

  var FS_UPDATE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 uv;',
    'uniform sampler2D posTex, velTex;',
    'uniform float dt, time, seed, amp, kscale, follow, shellK, radius, lifeMin, lifeMax, reset, soft, jitter, tideK, planeK, emitOn;',
    'uniform vec3 center, gravity, lineA, lineB, tideN, planeP, planeN;',
    'uniform int emitShape, nAttract, nEmit, side;',
    'uniform float emitByIndex;',
    'uniform vec4 attract[8];',
    'uniform vec3 emitPts[42];',
    'uniform vec3 kv[' + MODES + '], av[' + MODES + '], bv[' + MODES + '];',
    'uniform float wv[' + MODES + '];',
    'layout(location = 0) out vec4 oPos;',
    'layout(location = 1) out vec4 oVel;',
    'float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'vec3 unitVec(vec2 s) { float z = hash(s) * 2.0 - 1.0, a = hash(s + 17.3) * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z)); return vec3(r * cos(a), r * sin(a), z); }',
    'vec3 flow(vec3 x, float t) {',
    '  vec3 u = vec3(0.0);',
    '  for (int i = 0; i < ' + MODES + '; i++) { float ph = dot(kv[i], x) * kscale + wv[i] * t; u += av[i] * cos(ph) + bv[i] * sin(ph); }',
    '  return u;',
    '}',
    'void main() {',
    '  vec4 P = texture(posTex, uv), V = texture(velTex, uv);',
    '  float age = P.w + dt;',
    '  if (age > V.w || reset > 0.5) {',
    '    vec2 s = uv * 913.7 + vec2(seed, seed * 1.37);',
    '    vec3 pos;',
    '    if (emitShape == 1) pos = mix(lineA, lineB, hash(s + 3.1)) + unitVec(s + 9.7) * jitter;',
    '    else if (emitShape == 2 && nEmit > 0) { int idx = int(gl_FragCoord.y) * side + int(gl_FragCoord.x);',
    '      int k = emitByIndex > 0.5 ? idx % nEmit : min(nEmit - 1, int(floor(hash(s + 5.3) * float(nEmit))));',
    '      pos = emitPts[k] + unitVec(s + 9.7) * jitter * pow(hash(s + 2.2), 0.5); }',
    '    else if (emitShape == 3) pos = center + unitVec(s) * radius * pow(hash(s + 4.4), 1.0 / 3.0);',
    '    else pos = center + unitVec(s) * radius * (1.0 + jitter * (hash(s + 4.4) - 0.5));',
    '    if (emitOn < 0.5) { oPos = vec4(1e4, 1e4, 1e4, 0.0); oVel = vec4(0.0, 0.0, 0.0, 0.05 + 0.1 * hash(s + 6.6)); return; }',
    '    float life = mix(lifeMin, lifeMax, hash(s + 7.7));',
    '    oPos = vec4(pos, reset > 0.5 ? hash(s + 8.8) * life : 0.0);',
    '    oVel = vec4(0.0, 0.0, 0.0, life);',
    '    return;',
    '  }',
    '  vec3 p = P.xyz, v = V.xyz;',
    '  vec3 a = (flow(p, time) * amp - v) * follow + gravity;',
    '  if (shellK > 0.0) { vec3 d = p - center; float r = length(d) + 1e-5; a -= shellK * (r - radius) * d / r; }',
    '  if (tideK > 0.0) { vec3 r = p - center; a += tideK * (3.0 * dot(r, tideN) * tideN - r); }',
    '  if (planeK > 0.0) a -= planeK * dot(p - planeP, planeN) * planeN;',
    '  for (int i = 0; i < 8; i++) { if (i >= nAttract) break; vec3 e = attract[i].xyz - p; float l2 = dot(e, e) + soft * soft; a += attract[i].w * e / (l2 * sqrt(l2)); }',
    '  v += a * dt;',
    '  p += v * dt;',
    '  oPos = vec4(p, age);',
    '  oVel = vec4(v, V.w);',
    '}'
  ].join('\n');

  var VS_POINTS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D posTex, velTex, camTex;',
    'uniform int side;',
    'uniform mat3 view;',
    'uniform vec3 pivot, color;',
    'uniform float aspect, focal, psize, useCam, bright, depthK, accentShare, coreK, coreR, flashI, waveR;',
    'uniform vec3 accent, coreColor, coreC, flashC, flashCol;',
    'out vec3 vC;',
    'float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }',
    'void main() {',
    '  ivec2 c = ivec2(gl_VertexID % side, gl_VertexID / side);',
    '  vec4 P = texelFetch(posTex, c, 0), V = texelFetch(velTex, c, 0);',
    '  vec3 q = view * (P.xyz - pivot) + pivot;',
    '  float k = focal / max(0.05, focal + q.z);',
    '  vec2 s = vec2(q.x * k / aspect, q.y * k);',
    '  gl_Position = vec4(s, 0.0, 1.0);',
    '  gl_PointSize = psize;',
    '  float f = P.w / max(1e-3, V.w), fade = smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.7, 1.0, f));',
    '  float depth = clamp(1.0 - depthK * q.z, 0.15, 1.6);',
    '  vec3 col = useCam > 0.5 ? texture(camTex, vec2(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5)).rgb : color;',
    '  if (accentShare > 0.0 && h1(float(gl_VertexID)) < accentShare) col = accent;',
    '  if (coreK > 0.0) col = mix(col, coreColor * coreK, smoothstep(coreR, coreR * 0.15, distance(P.xyz, coreC)));',
    '  if (flashI > 0.0) { float fd = distance(P.xyz, flashC); col += flashCol * flashI * (4.0 * exp(-fd * fd / 0.02) + 3.0 * exp(-(fd - waveR) * (fd - waveR) / 0.004)); }',
    '  vC = col * fade * depth * bright;',
    '}'
  ].join('\n');
  var FS_POINTS = '#version 300 es\nprecision highp float; in vec3 vC; out vec4 o; void main() { o = vec4(vC, 1.0); }';

  var VS_LINES = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D posTex, velTex;',
    'uniform int side, stride;',
    'uniform mat3 view;',
    'uniform vec3 pivot, color;',
    'uniform float aspect, focal, maxLen, bright;',
    'out vec3 vC;',
    'float fade(vec4 P, vec4 V) { float f = P.w / max(1e-3, V.w); return smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.7, 1.0, f)); }',
    'void main() {',
    '  int N = side * side, i = gl_VertexID / 2, j = (i + stride) % N, me = (gl_VertexID % 2 == 0) ? i : j;',
    '  vec4 A = texelFetch(posTex, ivec2(i % side, i / side), 0), B = texelFetch(posTex, ivec2(j % side, j / side), 0);',
    '  vec4 VA = texelFetch(velTex, ivec2(i % side, i / side), 0), VB = texelFetch(velTex, ivec2(j % side, j / side), 0);',
    '  float a = 1.0 - smoothstep(0.0, maxLen, distance(A.xyz, B.xyz)); a *= a * min(fade(A, VA), fade(B, VB));',
    '  vec4 P = (me == i) ? A : B;',
    '  vec3 q = view * (P.xyz - pivot) + pivot;',
    '  float k = focal / max(0.05, focal + q.z);',
    '  gl_Position = a > 0.002 ? vec4(q.x * k / aspect, q.y * k, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);',
    '  vC = color * a * bright;',
    '}'
  ].join('\n');

  var FS_DECAY = '#version 300 es\nprecision highp float; uniform float decay; out vec4 o; void main() { o = vec4(0.0, 0.0, 0.0, decay); }';
  var FS_COPY = '#version 300 es\nprecision highp float; in vec2 uv; uniform sampler2D src; out vec4 o; void main() { o = texture(src, uv); }';
  // 9-tap Gaussian (σ ≈ 2 texels), weights from the binomial row 1 8 28 56 70 56 28 8 1 / 256.
  var FS_BLUR = [
    '#version 300 es',
    'precision highp float; in vec2 uv; uniform sampler2D src; uniform vec2 step; out vec4 o;',
    'void main() {',
    '  float w[5] = float[5](70.0, 56.0, 28.0, 8.0, 1.0);',
    '  vec4 s = texture(src, uv) * w[0];',
    '  for (int i = 1; i < 5; i++) s += (texture(src, uv + step * float(i)) + texture(src, uv - step * float(i))) * w[i];',
    '  o = s / 256.0;',
    '}'
  ].join('\n');
  var FS_COMPOSITE = [
    '#version 300 es',
    'precision highp float; in vec2 uv; uniform sampler2D accum, bloom; uniform float exposure, glow, ink; out vec4 o;',
    'void main() {',
    '  vec3 a = texture(accum, uv).rgb + texture(bloom, uv).rgb * glow;',
    '  o = ink > 0.5 ? vec4(exp(-a * exposure), 1.0) : vec4(1.0 - exp(-a * exposure), 1.0);',
    '}'
  ].join('\n');

  // Turbulence modes (see the header): random directions, wavenumbers over four octaves.
  function makeModes() {
    var kv = [], av = [], bv = [], wv = [], sum = 0, amps = [];
    function rnd3() { var z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), r * Math.sin(a), z]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    for (var i = 0; i < MODES; i++) {
      var kmag = 1.5 * Math.pow(16, i / (MODES - 1)), d = rnd3(), amp = Math.pow(kmag, -1 / 3);
      amps.push(amp); sum += amp * amp;
      kv.push(d.map(function (x) { return x * kmag; }));
      var A = norm(cross(d, rnd3())), B = norm(cross(d, A));
      av.push(A); bv.push(B);
      wv.push(0.6 * Math.pow(kmag, 2 / 3));
    }
    var nrm = 1 / Math.sqrt(sum);
    av = av.map(function (A, i) { return A.map(function (x) { return x * amps[i] * nrm; }); });
    bv = bv.map(function (B, i) { return B.map(function (x) { return x * amps[i] * nrm; }); });
    return { kv: [].concat.apply([], kv), av: [].concat.apply([], av), bv: [].concat.apply([], bv), wv: wv };
  }

  Magi.gpuParticles = function () {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) return null;
    var full = !!gl.getExtension('EXT_color_buffer_float'), half = full || !!gl.getExtension('EXT_color_buffer_half_float');
    if (!half) return null;
    gl.getExtension('OES_texture_float_linear');
    // Positions need 32-bit floats where the device can render to them; half floats otherwise.
    var STATE_FMT = full ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA16F, gl.HALF_FLOAT];

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('Magi gpu particles shader:', gl.getShaderInfoLog(sh));
      return sh;
    }
    function program(vs, fs) {
      var pr = gl.createProgram();
      gl.attachShader(pr, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('Magi gpu particles link:', gl.getProgramInfoLog(pr)); return null; }
      return { p: pr, u: {} };
    }
    var P = {
      update: program(VS_QUAD, FS_UPDATE), points: program(VS_POINTS, FS_POINTS), lines: program(VS_LINES, FS_POINTS), decay: program(VS_QUAD, FS_DECAY),
      copy: program(VS_QUAD, FS_COPY), blur: program(VS_QUAD, FS_BLUR), composite: program(VS_QUAD, FS_COMPOSITE)
    };
    if (Object.keys(P).some(function (k) { return !P[k]; })) return null;

    var quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var emptyVao = gl.createVertexArray();

    function tex(w, h, internal, type, filter, data) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, data || null);
      return t;
    }
    function fbo(texs) {
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      texs.forEach(function (t, i) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); });
      return f;
    }
    function target(w, h) { var t = tex(w, h, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR); return { tex: t, fbo: fbo([t]), w: w, h: h }; }

    function uniforms(pr, values) {
      var unit = 0;
      gl.useProgram(pr.p);
      Object.keys(values).forEach(function (n) {
        var v = values[n], l = n in pr.u ? pr.u[n] : (pr.u[n] = gl.getUniformLocation(pr.p, n));
        if (l === null) return;
        if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(l, unit++); }
        else if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v.int !== undefined) gl.uniform1i(l, v.int);
        else if (v.mat3) gl.uniformMatrix3fv(l, false, v.mat3);
        else if (v.v4) gl.uniform4fv(l, v.v4);
        else if (v.v3) gl.uniform3fv(l, v.v3);
        else if (v.f1) gl.uniform1fv(l, v.f1);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else gl.uniform2f(l, v[0], v[1]);
      });
    }
    function quad(pr, values, out) {
      uniforms(pr, values);
      gl.bindVertexArray(quadVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    var side = 0, state = null, cur = 0, modes = makeModes(), accum = null, bA = null, bB = null, camTex = null, needReset = true;
    function makeState(n) {
      side = Math.max(4, Math.ceil(Math.sqrt(n)));
      state = [0, 1].map(function () {
        var pos = tex(side, side, STATE_FMT[0], STATE_FMT[1], gl.NEAREST), vel = tex(side, side, STATE_FMT[0], STATE_FMT[1], gl.NEAREST);
        var f = fbo([pos, vel]);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        return { pos: pos, vel: vel, fbo: f };
      });
      needReset = true;
    }

    return {
      canvas: canvas,
      count: function () { return side * side; },
      // Particles to simulate (rounded up to a square texture).
      setCount: function (n) { if (Math.ceil(Math.sqrt(n)) !== side) makeState(n); },
      reset: function () { needReset = true; },
      // One simulation step; o carries the uniforms named in the header.
      step: function (o) {
        if (!state) makeState(o.count || 100000);
        var src = state[cur], dst = state[1 - cur], at = (o.attract || []).slice(0, 8), em = (o.emitPoints || []).slice(0, 42);
        var av4 = new Float32Array(32), ep = new Float32Array(126);
        at.forEach(function (a, i) { av4.set(a, i * 4); });
        em.forEach(function (e, i) { ep.set(e, i * 3); });
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        uniforms(P.update, {
          posTex: src.pos, velTex: src.vel, dt: o.dt, time: o.time, seed: Math.random() * 100, amp: o.amp, kscale: o.kscale || 1, follow: o.follow || 2,
          shellK: o.shellK || 0, radius: o.radius || 0.5, lifeMin: o.lifeMin || 2, lifeMax: o.lifeMax || 6, reset: needReset ? 1 : 0, soft: o.soft || 0.08, jitter: o.jitter || 0,
          center: o.center || [0, 0, 0], gravity: o.gravity || [0, 0, 0], lineA: o.lineA || [0, 0, 0], lineB: o.lineB || [0, 0, 0],
          tideK: o.tideK || 0, tideN: o.tideN || [1, 0, 0], planeK: o.planeK || 0, planeP: o.planeP || [0, 0, 0], planeN: o.planeN || [0, 1, 0], emitOn: o.emitOn === false ? 0 : 1,
          emitShape: { int: o.emitShape || 0 }, nAttract: { int: at.length }, nEmit: { int: em.length }, side: { int: side }, emitByIndex: o.emitByIndex ? 1 : 0,
          attract: { v4: av4 }, emitPts: { v3: ep },
          kv: { v3: modes.kv }, av: { v3: modes.av }, bv: { v3: modes.bv }, wv: { f1: modes.wv }
        });
        gl.bindVertexArray(quadVao);
        gl.viewport(0, 0, side, side);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        cur = 1 - cur; needReset = false;
      },
      // Draws into the internal image at w × h and leaves the tone-mapped result on `canvas`.
      draw: function (o) {
        var w = o.w, h = o.h;
        if (canvas.width !== w || canvas.height !== h || !accum) {
          canvas.width = w; canvas.height = h;
          accum = target(w, h);
          var qw = Math.max(1, Math.round(w / 4)), qh = Math.max(1, Math.round(h / 4));
          bA = target(qw, qh); bB = target(qw, qh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        if (o.useCam && o.cam) {
          if (!camTex) camTex = tex(1, 1, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR);
          gl.bindTexture(gl.TEXTURE_2D, camTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, o.cam);
        }
        // Trails: fade what is there (dst ← dst·decay), then add the particles on top.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        quad(P.decay, { decay: o.decay }, accum);
        gl.blendFunc(gl.ONE, gl.ONE);
        uniforms(P.points, {
          posTex: state[cur].pos, velTex: state[cur].vel, camTex: camTex || state[cur].pos, side: { int: side }, view: { mat3: o.view }, pivot: o.pivot,
          color: o.color, aspect: w / h, focal: o.focal || 3, psize: o.psize || 1, useCam: o.useCam && o.cam ? 1 : 0, bright: o.bright, depthK: o.depthK === undefined ? 0.5 : o.depthK,
          accent: o.accent || [1, 1, 1], accentShare: o.accentShare || 0, coreColor: o.coreColor || [1, 1, 1], coreK: o.coreK || 0, coreR: o.coreR || 0.5, coreC: o.coreC || [0, 0, 0],
          flashI: o.flashI || 0, waveR: o.waveR || 0, flashC: o.flashC || [0, 0, 0], flashCol: o.flashCol || [0.8, 0.88, 1]
        });
        gl.bindVertexArray(emptyVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
        gl.viewport(0, 0, w, h);
        gl.drawArrays(gl.POINTS, 0, side * side);
        // Pseudo plexus lines (see the header), one draw per stride.
        (o.lines || []).forEach(function (L) {
          uniforms(P.lines, {
            posTex: state[cur].pos, velTex: state[cur].vel, side: { int: side }, stride: { int: Math.max(1, L.stride) }, view: { mat3: o.view }, pivot: o.pivot,
            color: L.color || o.color, aspect: w / h, focal: o.focal || 3, maxLen: L.maxLen, bright: L.bright
          });
          gl.bindVertexArray(emptyVao);
          gl.drawArrays(gl.LINES, 0, Math.min(side * side, L.count || side * side) * 2);
        });
        gl.disable(gl.BLEND);
        // Bloom: quarter size, blurred across then down.
        if (o.glow > 0) {
          quad(P.copy, { src: accum.tex }, bA);
          quad(P.blur, { src: bA.tex, step: [1 / bA.w, 0] }, bB);
          quad(P.blur, { src: bB.tex, step: [0, 1 / bA.h] }, bA);
        }
        quad(P.composite, { accum: accum.tex, bloom: bA.tex, exposure: o.exposure, glow: o.glow > 0 ? o.glow : 0, ink: o.ink ? 1 : 0 }, null);
      }
    };
  };
})();
