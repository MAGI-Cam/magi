// Aurora: light held in your hands, in four shapes (after references of a light-dispersion design
// tool and a geomagnetic field diagram with its auroral ovals).
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
//     pow(½ + ½cos(nθ + wobble), 16) around it, dark at the center and fading outward. Each ribbon
//     is another layer of rays.
//   Oval: the auroral oval, rings around your palm as the pole (an ellipse, as the oval looks from
//     an angle), each ring folded by a sine around it; ribbons are rings, one outside another.
// Ribbons are laid out from the middle outward in a fixed order, so adding one never moves the
// others; the newest fades in and out with the fractional part of the count. Each ribbon's center
// line waves, A·sin(k·u − ωt). Dark: light added onto the dimmed camera, tone-mapped 1 − e^(−E·x).
// Paper: the ribbons as pigment on cream paper. A fragment shader, at half resolution (a third
// above 8 ribbons, a quarter above 20).
//
// Gesture: each hand holds its own light (two hands, two lights). The shape centers on the palm,
// and turning the hand turns it (aims the beam, tilts the curtain, spins the corona and oval).
// Keep the hand open and ribbons keep coming (up to 4 a second, faster the wider open), close it
// and they go (up to 6 a second), down to one; half-open holds the count. Pinch and drag up or
// down to make the ribbons wave; let go and they slowly calm (half-life 2.5 s). Swipe left or
// right: the next palette. Swipe up or down: the next shape. No hand: one light hangs in the
// middle, drifting, with Ribbons ribbons.
(function () {
  var NL = 8, MAXR = 48, SHAPES = ['beam', 'curtain', 'corona', 'oval'], SHAPE_ID = { beam: 0, curtain: 1, corona: 2, oval: 5 };
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
    '  for (int r = 0; r < ' + MAXR + '; r++) {',
    '    float rf = float(r); if (rf >= ceil(ribbons)) break;',
    '    float wr = clamp(ribbons - rf, 0.0, 1.0);',               // the last ribbon fades in and out
    // Ribbons are laid out from the middle outward in a fixed order (0, +1, −1, +2, −2 …), so a
    // ribbon being added never moves the others: it only fades in at the edge.
    '    float rc = mod(rf, 2.0) > 0.5 ? (rf + 1.0) * 0.5 : -rf * 0.5;',
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
    var pass, lastT = null, phase = 0, seen = 0;
    // One light per hand (two at most), each with its own place, angle, ribbons and wave.
    function light() { return { x: null, y: null, ang: 0, open: 0.6, amp: 0, rib: null, grab: null, held: 0 }; }
    var L = [light(), light()];
    function openness(h) { var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0); return Math.max(0, Math.min(1, (o - 0.25) / 0.6)); }
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        var paper = !!params.paper, mode = SHAPE_ID[params.mode] === undefined ? 'beam' : params.mode, shape = SHAPE_ID[mode], si = SHAPES.indexOf(mode);
        ctx.fillStyle = (paper ? 'rgba(246,242,236,' : 'rgba(0,0,0,') + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, []);
        if (!pass) { frame.say('This effect needs WebGL.'); return; }

        var ix = Magi.interaction.read(frame), hands = ix.hands.slice(0, 2).sort(function (a, b) { return a.center.x - b.center.x; });
        // Swipes: left/right the palette, up/down the shape.
        ix.events.forEach(function (ev) {
          if (ev.n <= seen) return; seen = ev.n;
          if (ev.type !== 'swipe') return;
          if (ev.dir === 'left' || ev.dir === 'right') frame.setParam('palette', (Math.round(params.palette) + (ev.dir === 'right' ? 1 : PALETTES.length - 1)) % PALETTES.length);
          else frame.setParam('mode', SHAPES[(si + (ev.dir === 'down' ? 1 : SHAPES.length - 1)) % SHAPES.length]);
        });
        phase += dt * (0.4 + params.speed / 100 * 3);
        var e = 1 - Math.exp(-dt / 0.18), baseAmp = params.wave / 100 * M * 0.12;
        var pi = Math.max(0, Math.min(PALETTES.length - 1, Math.round(params.palette))), P = PALETTES[pi] || PALETTES[1];
        var n = Math.max(1, hands.length);
        for (var li = 0; li < n; li++) {
          var S = L[li], hd = hands[li];
          var T = hd ? { x: hd.center.x, y: hd.center.y, ang: (hd.rotation || 0) * Math.PI / 180, open: hd.fist ? 0 : openness(hd) }
            : { x: W / 2 + Math.sin(t * 0.13) * W * 0.05, y: H / 2 + Math.sin(t * 0.17) * H * 0.04, ang: Math.sin(t * 0.09) * 0.18 + (shape >= 2 ? t * 0.05 : 0), open: 0.5 };
          if (S.x === null) { S.x = T.x; S.y = T.y; S.ang = T.ang; }
          if (S.rib === null) S.rib = Math.round(params.ribbons);
          S.x += (T.x - S.x) * e; S.y += (T.y - S.y) * e; S.open += (T.open - S.open) * e;
          S.ang += Math.atan2(Math.sin(T.ang - S.ang), Math.cos(T.ang - S.ang)) * e;
          // Ribbons with no end but the shader's 48: an open hand keeps adding them (up to 4 a
          // second, the wider open the faster), a closing hand takes them away (up to 6 a second,
          // a fist fastest), down to 1; in between they hold. With no hand they drift back to
          // Ribbons. The last ribbon fades in and out with its fractional part.
          if (hd) {
            var o = S.open, rate = o > 0.6 ? (o - 0.6) / 0.4 * 4 : o < 0.35 ? -(0.35 - o) / 0.35 * 6 : 0;
            S.rib = Math.max(1, Math.min(MAXR, S.rib + rate * dt));
          } else S.rib += (Math.round(params.ribbons) - S.rib) * (1 - Math.exp(-dt / 1.5));
          // Pinch and drag: the vertical drag sets the wave's height; released, it calms (half-life 2.5 s).
          if (hd && hd.pinched) {
            var py = (hd.points[4].y + hd.points[8].y) / 2;
            if (!S.grab) S.grab = { y: py, a0: S.held };
            S.held = Math.max(-M * 0.3, Math.min(M * 0.3, S.grab.a0 + (py - S.grab.y) * 1.5));
          } else { S.grab = null; S.held *= Math.pow(0.5, dt / 2.5); }
          S.amp += ((baseAmp + Math.abs(S.held)) * (S.held < 0 ? -1 : 1) - S.amp) * e;

          var q = S.rib > 20 ? 4 : S.rib > 8 ? 3 : 2, w = Math.max(1, Math.round(W / q)), h = Math.max(1, Math.round(H / q)), k = 1 / q;
          pass.run(w, h, {
            size: [w, h], waist: [S.x * k, S.y * k], dir: [Math.cos(S.ang), Math.sin(S.ang)], norm: normOf(pi),
            c0: P[0], c1: P[1], c2: P[2], c3: P[3], spectrum: pi ? 0 : 1, shape: shape, M: M * k,
            w0: Math.max(1.5, (0.004 + params.width / 100 * 0.03) * M * k), zr: M * 0.06 * k,
            spread: (0.15 + 0.85 * Math.max(0.2, S.open)) * params.spread / 100 * 1.4,
            amp: S.amp * k, kw: 2 * Math.PI / (M * 0.9 * k), phase: phase + li * 1.7, ribbons: S.rib,
            gap: M * 0.035 * k, expo: (0.6 + params.exposure / 100 * 3) / Math.pow(Math.max(1, S.rib / 3), 0.85) / Math.sqrt(n), paper: paper ? 1 : 0, seed: (t * 60 + li * 13) % 997
          });
          ctx.save();
          ctx.globalCompositeOperation = paper ? 'multiply' : 'lighter';
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(pass.canvas, 0, 0, W, H);
          ctx.restore();
        }
        if (hands.length < 2) L[1] = light();

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise a hand (or two): each holds a light. Turn it to turn the shape; keep it open to add ribbons, close it to take them away; swipe for colors and shapes.');
      },
      reset: function () { lastT = null; L = [light(), light()]; }
    };
  };
})();
