// Fibre: hundreds of thousands of particles on the graphics card, in six modes after a set of
// particle references. Runs on Magi.gpuParticles (see that file for the physics: Kinematic
// Simulation turbulence, the shell spring, tides, the plane spring, attractors, trails).
//
// The look comes from very many very fine points (1 px) added together, so brightness is density,
// and frame feedback (Trails), which turns each particle's path into a strand. Ink (switch): the
// same density absorbed on paper (e^(−E·density), Beer–Lambert), multiplied over a whitened camera.
// Camera: each particle takes the color of the video under it (Lookup Texture).
// Brightness is normalized by the expected density, about N·(1 − Trails decay)⁻¹ points spread over
// the shape's area, so changing Count or Trails doesn't change the exposure.
//
// Modes:
//   Fibre — a sphere: turbulence pulls particles off the shell, the shell's spring (Hold) pulls them
//     back; the balance reads as a smooth ball or a fur. One hand moves it, two hands hold it
//     between them; open palm lets the fibres fly (×2.2 turbulence, ×0.3 hold); fist pulls it tight
//     (×0.3, ×2.5, half the radius); pinch and drag turns it; a fast sweep blows the fibres away.
//   Tidal — the same sphere held in the middle, and your hand is a moon. Its tidal acceleration on
//     each particle, T·(3(r·n̂)n̂ − r) with T = GM/d³ (n̂ toward your palm, d its distance), raises two
//     opposite bulges that stream out into fibre tails along the line to your hand; the closer your
//     palm, the stronger (d⁻³). Open palm: a heavy moon (×2); fist: a light one (×0.4). No hand: the
//     moon circles slowly and the tides sweep around.
//   Horizon — particles pour along a line across the picture (a line emitter), held to it by a
//     plane spring (Hold) and lifted off it by turbulence, so it reads as a horizon breathing smoke.
//     A closed fist sets the line: it passes through your fist at your fist's angle (roll). An open
//     palm pushes the particles away from it (a repelling attractor), raising a plume where it is.
//   Lightbeam — a blade of light that follows your index finger, fluid like a sword trail in a
//     slicing game. The fingertip's recent path (smoothed by an adaptive low-pass, then a
//     Catmull-Rom spline through the samples) is drawn as a ribbon that is widest at the finger and
//     tapers to nothing at its tail, as each point ages over the trail's lifetime (0.25 s with
//     Trails at 0, up to 4 s for long-exposure loops). Faster strokes draw thinner and brighter.
//     Three passes added like light: a wide colored glow, a band and a white-hot core. Each new
//     stroke takes the next color (white, then, with Leak, gold, red and ice blue), and sparks fly
//     off fast strokes (short-lived GPU particles thrown along and across the motion). Leak (switch):
//     warm light leaks drift at the picture's edges. Flash (switch): a pinch flashes the background
//     white. Fist: wipes every stroke.
//   Thundercloud — a dense ball of particles (born uniformly in its volume, radius ∝ ∛u) churned
//     slowly by fine turbulence and held hard by a pull to its center, grey at the edge and glowing at
//     its heart: each particle's color blends toward the Core color the nearer it is to the center
//     (fully inside 15% of the radius, not at all past 90%). Heavy: its center follows your palm as a
//     mass on a soft spring (1.2 Hz, ζ 0.45), lagging and overshooting. Open palm: it swells and
//     churns; fist: it compresses and heats. Pinch: lightning. It strikes inside the cloud on your
//     hand's side and lights the particles themselves: a searing glow at the strike and a shell of
//     light rippling out through the cloud at 2.2 units a second, flickering through four return
//     strokes (0, 90, 200 and 360 ms, each decaying in 50 ms), as real lightning does, with a faint
//     flash of the sky behind.
//   Symbiote — always ink, after an ink-on-paper particle reference: hundreds of thousands of fine
//     particles thrown off your hands (born at your 21 landmarks with your hand's velocity plus a
//     random push) keep their momentum (weak drag) through a broad, slow turbulence, so each one's
//     path is a long fine curve; the long trails turn the bundles of curves into feathery strokes,
//     dark where they crowd. Your palms pull gently, so the ink curls back around you. The faster
//     you move, the harder it lashes. No hand: it streams from a slowly wandering point.
(function () {
  // Blade colors for Lightbeam's strokes (white first; with Leak the rest in turn).
  var BLADE = [[255, 255, 255], [255, 196, 64], [255, 70, 40], [150, 210, 255]];
  // Catmull-Rom through the points (centripetal enough at these spacings), 4 samples a span.
  function spline(P) {
    if (P.length < 3) return P.slice();
    var out = [];
    for (var i = 0; i < P.length - 1; i++) {
      var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (var k = 0; k < 4; k++) {
        var s = k / 4, s2 = s * s, s3 = s2 * s;
        var f = function (a, b, c, d) { return 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3); };
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), t: p1.t + (p2.t - p1.t) * s });
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }

  function createFibre() {
    var sys = undefined, camCopy = document.createElement('canvas'), lastT = null, center = [0, 0, 0], radius = 0.5, view = { yaw: 0, pitch: 0.2 }, vel = { yaw: 0.15, pitch: 0 }, grab = null, seen = 0;
    var tk = { amp: 1, hold: 1, rad: 1, tide: 1, heat: 1 }, cvel = [0, 0, 0], strike = null, strokes = [], curStroke = null, strokeN = 0, tipS = null, lastMode = null, prevTip = null, lineAng = 0, lineY = 0, flash = 0, wasPinched = {}, wasFist = false;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, mode = params.mode || 'fibre';
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (sys === undefined) sys = Magi.gpuParticles();
        if (mode !== lastMode) { lastMode = mode; if (sys) sys.reset(); prevTip = null; strokes = []; curStroke = null; tipS = null; }
        // Camera colors are looked up in an undimmed quarter-size copy of the picture.
        if (params.camera) {
          var cw = Math.max(1, Math.round(W / 4)), ch = Math.max(1, Math.round(H / 4));
          if (camCopy.width !== cw || camCopy.height !== ch) { camCopy.width = cw; camCopy.height = ch; }
          camCopy.getContext('2d').drawImage(out, 0, 0, cw, ch);
        }
        var ink = mode === 'symbiote' || (mode !== 'lightbeam' && params.ink);
        ctx.fillStyle = (ink ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (!sys) { frame.say('Fibre needs WebGL2 with float textures, which this browser doesn’t offer.'); return; }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var aspect = W / H, toW = function (p) { return [(p.x / W * 2 - 1) * aspect, 1 - p.y / H * 2, 0]; };
        var ix = Magi.interaction.read(frame), hands = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1), hd = hands[0];
        var e = 1 - Math.exp(-dt / 0.25), baseR = 0.2 + params.size / 100 * 0.6, heavy = false;
        var turb = params.turbulence / 100, hold = params.hold / 100, kscale = 0.5 + params.scale / 100 * 2.5;
        var step = { dt: dt, time: t, count: 0, kscale: kscale, follow: 2.5, soft: 0.1, lifeMin: 3, lifeMax: 9, jitter: 0.04 };
        var look = { depthK: 0.6, areaR: radius, pivot: center, spin: true, trailsOverride: null };
        var want = { c: [0, 0, 0], r: baseR, amp: 1, hold: 1, rad: 1, tide: 1, heat: 1 }, attract = [];
        var pinchStart = hands.filter(function (h) { var s = h.pinched && !wasPinched[h.id]; return s; })[0];
        hands.forEach(function (h) { wasPinched[h.id] = h.pinched; });

        if (mode === 'fibre' || mode === 'tidal') {
          if (mode === 'fibre') {
            if (hands.length >= 2) {
              var a = toW(hands[0].center), b = toW(hands[1].center);
              want.c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]; want.r = Math.max(0.12, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 * 0.9);
            } else if (hd) want.c = toW(hd.center);
            hands.forEach(function (h) {
              if (h.fist) { want.amp *= 0.3; want.hold *= 2.5; want.rad *= 0.5; }
              else if (h.count >= 4 && !h.pinched) { want.amp *= 2.2; want.hold *= 0.3; }
              var sp = h.speed / H * 2;
              if (sp > 0.4) attract.push(toW(h.center).concat([-0.02 * sp]));
            });
          } else if (hd) want.tide = hd.fist ? 0.4 : hd.count >= 4 ? 2 : 1;
          step.amp = (0.05 + turb * 1.1) * tk.amp; step.shellK = hold * 45 * tk.hold; step.center = center; step.radius = radius * tk.rad;
          if (mode === 'tidal') {
            // The moon: your palm (or, with no hand, a point circling at 1.4 radii).
            var moon = hd ? toW(hd.center) : [Math.cos(t * 0.35) * radius * 1.4, Math.sin(t * 0.21) * radius * 0.3, Math.sin(t * 0.35) * radius * 1.4];
            var mx = moon[0] - center[0], my = moon[1] - center[1], mz = moon[2] - center[2], md = Math.max(radius * 0.9, Math.hypot(mx, my, mz));
            step.tideN = [mx / md, my / md, mz / md];
            // Equilibrium along n̂: the shell spring K pulls back by K(r − R) while the tide pushes out by
            // 2T·r, so r = K·R/(K − 2T); across n̂, r = K·R/(K + T). T is capped at 0.15·K: bulges of
            // 1.43 R toward and away from the moon, 0.87 R across, the tidal ellipsoid; turbulence
            // then streams the bulges into tails.
            step.shellK = 10 + hold * 40;
            step.tideK = Math.min(0.15, 0.1 * Math.pow(radius * 1.6 / md, 3)) * step.shellK * tk.tide;
          }
          step.jitter = 0.04;
        } else if (mode === 'horizon') {
          // The line: through a closed fist at its angle, else level across the middle.
          var fist = hands.filter(function (h) { return h.fist; })[0];
          if (fist) { var fc = toW(fist.center); lineY += (fc[1] - lineY) * e; var ra = -fist.rotation * Math.PI / 180; lineAng += (Math.atan2(Math.sin(ra), Math.cos(ra)) - lineAng) * e; }
          else { lineY += (0 - lineY) * e * 0.3; lineAng += (0 - lineAng) * e * 0.3; }
          var dx = Math.cos(lineAng), dy = Math.sin(lineAng), L = aspect * 2.4, lc = [0, lineY, 0];
          step.emitShape = 1; step.lineA = [lc[0] - dx * L, lc[1] - dy * L, 0]; step.lineB = [lc[0] + dx * L, lc[1] + dy * L, 0];
          step.planeK = 4 + hold * 40; step.planeP = lc; step.planeN = [-dy, dx, 0];
          step.amp = 0.03 + turb * 0.5; step.jitter = 0.01; step.lifeMin = 2; step.lifeMax = 7; step.center = lc;
          hands.forEach(function (h) { if (!h.fist && h.count >= 4) attract.push(toW(h.center).concat([-0.02 - 0.03 * Math.min(2, h.speed / H)])); });
          look.areaR = 0.25; look.pivot = [0, 0, 0]; look.spin = false; look.depthK = 0.2;
        } else if (mode === 'lightbeam') {
          // The blade: smooth the fingertip, extend the current stroke, age every stroke.
          var painter = hands.filter(function (h) { return h.fingers.index.extended && !h.pinched && !h.fist; })[0];
          var lifeS = 0.25 + params.trails / 100 * 3.75;
          if (painter) {
            var raw = painter.points[8];
            if (!tipS) tipS = { x: raw.x, y: raw.y };
            var spd = Math.hypot(raw.x - tipS.x, raw.y - tipS.y) / Math.max(dt, 1e-3) / H, fc = 3 + 12 * spd, al = 1 - Math.exp(-2 * Math.PI * fc * dt);
            tipS.x += (raw.x - tipS.x) * al; tipS.y += (raw.y - tipS.y) * al;
            if (!curStroke) { curStroke = { pts: [], color: BLADE[strokeN++ % (params.leak ? BLADE.length : 1)] }; strokes.push(curStroke); }
            var lp = curStroke.pts[curStroke.pts.length - 1];
            if (!lp || Math.hypot(tipS.x - lp.x, tipS.y - lp.y) > 1.5) curStroke.pts.push({ x: tipS.x, y: tipS.y, t: t });
          } else { curStroke = null; tipS = null; }
          strokes.forEach(function (S2) { S2.pts = S2.pts.filter(function (q) { return t - q.t < lifeS; }); });
          strokes = strokes.filter(function (S2) { return S2.pts.length > 1 || S2 === curStroke; });
          var fistNow = hands.some(function (h) { return h.fist; });
          if (fistNow && !wasFist) { strokes = []; curStroke = null; }
          wasFist = fistNow;
          // Sparks off fast strokes.
          var tipW = tipS ? toW(tipS) : null, spdW = 0, dir = [0, 0, 0];
          if (tipW && prevTip) { dir = [(tipW[0] - prevTip[0]) / dt, (tipW[1] - prevTip[1]) / dt, 0]; spdW = Math.hypot(dir[0], dir[1]); }
          step.emitShape = 1; step.emitOn = !!tipW && spdW > 0.8;
          if (tipW) { step.lineA = prevTip || tipW; step.lineB = tipW; }
          prevTip = tipW;
          step.birthVel = [dir[0] * 0.15, dir[1] * 0.15, 0]; step.birthSpread = 0.5; step.amp = 0.05; step.follow = 0.6; step.gravity = [0, -0.6, 0];
          step.jitter = 0.004; step.lifeMin = 0.2; step.lifeMax = 0.7;
          look.areaR = 0.08; look.pivot = [0, 0, 0]; look.spin = false; look.depthK = 0; look.trailsOverride = 0.6; look.lifeS = lifeS;
          if (params.flash && pinchStart) flash = 1;
        } else if (mode === 'thundercloud') {
          if (hd) want.c = toW(hd.center);
          hands.forEach(function (h) {
            if (h.fist) { want.rad *= 0.7; want.heat *= 2.2; want.amp *= 0.7; }
            else if (h.count >= 4 && !h.pinched) { want.rad *= 1.35; want.amp *= 1.5; }
            if (h.pinched && pinchStart === h) {
              var hw = toW(h.center), hx = hw[0] - center[0], hy = hw[1] - center[1], hl = Math.hypot(hx, hy) || 1, Rn = radius * tk.rad;
              strike = { at: t, c: [center[0] + hx / hl * Rn * 0.5 + (Math.random() - 0.5) * Rn * 0.3, center[1] + hy / hl * Rn * 0.5 + (Math.random() - 0.5) * Rn * 0.3, (Math.random() - 0.5) * Rn * 0.4] };
            }
          });
          step.emitShape = 3; step.center = center; step.radius = radius * tk.rad * 0.75; step.amp = (0.04 + turb * 0.35) * tk.amp; step.follow = 1.2; step.kscale = kscale * 1.8;
          step.lifeMin = 4; step.lifeMax = 10; step.soft = 0.35; attract.push(center.concat([0.05 * (0.5 + hold) * (1 + (tk.heat - 1) * 0.6)]));
          look.coreK = 0.75 * tk.heat; look.depthK = 0.5; look.areaR = radius * tk.rad * 0.75;
          heavy = true;
        } else if (mode === 'symbiote') {
          var emit = [], hv = [0, 0, 0], hs = 0;
          hands.forEach(function (h) {
            h.points.forEach(function (q) { emit.push(toW(q)); });
            attract.push(toW(h.center).concat([0.008 * (0.4 + hold)]));
            hv[0] += h.velocity.x / W * 2 * aspect; hv[1] -= h.velocity.y / H * 2; hs = Math.max(hs, h.speed / H);
          });
          if (hands.length) hv = hv.map(function (v) { return v / hands.length; });
          want.amp *= 1 + Math.min(3, hs * 1.5);
          if (emit.length) { step.emitShape = 2; step.emitPoints = emit; step.jitter = 0.06; }
          else { step.emitShape = 2; step.emitPoints = [[Math.sin(t * 0.5) * 0.25, Math.cos(t * 0.37) * 0.15, 0]]; step.jitter = 0.04; }
          step.birthVel = [hv[0] * 0.35, hv[1] * 0.35, 0]; step.birthSpread = 0.25 + Math.min(0.6, hs * 0.3);
          step.amp = (0.1 + turb * 0.5) * tk.amp; step.follow = 0.7; step.lifeMin = 2; step.lifeMax = 6; step.kscale = kscale * 0.7;
          look.areaR = 0.6; look.pivot = [0, 0, 0]; look.spin = false; look.depthK = 0.2; look.trailsOverride = 0.985;
        }
        if (heavy) {
          // A mass on a soft spring: 1.2 Hz, damping ratio 0.45, so it lags and overshoots.
          var wcn = 2 * Math.PI * 1.2;
          center = center.map(function (v, i) { cvel[i] += (wcn * wcn * (want.c[i] - v) - 2 * 0.45 * wcn * cvel[i]) * dt; return v + cvel[i] * dt; });
        } else center = center.map(function (v, i) { return v + (want.c[i] - v) * e; });
        radius += (want.r - radius) * e;
        ['amp', 'hold', 'rad', 'tide', 'heat'].forEach(function (k) { tk[k] += (want[k] - tk[k]) * e; });
        flash *= Math.exp(-dt / 0.3);
        // Lightning's return strokes: four pulses, each decaying in 50 ms, and a shell of light that
        // restarts from the strike with each.
        var flashI = 0, waveR = 0;
        if (strike) {
          var ts = t - strike.at, last = 0;
          [0, 0.09, 0.2, 0.36].forEach(function (tk2, k2) { if (ts >= tk2) { flashI += Math.exp(-(ts - tk2) / 0.05) * (1 - k2 * 0.15); last = tk2; } });
          waveR = (ts - last) * 2.2;
          if (ts > 0.9) strike = null; else flash = Math.max(flash, flashI * 0.25);
        }

        // Turning (sphere modes): pinch and drag, momentum, swipes.
        if (look.spin && mode !== 'thundercloud') {
          var pincher = hands.filter(function (h) { return h.pinched; })[0];
          if (pincher) {
            var m = { x: (pincher.points[4].x + pincher.points[8].x) / 2, y: (pincher.points[4].y + pincher.points[8].y) / 2 };
            if (grab && grab.id === pincher.id) {
              var dyw = (m.x - grab.x) / W * Math.PI * 1.6, dp = (m.y - grab.y) / H * Math.PI * 0.9;
              view.yaw += dyw; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + dp));
              vel.yaw += (dyw / dt - vel.yaw) * 0.3; vel.pitch += (dp / dt - vel.pitch) * 0.3;
            } else vel.yaw = vel.pitch = 0;
            grab = { id: pincher.id, x: m.x, y: m.y };
          } else grab = null;
        }
        if (!grab) {
          var dk = Math.exp(-dt / 0.8);
          if (look.spin) { view.yaw += vel.yaw * dt; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + vel.pitch * dt)); vel.yaw = hands.length ? vel.yaw * dk : vel.yaw + (0.15 - vel.yaw) * (1 - dk); vel.pitch *= dk; }
          else { view.yaw *= dk; view.pitch *= dk; }
        }
        ix.events.forEach(function (ev) { if (ev.n <= seen) return; seen = ev.n; if (look.spin && ev.type === 'swipe' && (ev.dir === 'left' || ev.dir === 'right')) vel.yaw += ev.dir === 'right' ? 4 : -4; });

        // Simulate.
        var N = Math.round(params.count) * 1000;
        if (mode === 'lightbeam') N = Math.min(N, 40000);
        sys.setCount(N);
        step.count = N; step.attract = attract;
        sys.step(step);

        // Draw at up to 1280 px on the long side.
        var sL = Math.min(1, 1280 / Math.max(W, H)), w = Math.max(1, Math.round(W * sL)), h = Math.max(1, Math.round(H * sL));
        var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        // view = Rx(pitch)·Ry(yaw), column-major for GLSL.
        var M = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
        var decay = look.trailsOverride !== null ? look.trailsOverride : 1 - (0.5 * (1 - params.trails / 100) + 0.012);
        var areaPx = mode === 'horizon' ? (look.areaR * h) * w : Math.PI * Math.pow((mode === 'fibre' || mode === 'tidal' || mode === 'thundercloud' ? radius * tk.rad : look.areaR) * h / 2, 2);
        var nEff = sys.count() / (1 - decay);
        var col = params.color ? Magi.fx.inkColor(params.color) : mode === 'thundercloud' ? [0.62, 0.62, 0.66] : [1, 1, 1];
        if (ink) col = col.map(function (v) { return params.color ? 1 - v : 1; });
        var brightK = mode === 'lightbeam' ? 0.5 : mode === 'thundercloud' ? 0.1 : mode === 'symbiote' ? 0.05 : 0.45;
        sys.draw({
          w: w, h: h, view: M, pivot: look.pivot, color: col, focal: 3, psize: Math.max(1, Math.round((mode === 'lightbeam' ? 1.2 : 0.8) * u * sL)),
          bright: mode === 'lightbeam' ? brightK : brightK * areaPx / nEff, decay: decay, exposure: 0.3 + params.exposure / 100 * 2.4,
          glow: (params.glow / 100) * (mode === 'lightbeam' || mode === 'thundercloud' ? 2.2 : 1.5) * (1 + flashI * 1.5), ink: ink,
          useCam: params.camera, cam: params.camera ? camCopy : null, depthK: look.depthK,
          accent: [1, 0.6, 0.2], accentShare: mode === 'lightbeam' ? 0.4 : 0,
          coreColor: params.core ? Magi.fx.inkColor(params.core) : [1, 0.36, 0.12], coreK: look.coreK || 0, coreR: radius * tk.rad * 0.75 * 0.9, coreC: center,
          flashI: flashI, waveR: waveR, flashC: strike ? strike.c : [0, 0, 0]
        });
        ctx.save();
        // Flash (Lightbeam, Thundercloud): a white flash over the background, under the light.
        if (flash > 0.02 && (mode === 'lightbeam' || mode === 'thundercloud')) { ctx.fillStyle = (mode === 'lightbeam' ? 'rgba(255,255,255,' : 'rgba(200,215,255,') + (flash * (mode === 'lightbeam' ? 0.85 : 0.6)).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
        ctx.globalCompositeOperation = ink ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sys.canvas, 0, 0, W, H);
        // The blades (Lightbeam): each stroke a tapered ribbon, glow, band and core, added like light.
        if (mode === 'lightbeam') {
          ctx.globalCompositeOperation = 'lighter';
          var W0 = (4 + params.size / 100 * 16) * u;
          strokes.forEach(function (S2) {
            var P = spline(S2.pts);
            if (P.length < 2) return;
            var L = [], R = [];
            for (var i = 0; i < P.length; i++) {
              var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
              var age = Math.max(0, Math.min(1, (t - P[i].t) / look.lifeS)), sp2 = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-3, Math.abs(b.t - a.t) || dt) / H;
              var wdt = W0 * Math.pow(1 - age, 0.9) / (1 + 0.25 * Math.min(4, sp2));
              L.push([P[i].x + nx / nl * wdt, P[i].y + ny / nl * wdt]); R.push([P[i].x - nx / nl * wdt, P[i].y - ny / nl * wdt]);
            }
            var c = S2.color;
            [[1, 3.2, 0.18], [0, 1.6, 0.55], [1, 0.55, 1]].forEach(function (ps) {
              var cc = ps[0] && ps[2] === 1 ? [255, 255, 255] : c, k = ps[1];
              ctx.fillStyle = 'rgba(' + cc.join(',') + ',' + ps[2] + ')';
              ctx.beginPath();
              L.forEach(function (q, i) { var m = P[i], x = m.x + (q[0] - m.x) * k, y = m.y + (q[1] - m.y) * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
              for (var j = R.length - 1; j >= 0; j--) { var m2 = P[j]; ctx.lineTo(m2.x + (R[j][0] - m2.x) * k, m2.y + (R[j][1] - m2.y) * k); }
              ctx.closePath(); ctx.fill();
            });
          });
        }
        // Light leaks (Lightbeam): warm gradients drifting along the edges, added like light.
        if (mode === 'lightbeam' && params.leak) {
          ctx.globalCompositeOperation = 'lighter';
          [[0.05 + 0.04 * Math.sin(t * 0.3), 0.2 + 0.1 * Math.sin(t * 0.21), '255,80,20'], [0.95, 0.75 + 0.1 * Math.cos(t * 0.17), '255,170,40'], [0.6 + 0.2 * Math.sin(t * 0.11), 1.02, '255,40,60']].forEach(function (L) {
            var gx = L[0] * W, gy = L[1] * H, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.45);
            gr.addColorStop(0, 'rgba(' + L[2] + ',0.28)'); gr.addColorStop(1, 'rgba(' + L[2] + ',0)');
            ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
          });
        }
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say({
          fibre: 'Open your hand to let the fibres fly, make a fist to pull them in, pinch and drag to turn it.',
          tidal: 'Raise your hand: it is a moon. Bring it close and the tides stream toward it.',
          horizon: 'Close a fist to set the horizon and turn it to tilt the line. Open your hand to raise a plume.',
          lightbeam: 'Raise your index finger and draw with light. Fist wipes it; pinch flashes.',
          thundercloud: 'Raise your hand to move the cloud. Fist heats it, open palm swells it, pinch for lightning.',
          symbiote: 'Raise your hands: the ink grows from them and lashes when you move.'
        }[mode]);
      },
      reset: function () { lastT = null; grab = null; prevTip = null; strike = null; strokes = []; curStroke = null; tipS = null; if (sys) sys.reset(); }
    };
  }

  Magi.renderers.fibre = createFibre;
})();
