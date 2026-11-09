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
// flow is damped, sucking the picture back to normal (Watercolor: a fist vacuums the paint). The output is the live camera sampled at C.
//
// Watercolor mode: the same flow carries pigment instead of the picture, painted on paper (see the
// deposit, bleed and paint shaders): an abstract painting made by moving through the air.
(function () {
  var WRIST = 0, MIDDLE_MCP = 9;
  // Capsules that fill the palm, on top of MediaPipe's bone connections.
  var PALM = [[0, 5], [0, 9], [0, 13], [0, 17], [1, 5], [5, 9], [9, 13], [13, 17], [2, 5]];

  var VS = '#version 300 es\nin vec2 p; uniform vec2 texel; out vec2 uv, vL, vR, vT, vB;\n' +
    'void main() { uv = p * 0.5 + 0.5; vL = uv - vec2(texel.x, 0.0); vR = uv + vec2(texel.x, 0.0); ' +
    'vT = uv + vec2(0.0, texel.y); vB = uv - vec2(0.0, texel.y); gl_Position = vec4(p, 0.0, 1.0); }';
  // Every shader can ask how strongly a point is being vacuumed: 1 at a fist, falling smoothly to 0
  // at radius r (vac = (x, y, r) in texture space, r = 0 off; distances corrected for aspect).
  var HEAD = '#version 300 es\nprecision highp float;\nin vec2 uv, vL, vR, vT, vB;\nout vec4 o;\n' +
    'uniform vec3 vac0, vac1; uniform float aspect, vk, vdamp;\n' +
    'float vacW(vec2 p) { float w = 0.0; vec2 a = vec2(aspect, 1.0);\n' +
    '  if (vac0.z > 0.0) w = max(w, smoothstep(vac0.z, 0.0, length((p - vac0.xy) * a)));\n' +
    '  if (vac1.z > 0.0) w = max(w, smoothstep(vac1.z, 0.0, length((p - vac1.xy) * a)));\n' +
    '  return w; }\n' +
    // The vacuum's sink: a 2D point sink draws everything toward the fist with speed Q/(2πr)
    // (r the distance; capped near the center), fading to 0 at the vacuum's edge; inside its
    // core (6% of the frame height) what arrives is erased.
    'uniform float vq;\n' +
    'vec2 sink1(vec2 p, vec3 v) { vec2 a = vec2(aspect, 1.0), d = (v.xy - p) * a; float r = length(d) + 1e-4;\n' +
    '  return v.z > 0.0 ? d / r * vq * min(1.0 / (r * 6.0), 3.0) * smoothstep(v.z, 0.0, r) / a : vec2(0.0); }\n' +
    'vec2 vacSink(vec2 p) { return sink1(p, vac0) + sink1(p, vac1); }\n' +
    'float vacCore(vec2 p) { vec2 a = vec2(aspect, 1.0); float w = 0.0;\n' +
    '  if (vac0.z > 0.0) w = max(w, smoothstep(0.06, 0.0, length((p - vac0.xy) * a)));\n' +
    '  if (vac1.z > 0.0) w = max(w, smoothstep(0.06, 0.0, length((p - vac1.xy) * a)));\n' +
    '  return w; }\n';
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
      '  o = vec4((v + f * a * dt) * mix(damp, vdamp, vacW(uv)), 0.0, 1.0); }',
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
      'void main() { vec2 back = uv - dt * (texture(vel, uv).xy * velTexel + vacSink(uv)); o = mix(keep, vk, vacCore(uv)) * texture(src, back); }',
    // The image map: D(x) ← D(x − v·dt) − v·dt, then relaxed toward zero.
    warp: 'uniform sampler2D vel, map; uniform vec2 velTexel; uniform float dt, keep;\n' +
      'void main() { vec2 st = dt * (texture(vel, uv).xy * velTexel + vacSink(uv)); o = vec4((texture(map, uv - st).xy - st) * mix(keep, vk, vacCore(uv)), 0.0, 1.0); }',
    // The stirred picture; where it is displaced, its hue turns by `hue` (a rotation about the gray
    // axis in YIQ), weighted by how far the pixel has been carried, so a pinch tints the swirls.
    // Psychedelic adds `band`: the hue also turns with the distance the pixel was carried
    // (band·|D| radians), so each swirl is striped through the spectrum.
    show: 'uniform sampler2D cam, map; uniform float hue, band;\nvoid main() { vec2 d = texture(map, uv).xy; vec3 c = texture(cam, clamp(uv + d, 0.0, 1.0)).rgb;\n' +
      '  float w = smoothstep(0.0, 0.03, length(d)); mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);\n' +
      '  vec3 y = toY * c; float ang = hue * w + band * length(d); float cs = cos(ang), sn = sin(ang); y.yz = vec2(y.y * cs - y.z * sn, y.y * sn + y.z * cs);\n' +
      '  mat3 toR = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);\n' +
      '  o = vec4(clamp(toR * y, 0.0, 1.0), 1.0); }',
    // Watercolor. Pigment is stored as optical density per channel, D = −ln(reflectance).
    // Deposit: where a hand moves (the mask's activity), add the density of a palette color, up to
    // a density of 2.2 per channel (about 11% reflectance, a full wash). The
    // color drifts across the four palette colors by a slow noise of position and time, or is the
    // camera's own color there (Camera profile).
    deposit: 'uniform sampler2D pig, mask, cam; uniform vec3 c0, c1, c2, c3; uniform float amount, t, useCam;\n' +
      'void main() { float a = texture(mask, uv).x; vec4 p = texture(pig, uv);\n' +
      '  float n = fract(0.5 + 0.5 * sin(uv.x * 3.1 + t * 0.21) * cos(uv.y * 2.3 - t * 0.17) + 0.25 * sin((uv.x + uv.y) * 5.7 + t * 0.13)) * 4.0;\n' +
      '  vec3 c = n < 1.0 ? mix(c0, c1, n) : n < 2.0 ? mix(c1, c2, n - 1.0) : n < 3.0 ? mix(c2, c3, n - 2.0) : mix(c3, c0, n - 3.0);\n' +
      '  if (useCam > 0.5) c = texture(cam, uv).rgb;\n' +
      '  vec3 dens = -log(clamp(c, 0.04, 0.98));\n' +
      '  o = vec4(min(p.rgb + dens * a * amount, vec3(2.2)), 1.0); }',
    // Wet bleed: a little diffusion each frame, mixing toward the neighbors' average.
    bleed: 'uniform sampler2D pig; uniform float k;\n' +
      'void main() { vec3 c = texture(pig, uv).rgb, m = 0.25 * (texture(pig, vL).rgb + texture(pig, vR).rgb + texture(pig, vT).rgb + texture(pig, vB).rgb);\n' +
      '  o = vec4(mix(c, m, k), 1.0); }',
    // Paper: reflectance = paper × e^(−D·edge·grain) (Beer–Lambert). Edge darkening: pigment
    // collects where the wash's density changes fast (Curtis et al. 1997), so the density is
    // raised by its gradient magnitude. Granulation: paper grain (two octaves of value noise)
    // modulates how much pigment shows, more in the dense areas. Dark: black paper can't show a
    // transparent wash, so each pigment shows as its own color at full strength (its reflectance
    // e^(−D) scaled so its brightest channel is 1), laid over the black by its coverage
    // 1 − e^(−mean D·1.5), like gouache on black paper.
    paint: 'uniform sampler2D pig; uniform vec2 size; uniform float edges, dark;\n' +
      'float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      'float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
      '  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }\n' +
      'void main() { vec3 d = texture(pig, uv).rgb;\n' +
      '  float s = d.r + d.g + d.b, g = abs(texture(pig, vR).r + texture(pig, vR).g + texture(pig, vR).b - (texture(pig, vL).r + texture(pig, vL).g + texture(pig, vL).b))\n' +
      '    + abs(texture(pig, vT).r + texture(pig, vT).g + texture(pig, vT).b - (texture(pig, vB).r + texture(pig, vB).g + texture(pig, vB).b));\n' +
      '  float grain = 0.6 * vn(uv * size / 3.0) + 0.4 * vn(uv * size / 1.2);\n' +
      '  float k = (1.0 + edges * clamp(g * 6.0, 0.0, 1.5)) * (0.8 + 0.4 * grain);\n' +
      '  vec3 paper = vec3(0.965, 0.95, 0.915) * (0.97 + 0.03 * grain);\n' +
      '  if (dark > 0.5) {\n' +
      '    vec3 hue = exp(-d * k); hue /= max(max(hue.r, hue.g), max(hue.b, 1e-3));\n' +
      '    float cover = 1.0 - exp(-dot(d * k, vec3(0.5)));\n' +
      '    o = vec4(mix(vec3(0.045, 0.045, 0.05) * (0.9 + 0.2 * grain), hue * 0.92, cover), 1.0);\n' +
      '  } else o = vec4(paper * exp(-d * k), 1.0); }'
  };
  // Watercolor profiles (Colors): 0 takes colors from the camera; the rest are four pigments each,
  // after painters and places (names show on screen when you change it).
  var PALETTES = [
    { name: 'Camera', c: null },
    { name: 'Rothko', c: ['#8c1c13', '#e36414', '#5f0f40', '#f2a541'] },        // cadmium red, orange, maroon, ochre
    { name: 'Indigo', c: ['#003153', '#3f51b5', '#2a9d8f', '#1b1b3a'] },        // Prussian blue, indigo, teal, ink
    { name: 'Spring', c: ['#507d2a', '#f4e04d', '#e07a9a', '#2a93d5'] },        // sap green, lemon, rose, cerulean
    { name: 'Sunset', c: ['#c2185b', '#ff7f50', '#ffc300', '#6a4c93'] },        // magenta, coral, gold, violet
    { name: 'Earth', c: ['#8a3324', '#826644', '#cb9d06', '#536878'] },         // burnt sienna, raw umber, yellow ochre, Payne's gray
    { name: 'Water Lilies', c: ['#7b9acc', '#b5a1d6', '#7fa37a', '#e8b4c8'] },  // soft blue, lilac, sage, pink
    { name: 'Great Wave', c: ['#1f3a5f', '#6c8ebf', '#e9e2cf', '#2b2b2b'] },    // Prussian, pale blue, cream, sumi ink
    { name: 'Gold Leaf', c: ['#b8860b', '#d4af37', '#2e8b57', '#8b1e3f'] },     // dark gold, gold, emerald, garnet
    { name: 'Cutouts', c: ['#1d3fbb', '#e63b2e', '#f6c400', '#1f9e4a'] },       // cobalt, vermilion, cadmium yellow, green
    { name: 'Stain', c: ['#f2a0a1', '#7fb7d9', '#e8c170', '#9e7bb5'] },         // poured pinks, sky, ochre, violet
    { name: 'Neon', c: ['#ff1fa9', '#00e5ff', '#b6ff00', '#ffe600'] },         // magenta, cyan, lime, yellow
    { name: 'Ocean', c: ['#023e8a', '#0096c7', '#48cae4', '#03045e'] },         // deep, mid, shallow, abyss
    { name: 'Forest', c: ['#1b4332', '#40916c', '#95d5b2', '#6b4226'] },        // pine, leaf, mint, bark
    { name: 'Desert', c: ['#c1440e', '#e9a03b', '#f2d0a4', '#7a4419'] },        // rust, sand, dune, umber
    { name: 'Sumi', c: ['#111111', '#3a3a3a', '#6b5b4b', '#8c2f1c'] },          // ink, gray wash, sepia, seal red
    { name: 'Fauve', c: ['#ff2a00', '#00b3ff', '#ffd400', '#00c853'] },          // vermilion, cerulean, cadmium, emerald
    { name: 'Klein', c: ['#002fa7', '#1e90ff', '#00ffd5', '#0b0033'] },          // International Klein Blue and its kin
    { name: 'Candy', c: ['#ff4fa3', '#7c4dff', '#00e5ff', '#ffea00'] },
    { name: 'Ember', c: ['#ff3d00', '#ff9100', '#ffd180', '#4e0d0d'] },
    { name: 'Aurora', c: ['#00ff9d', '#00b3ff', '#8f00ff', '#ff00a8'] },
    { name: 'Pop', c: ['#ff0055', '#00d1ff', '#ffe600', '#00ff73'] },
    { name: 'Lagoon', c: ['#00c2a8', '#0077b6', '#90e0ef', '#f4a261'] },
    { name: 'Blossom', c: ['#ffafcc', '#bde0fe', '#cdb4db', '#ffc8dd'] }
  ];
  function hex(c) { return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]; }

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
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else gl.uniform2f(l, v[0], v[1]);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    var colorShift = 0, colorAcc = 0, lastColorT = null, shownPalette = null, paletteAt = -9, W = 0, H = 0, sw, sh, vel, act, map, pig, prs, div, curl, camTex, maskTex, mask, lastHands = null, prev = {}, lastT = null;
    function alloc(w, h) {
      W = w; H = h;
      sw = Math.max(32, Math.round(w / 4)); sh = Math.max(32, Math.round(h / 4));
      vel = pair(sw, sh); act = pair(sw, sh); map = pair(Math.round(w / 2), Math.round(h / 2)); pig = pair(Math.round(w / 2), Math.round(h / 2));
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
        // Watercolor has its own Trail, Flow and Swirl (different defaults from Smoke).
        if (params.mode === 'watercolor') params = Object.assign({}, params, { trail: params.wtrail, flow: params.wflow, swirl: params.wswirl });
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

        // Watercolor — Fist: a vacuum at each closed hand. Within 35% of the frame height the paint
        // (and the activity) is drawn into the fist by a point sink (see vacSink) and erased in its
        // core, and the flow there is damped. Two fists, two vacuums. Pinch: shifts the palette, one
        // palette a second per pinching hand (real elapsed time, since the fluid's own step is
        // capped); the slider follows.
        // Smoke, Psychedelic — Pinch: the whole stirred picture is sucked back to normal (its offset
        // relaxes with a 0.12 s half-life) and the flow is damped. Fist: turns the hue of the swirls,
        // one turn every 2.6 s per closed hand.
        var ixW = Magi.interaction.read(frame), wc = params.mode === 'watercolor';
        var fistN = ixW.hands.filter(function (h) { return h.fist; }).length, fists = wc ? ixW.hands.filter(function (h) { return h.fist; }).slice(0, 2) : [];
        var vacs = [0, 1].map(function (k) { var h = fists[k]; return h ? [h.center.x / W, 1 - h.center.y / H, 0.35] : [0, 0, 0]; });
        var pinching = ixW.hands.filter(function (h) { return h.pinched; }).length, sucking = !wc && pinching > 0;
        var realDt = lastColorT === null ? dt : Math.min(0.25, t - lastColorT);
        lastColorT = t;
        if (wc && pinching) {
          colorAcc += pinching * realDt * 100 / (PALETTES.length - 1);
          if (Math.abs(colorAcc) >= 1) { var stepC = Math.trunc(colorAcc); colorAcc -= stepC; var nc = params.colors + stepC; if (nc > 100) nc = 1 + (nc - 101); frame.setParam('colors', nc); params = Object.assign({}, params, { colors: nc }); }
        } else if (!wc && fistN) colorShift += fistN * realDt;
        var vac = { vac0: vacs[0], vac1: vacs[1], aspect: W / H, vq: 0.25 };
        var vt = [1 / sw, 1 / sh], keep = Math.pow(2, -dt / (sucking ? 0.12 : 0.15 * Math.pow(2, params.trail / 20))), vkeep = Math.pow(2, -dt / 0.12);
        run('emit', { act: act.read, mask: maskTex }, act.write, vt); act.swap();
        run('force', { vel: vel.read, mask: maskTex, act: act.read, size: [sw, sh], flow: params.flow / 100, dt: dt,
          swirl: params.swirl / 100 * 220, rise: params.rise / 100 * 160, t: t, damp: Math.exp(-dt * (sucking ? 8 : 0.8)), vdamp: Math.exp(-dt * 8), vac0: vac.vac0, vac1: vac.vac1, aspect: vac.aspect }, vel.write, vt);
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
        run('advect', { vel: vel.read, src: vel.read, velTexel: vt, dt: dt, keep: 1, vk: 1, vq: 0, vac0: vac.vac0, vac1: vac.vac1, aspect: vac.aspect }, vel.write, vt);
        vel.swap();
        run('advect', { vel: vel.read, src: act.read, velTexel: vt, dt: dt, keep: keep, vk: vkeep, vq: vac.vq, vac0: vac.vac0, vac1: vac.vac1, aspect: vac.aspect }, act.write, vt);
        act.swap();
        if (params.mode === 'watercolor') {
          // Watercolor: deposit, carry with the flow, bleed, then paint on paper. The painting lasts
          // (pigment half-life 2·2^(Trail/12) s). Watercolor has its own Trail, Flow and Swirl.
          // Colors, 0–100, runs continuously through the palettes: 0 is the camera's own colors, and
          // every other value blends the two palettes it falls between, so each step changes the
          // colors. A fist vacuums the painting away around it (0.4 s half-life).
          var colorPos = params.colors;
          var pos = colorPos / 100 * (PALETTES.length - 1), lo = Math.floor(pos), fr = pos - lo, A0 = PALETTES[lo], A1 = PALETTES[Math.min(PALETTES.length - 1, lo + 1)];
          var pt = [1 / pig.read.w, 1 / pig.read.h], entry = fr < 0.5 ? A0 : A1, pal = pos > 0 ? true : null;
          // The palette's name shows for 2 s after it changes.
          if (entry !== shownPalette) { shownPalette = entry; paletteAt = t; }
          var ca = (A0.c || A1.c).map(hex), cb = (A1.c || A0.c).map(hex);
          var cs = pal ? ca.map(function (c, k) { return [c[0] + (cb[k][0] - c[0]) * fr, c[1] + (cb[k][1] - c[1]) * fr, c[2] + (cb[k][2] - c[2]) * fr]; }) : [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
          run('deposit', { pig: pig.read, mask: maskTex, cam: camTex, c0: cs[0], c1: cs[1], c2: cs[2], c3: cs[3], amount: dt * 2.5, t: t, useCam: pal ? 0 : 1 }, pig.write, pt);
          pig.swap();
          var pkeep = Math.pow(2, -dt / (2 * Math.pow(2, params.trail / 12)));
          run('advect', { vel: vel.read, src: pig.read, velTexel: vt, dt: dt, keep: pkeep, vk: Math.pow(2, -dt / 0.1), vq: vac.vq, vac0: vac.vac0, vac1: vac.vac1, aspect: vac.aspect }, pig.write, pt);
          pig.swap();
          run('bleed', { pig: pig.read, k: 0.12 }, pig.write, pt);
          pig.swap();
          if (t - paletteAt < 2) { var hud = frame.hud; hud.save(); hud.fillStyle = params.dark ? '#fff' : '#111'; hud.font = '500 ' + Math.round(11 * frame.pxPerCss) + 'px ' + Magi.fx.MONO; hud.fillText(entry.name.toUpperCase(), W * 0.04, H * 0.07); hud.restore(); }
          run('paint', { pig: pig.read, size: [pig.read.w, pig.read.h], edges: params.edges / 100 * 2.5, dark: params.dark ? 1 : 0 }, null, pt);
        } else {
          run('warp', { vel: vel.read, map: map.read, velTexel: vt, dt: dt, keep: keep, vk: vkeep, vq: vac.vq, vac0: vac.vac0, vac1: vac.vac1, aspect: vac.aspect }, map.write, [1 / map.read.w, 1 / map.read.h]);
          map.swap();
          run('show', { cam: camTex, map: map.read, hue: (colorShift * 2.4) % (Math.PI * 2), band: params.mode === 'psychedelic' ? 60 : 0 }, null, [1 / W, 1 / H]);
        }
        ctx.drawImage(canvas, 0, 0);

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and move your fingers through the picture.');
      },
      reset: function () {
        if (!ok || !W) return;
        [vel.read, vel.write, act.read, act.write, map.read, map.write, pig.read, pig.write, prs.read, prs.write].forEach(function (tg) {
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
