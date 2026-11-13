// Aurora: light held in your hand, in six shapes (after references of a light-dispersion design
// tool, a geomagnetic field diagram with its auroral ovals, and the Parker spiral).
//
// Every shape is a set of ribbons of light. Across a ribbon the intensity falls as a Gaussian,
// e^(−2y²/w²), as in a laser beam's cross-section, and each ribbon is split by dispersion into 8
// wavelengths from 400 to 680 nm: glass bends each by its refractive index, given by Cauchy's
// equation n(λ) = A + B/λ² (B = 0.0042 µm², about BK7), so each wavelength's copy of the ribbon is
// displaced by Spread × (n(λ) − n(550 nm)) / (n(400) − n(680)) — violet most, red least, the other
// way. Colors come from the palette, sampled by wavelength (Spectrum: Bruton's fit of the visible
// spectrum), summed and normalized so the undivided light is white.
//   Beam: a Gaussian beam pinched to a waist at your palm, w(u) = w₀√(1 + (u/z_R)²) (z_R the
//     Rayleigh length), its peak falling as w₀/w; dispersion fans it out away from the waist.
//   Curtain: an auroral curtain, a folded sheet with a sharp lower edge (a Gaussian below it) and
//     a glow fading upward over ~4 widths (an exponential), striated by vertical rays; dispersion
//     stacks the colors by height. Ribbons are curtains one behind another.
//   Corona: rays streaming out from your palm, as an aurora looks straight overhead: brightness
//     pow(½ + ½cos(nθ + wobble), 8) around it, dark at the center and fading outward. Each ribbon
//     is another layer of rays.
//   Swirl: the Parker spiral, the shape the solar wind's magnetic field takes as the Sun turns:
//     along an arm r = b(φ − φ₀) (an Archimedean spiral, b = wind speed / spin rate). Ribbons are
//     arms, spaced evenly around the center.
//   Rays: a fan of straight beams from your palm, spread across Spread, each dispersed sideways.
//   Oval: the auroral oval, rings around your palm as the pole (an ellipse, as the oval looks from
//     an angle), each ring folded by a sine around it; Ribbons are rings, one outside another.
// Each ribbon's center line waves, A·sin(k·u − ωt). Dark: light added onto the dimmed camera,
// tone-mapped 1 − e^(−E·x). Paper: the ribbons as pigment on cream paper. A fragment shader, at
// half resolution (a third with more than 10 ribbons).
//
// Gesture: your hand holds the light. The shape centers on your palm, and turning your hand turns
// it (aims the beam and rays, tilts the curtain, spins the corona, swirl and oval). Opening your
// hand adds ribbons smoothly up to Ribbons; closing it takes them away (a fist: one). Pinch and
// drag up or down to make the ribbons wave; let go and they slowly calm (half-life 2.5 s). Swipe
// left or right: the next palette. Swipe up or down: the next shape. No hand: it hangs in the
// middle, drifting.
(function () {
  var NL = 8, SHAPES = ['beam', 'curtain', 'corona', 'swirl', 'rays', 'oval'];
  // Palettes, four stops sampled by wavelength (short to long). 0 is the spectrum itself.
  var PALETTES = [
    null,
    [[0.55, 0.25, 1.0], [0.15, 0.85, 0.85], [0.1, 1.0, 0.45], [1.0, 0.25, 0.45]],   // Aurora
    [[0.6, 0.5, 1.0], [0.2, 0.35, 1.0], [0.2, 0.8, 1.0], [0.75, 0.92, 1.0]],         // Ice
    [[0.8, 0.1, 0.5], [1.0, 0.15, 0.1], [1.0, 0.5, 0.1], [1.0, 0.85, 0.3]],          // Ember
    [[0.7, 0.4, 0.1], [0.95, 0.6, 0.15], [1.0, 0.8, 0.35], [1.0, 0.95, 0.7]],        // Gold
    [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]                                      // White
  ];
  var FRAG = [
    'precision highp float;',
    'uniform vec2 size, waist, dir;',
    'uniform vec3 norm, c0, c1, c2, c3;',
    'uniform float w0, zr, spread, amp, kw, phase, ribbons, expo, paper, gap, seed, shape, spectrum, M;',
    'varying vec2 uv;',
    'vec3 bruton(float l) {',
    '  vec3 c = l < 440.0 ? vec3(-(l - 440.0) / 60.0, 0.0, 1.0) : l < 490.0 ? vec3(0.0, (l - 440.0) / 50.0, 1.0) : l < 510.0 ? vec3(0.0, 1.0, -(l - 510.0) / 20.0)',
    '    : l < 580.0 ? vec3((l - 510.0) / 70.0, 1.0, 0.0) : l < 645.0 ? vec3(1.0, -(l - 645.0) / 65.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '  float f = l < 420.0 ? 0.3 + 0.7 * (l - 380.0) / 40.0 : l > 645.0 ? 0.3 + 0.7 * (700.0 - l) / 55.0 : 1.0;',
    '  return clamp(c, 0.0, 1.0) * f;',
    '}',
    'vec3 pal(float t) { return t < 1.0 / 3.0 ? mix(c0, c1, t * 3.0) : t < 2.0 / 3.0 ? mix(c1, c2, t * 3.0 - 1.0) : mix(c2, c3, t * 3.0 - 2.0); }',
    'float cauchy(float l) { float um = l / 1000.0; return 1.5046 + 0.0042 / (um * um); }',
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'void main() {',
    '  vec2 px = uv * size, d = px - waist;',
    '  float u = dot(d, dir), v = dot(d, vec2(-dir.y, dir.x)), rad = length(d), th = atan(v, u);',
    '  float n0 = cauchy(550.0), dn = cauchy(400.0) - cauchy(680.0);',
    '  vec3 acc = vec3(0.0);',
    '  for (int r = 0; r < 20; r++) {',
    '    float rf = float(r); if (rf >= ceil(ribbons)) break;',
    '    float wr = clamp(ribbons - rf, 0.0, 1.0);',               // the last ribbon fades in and out
    '    float rc = rf - (ceil(ribbons) - 1.0) * 0.5;',
    '    for (int i = 0; i < ' + NL + '; i++) {',
    '      float t = (float(i) + 0.5) / ' + NL + '.0, l = 400.0 + 280.0 * t;',
    '      float delta = (cauchy(l) - n0) / dn;',                  // about −0.5 (red) … 0.5 (violet)
    '      vec3 col = spectrum > 0.5 ? bruton(l) : pal(t);',
    '      float I = 0.0;',
    '      if (shape < 0.5) {',                                     // Beam
    '        float w = w0 * sqrt(1.0 + (u / zr) * (u / zr)), grow = smoothstep(0.0, zr * 3.0, abs(u));',
    '        float y = v - amp * grow * sin(kw * u - phase + rf * 0.9) - rc * gap * (0.4 + grow) - abs(u) * spread * delta;',
    '        I = exp(-2.0 * y * y / (w * w)) * w0 / w;',
    '      } else if (shape < 1.5) {',                              // Curtain
    '        float base = amp * sin(kw * u - phase + rf * 1.3) + 0.5 * amp * sin(kw * 2.3 * u + phase * 0.7 + rf) + rc * gap * 1.2;',
    '        float y = v - base - spread * delta * M * 0.12;',
    '        float stri = 0.55 + 0.45 * sin(u * 0.09 + 3.0 * sin(u * 0.021 + phase * 0.4 + rf));',
    '        I = (y > 0.0 ? exp(-2.0 * y * y / (w0 * w0)) : exp(y / (w0 * 4.0))) * stri;',
    '      } else if (shape < 2.5) {',                              // Corona
    '        float nR = 7.0 + rf * 3.0, a = th + spread * delta * 0.12 + rf * 0.37;',
    '        float ray = pow(0.5 + 0.5 * cos(nR * a + 1.5 * sin(a * 3.0 + phase * 0.5 + rf) + amp / max(M, 1.0) * 6.0 * sin(rad * 0.02 - phase)), 16.0);',
    '        I = ray * smoothstep(M * 0.03, M * 0.14, rad) * exp(-rad / (M * 0.45)) * 0.6;',
    '      } else if (shape < 3.5) {',                              // Swirl (Parker spiral)
    '        float b = M * 0.07, ph0 = 6.2831853 * rf / max(ceil(ribbons), 1.0);',
    '        float psi = th - rad / b - ph0 + phase * 0.25 + amp / max(M, 1.0) * 3.0 * sin(rad * 0.03 - phase);',
    '        float dpsi = mod(psi + 3.1415927, 6.2831853) - 3.1415927;',
    '        float w = w0 * (1.0 + rad / (M * 0.25)), y = dpsi * rad - spread * delta * rad * 0.25;',
    '        I = exp(-2.0 * y * y / (w * w)) * smoothstep(0.0, M * 0.06, rad) * exp(-rad / (M * 0.8));',
    '      } else if (shape < 4.5) {',                              // Rays
    '        float fan = 0.35 + spread * 1.1, ar = rc / max(ceil(ribbons) - 1.0, 1.0) * fan;',
    '        float a = th - ar - delta * 0.05 * (0.3 + spread) - amp / max(M, 1.0) * 0.4 * sin(rad * 0.02 - phase + rf);',
    '        float w = w0 * (1.0 + rad / (M * 0.6)), y = a * rad;',
    '        I = u > 0.0 ? exp(-2.0 * y * y / (w * w)) * smoothstep(0.0, M * 0.04, rad) * exp(-rad / (M * 1.2)) : 0.0;',
    '      } else {',                                               // Oval
    '        vec2 q = vec2(u, v / 0.55); float rr = length(q), a = atan(q.y, q.x);',
    '        float r0 = M * (0.12 + 0.07 * rf) + amp * 0.35 * sin(5.0 * a + phase + rf * 1.1) + spread * delta * M * 0.05;',
    '        float y = rr - r0;',
    '        I = exp(-2.0 * y * y / (w0 * w0)) * (0.6 + 0.4 * sin(a * 9.0 + phase * 0.6 + rf));',
    '      }',
    '      acc += col * I * wr;',
    '    }',
    '  }',
    '  acc /= norm;',
    '  float g = (hash(px + seed) - 0.5) * 0.02;',
    '  if (paper > 0.5) {',
    '    float dens = 1.0 - exp(-expo * (acc.r + acc.g + acc.b) / 3.0);',
    '    vec3 hue = acc / max(1e-4, max(acc.r, max(acc.g, acc.b)));',
    '    gl_FragColor = vec4(clamp(mix(vec3(1.0), hue * 0.95, dens) + g, 0.0, 1.0), 1.0);',
    '  } else {',
    '    gl_FragColor = vec4(clamp(1.0 - exp(-expo * acc) + g, 0.0, 1.0), 1.0);',
    '  }',
    '}'
  ].join('\n');

  function bruton(l) {
    var c = l < 440 ? [-(l - 440) / 60, 0, 1] : l < 490 ? [0, (l - 440) / 50, 1] : l < 510 ? [0, 1, -(l - 510) / 20] : l < 580 ? [(l - 510) / 70, 1, 0] : l < 645 ? [1, -(l - 645) / 65, 0] : [1, 0, 0];
    var f = l < 420 ? 0.3 + 0.7 * (l - 380) / 40 : l > 645 ? 0.3 + 0.7 * (700 - l) / 55 : 1;
    return c.map(function (x) { return Math.max(0, Math.min(1, x)) * f; });
  }
  function palAt(P, t) {
    var seg = t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2, k = t * 3 - seg, a = P[seg], b = P[seg + 1];
    return a.map(function (v, j) { return v + (b[j] - v) * k; });
  }
  // The sum of the colors over the samples: dividing by it makes the whole light white.
  function normOf(pi) {
    var n = [0, 0, 0];
    for (var i = 0; i < NL; i++) {
      var t = (i + 0.5) / NL, c = pi ? palAt(PALETTES[pi], t) : bruton(400 + 280 * t);
      n[0] += c[0]; n[1] += c[1]; n[2] += c[2];
    }
    var m = Math.max(n[0], n[1], n[2]);
    return n.map(function (v) { return Math.max(v, m * 0.35); });
  }

  Magi.renderers.aurora = function () {
    var pass, lastT = null, S = { x: null, y: null, ang: 0, open: 0.6, amp: 0, rib: 3 }, phase = 0, grab = null, ampHeld = 0, seen = 0;
    function openness(h) { var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0); return Math.max(0, Math.min(1, (o - 0.25) / 0.6)); }
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        var paper = !!params.paper, shape = Math.max(0, SHAPES.indexOf(params.mode || 'beam'));
        ctx.fillStyle = (paper ? 'rgba(246,242,236,' : 'rgba(0,0,0,') + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, []);
        if (!pass) { frame.say('This effect needs WebGL.'); return; }

        var ix = Magi.interaction.read(frame), hands = ix.hands, hd = hands[0];
        // Swipes: left/right the palette, up/down the shape.
        ix.events.forEach(function (ev) {
          if (ev.n <= seen) return; seen = ev.n;
          if (ev.type !== 'swipe') return;
          if (ev.dir === 'left' || ev.dir === 'right') frame.setParam('palette', (Math.round(params.palette) + (ev.dir === 'right' ? 1 : PALETTES.length - 1)) % PALETTES.length);
          else frame.setParam('mode', SHAPES[(shape + (ev.dir === 'down' ? 1 : SHAPES.length - 1)) % SHAPES.length]);
        });
        var T = hd ? { x: hd.center.x, y: hd.center.y, ang: (hd.rotation || 0) * Math.PI / 180, open: hd.fist ? 0 : openness(hd) }
          : { x: W / 2 + Math.sin(t * 0.13) * W * 0.05, y: H / 2 + Math.sin(t * 0.17) * H * 0.04, ang: Math.sin(t * 0.09) * 0.18 + (shape >= 2 && shape !== 4 ? t * 0.05 : 0), open: 0.7 };
        if (S.x === null) { S.x = T.x; S.y = T.y; }
        var e = 1 - Math.exp(-dt / 0.18);
        S.x += (T.x - S.x) * e; S.y += (T.y - S.y) * e; S.open += (T.open - S.open) * e;
        S.ang += Math.atan2(Math.sin(T.ang - S.ang), Math.cos(T.ang - S.ang)) * e;
        // Ribbons: 1 with a fist, up to Ribbons with an open hand, changing smoothly (0.3 s).
        var ribT = 1 + S.open * (Math.round(params.ribbons) - 1);
        S.rib += (ribT - S.rib) * (1 - Math.exp(-dt / 0.3));
        // Pinch and drag: the vertical drag sets the wave's height; released, it calms (half-life 2.5 s).
        var pin = hands.filter(function (h) { return h.pinched; })[0];
        if (pin) {
          var py = (pin.points[4].y + pin.points[8].y) / 2;
          if (!grab) grab = { y: py, a0: ampHeld };
          ampHeld = Math.max(-M * 0.3, Math.min(M * 0.3, grab.a0 + (py - grab.y) * 1.5));
        } else { grab = null; ampHeld *= Math.pow(0.5, dt / 2.5); }
        var baseAmp = params.wave / 100 * M * 0.12;
        S.amp += ((baseAmp + Math.abs(ampHeld)) * (ampHeld < 0 ? -1 : 1) - S.amp) * e;
        phase += dt * (0.4 + params.speed / 100 * 3);

        var pi = Math.max(0, Math.min(PALETTES.length - 1, Math.round(params.palette))), P = PALETTES[pi] || PALETTES[1];
        var q = S.rib > 10 ? 3 : 2, w = Math.max(1, Math.round(W / q)), h = Math.max(1, Math.round(H / q)), k = 1 / q;
        pass.run(w, h, {
          size: [w, h], waist: [S.x * k, S.y * k], dir: [Math.cos(S.ang), Math.sin(S.ang)], norm: normOf(pi),
          c0: P[0], c1: P[1], c2: P[2], c3: P[3], spectrum: pi ? 0 : 1, shape: shape, M: M * k,
          w0: Math.max(1.5, (0.004 + params.width / 100 * 0.03) * M * k), zr: M * 0.06 * k,
          spread: (0.15 + 0.85 * Math.max(0.2, S.open)) * params.spread / 100 * 1.4,
          amp: S.amp * k, kw: 2 * Math.PI / (M * 0.9 * k), phase: phase, ribbons: Math.max(1, S.rib),
          gap: M * 0.035 * k, expo: (0.6 + params.exposure / 100 * 3) / Math.sqrt(Math.max(1, S.rib / 3)), paper: paper ? 1 : 0, seed: (t * 60) % 997
        });
        ctx.save();
        ctx.globalCompositeOperation = paper ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(pass.canvas, 0, 0, W, H);
        ctx.restore();

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise your hand: it holds the light. Turn it to turn the shape, open it for more ribbons, pinch and drag to make them wave; swipe for colors and shapes.');
      },
      reset: function () { lastT = null; S.x = null; ampHeld = 0; }
    };
  };
})();
