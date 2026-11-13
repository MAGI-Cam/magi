// Aurora: light through a prism held in your hand — a beam that pinches to a waist at your palm and
// fans out on either side into rainbow ribbons that wave (after a reference of a light-dispersion
// design tool).
//
// The beam is a Gaussian beam: across it the intensity falls as e^(−2v²/w²), and its width grows
// away from the waist as w(u) = w₀·√(1 + (u/z_R)²) (z_R the Rayleigh length), its peak falling as
// w₀/w so the light is conserved. Dispersion splits it by wavelength: glass bends each wavelength
// by its refractive index, given by Cauchy's equation n(λ) = A + B/λ² (B = 0.0042 µm², about BK7
// glass), so past the waist each of 12 wavelengths from 400 to 680 nm fans out at its own angle,
// ∝ n(λ) − n(550 nm): violet bends most, red least. Wavelengths become colors by Bruton's piecewise
// fit of the visible spectrum, summed and normalized so the undivided beam is white. The ribbon's
// center line waves, y = A·sin(k·u − ωt) growing away from the waist, and Ribbons stacks parallel
// sheets. Dark: light added onto the dimmed camera, tone-mapped 1 − e^(−E·x). Paper: the ribbons as
// pigment on cream paper (transmittance mixed toward each color by 1 − e^(−E·x), multiplied in).
// Drawn by a fragment shader at half resolution.
//
// Gesture: your hand is the prism. The waist sits at your palm; turning your hand aims the beam;
// how open your hand is sets the fan (fist: one tight white beam; open: the full spectrum). Pinch
// and drag up or down to make the ribbon wave; let go and it keeps waving, slowly calming
// (half-life 2.5 s). No hand: it hangs across the middle, drifting.
(function () {
  var NL = 12;
  var FRAG = [
    'precision highp float;',
    'uniform vec2 size, waist, dir;',
    'uniform vec3 norm;',
    'uniform float w0, zr, spread, amp, kw, phase, ribbons, expo, paper, gap, seed;',
    'varying vec2 uv;',
    'vec3 spectral(float l) {',
    '  vec3 c = l < 440.0 ? vec3(-(l - 440.0) / 60.0, 0.0, 1.0) : l < 490.0 ? vec3(0.0, (l - 440.0) / 50.0, 1.0) : l < 510.0 ? vec3(0.0, 1.0, -(l - 510.0) / 20.0)',
    '    : l < 580.0 ? vec3((l - 510.0) / 70.0, 1.0, 0.0) : l < 645.0 ? vec3(1.0, -(l - 645.0) / 65.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '  float f = l < 420.0 ? 0.3 + 0.7 * (l - 380.0) / 40.0 : l > 645.0 ? 0.3 + 0.7 * (700.0 - l) / 55.0 : 1.0;',
    '  return clamp(c, 0.0, 1.0) * f;',
    '}',
    'float cauchy(float l) { float um = l / 1000.0; return 1.5046 + 0.0042 / (um * um); }',
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'void main() {',
    '  vec2 px = uv * size, d = px - waist;',
    '  float u = dot(d, dir), v = dot(d, vec2(-dir.y, dir.x));',
    '  float w = w0 * sqrt(1.0 + (u / zr) * (u / zr)), peak = w0 / w, au = abs(u);',
    '  float grow = smoothstep(0.0, zr * 3.0, au);',
    '  float n0 = cauchy(550.0), dn = cauchy(400.0) - cauchy(680.0);',
    '  vec3 acc = vec3(0.0);',
    '  for (int r = 0; r < 5; r++) {',
    '    if (float(r) >= ribbons) break;',
    '    float off = (float(r) - (ribbons - 1.0) * 0.5) * gap * (0.4 + grow);',
    '    float c0 = amp * grow * sin(kw * u - phase + float(r) * 0.9) + off;',
    '    for (int i = 0; i < ' + NL + '; i++) {',
    '      float l = 400.0 + 280.0 * (float(i) + 0.5) / ' + NL + '.0;',
    '      float disp = au * spread * (cauchy(l) - n0) / dn;',
    '      float y = v - c0 - disp;',
    '      acc += spectral(l) * exp(-2.0 * y * y / (w * w)) * peak;',
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

  // Bruton's fit, as in the shader, summed over the samples: dividing by it makes the whole beam white.
  function spectral(l) {
    var c = l < 440 ? [-(l - 440) / 60, 0, 1] : l < 490 ? [0, (l - 440) / 50, 1] : l < 510 ? [0, 1, -(l - 510) / 20] : l < 580 ? [(l - 510) / 70, 1, 0] : l < 645 ? [1, -(l - 645) / 65, 0] : [1, 0, 0];
    var f = l < 420 ? 0.3 + 0.7 * (l - 380) / 40 : l > 645 ? 0.3 + 0.7 * (700 - l) / 55 : 1;
    return c.map(function (x) { return Math.max(0, Math.min(1, x)) * f; });
  }
  var NORM = [0, 0, 0];
  for (var i = 0; i < NL; i++) { var c = spectral(400 + 280 * (i + 0.5) / NL); NORM[0] += c[0]; NORM[1] += c[1]; NORM[2] += c[2]; }

  Magi.renderers.aurora = function () {
    var pass, lastT = null, S = { x: null, y: null, ang: 0, open: 0.6, amp: 0 }, phase = 0, grab = null, ampHeld = 0;
    function openness(h) { var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0); return Math.max(0, Math.min(1, (o - 0.25) / 0.6)); }
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        var paper = params.mode === 'paper';
        ctx.fillStyle = (paper ? 'rgba(246,242,236,' : 'rgba(0,0,0,') + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, []);
        if (!pass) { frame.say('This effect needs WebGL.'); return; }

        var hands = Magi.interaction.read(frame).hands, hd = hands[0];
        var T = hd ? { x: hd.center.x, y: hd.center.y, ang: (hd.rotation || 0) * Math.PI / 180, open: hd.fist ? 0 : openness(hd) }
          : { x: W / 2 + Math.sin(t * 0.13) * W * 0.05, y: H / 2 + Math.sin(t * 0.17) * H * 0.04, ang: Math.sin(t * 0.09) * 0.18, open: 0.65 };
        if (S.x === null) { S.x = T.x; S.y = T.y; }
        var e = 1 - Math.exp(-dt / 0.18);
        S.x += (T.x - S.x) * e; S.y += (T.y - S.y) * e; S.open += (T.open - S.open) * e;
        S.ang += Math.atan2(Math.sin(T.ang - S.ang), Math.cos(T.ang - S.ang)) * e;
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

        var q = 2, w = Math.max(1, Math.round(W / q)), h = Math.max(1, Math.round(H / q)), k = 1 / q;
        pass.run(w, h, {
          size: [w, h], waist: [S.x * k, S.y * k], dir: [Math.cos(S.ang), Math.sin(S.ang)], norm: NORM,
          w0: Math.max(1.5, (0.004 + params.width / 100 * 0.03) * M * k), zr: M * 0.06 * k,
          spread: (0.02 + S.open * 0.9) * params.spread / 100 * 1.4,
          amp: S.amp * k, kw: 2 * Math.PI / (M * 0.9 * k), phase: phase, ribbons: Math.round(params.ribbons),
          gap: M * 0.035 * k, expo: 0.6 + params.exposure / 100 * 3, paper: paper ? 1 : 0, seed: (t * 60) % 997
        });
        ctx.save();
        ctx.globalCompositeOperation = paper ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(pass.canvas, 0, 0, W, H);
        ctx.restore();

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise your hand: it is the prism. Turn it to aim the light, open it to fan out the colors, pinch and drag to make it wave.');
      },
      reset: function () { lastT = null; S.x = null; ampHeld = 0; }
    };
  };
})();
