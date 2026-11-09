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
//   Lightbeam — light painting with your index finger: while your index finger is out, particles are
//     born all along the segment your fingertip moved this frame (so the stroke is continuous at
//     any speed) and stay where they are, glowing, for 2–12 s (Trails). Leak (switch): warm light
//     leaks drift at the picture's edges and some strokes come out red-orange. Flash (switch): a
//     pinch fires a white flash over the background. Fist: wipes the drawing.
//   Thundercloud — a solid ball of particles (born uniformly in its volume, radius ∝ ∛u) churned by
//     turbulence and held together by a pull to its center, grey at the edge and glowing red-orange
//     at its heart (color blended toward the core color within 90% of the radius). It follows your
//     palm; open palm: it swells and churns; fist: it compresses and heats. Pinch: lightning, a bolt
//     from the cloud to your fingertips drawn by midpoint displacement (each segment's midpoint
//     pushed sideways by up to half the remaining length, recursively, a fractal path), with a flash
//     of heat inside the cloud.
//   Symbiote — always ink: black strands that grow from your hands (born at your 21 landmarks) and
//     cling to them (attractors at your palms), lashing out when you move fast (turbulence × hand
//     speed) and leaving long wet strokes (long trails). No hand: a restless blob in the middle.
(function () {
  // A lightning bolt from a to b by midpoint displacement (Fournier, Fussell & Carpenter 1982).
  function bolt(a, b, rough, depth, out) {
    if (depth === 0) { out.push(b); return; }
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    var off = (Math.random() - 0.5) * l * rough, m = [mx - dy / l * off, my + dx / l * off];
    bolt(a, m, rough, depth - 1, out); bolt(m, b, rough, depth - 1, out);
  }

  function createFibre() {
    var sys = undefined, camCopy = document.createElement('canvas'), lastT = null, center = [0, 0, 0], radius = 0.5, view = { yaw: 0, pitch: 0.2 }, vel = { yaw: 0.15, pitch: 0 }, grab = null, seen = 0;
    var tk = { amp: 1, hold: 1, rad: 1, tide: 1, heat: 1 }, lastMode = null, prevTip = null, lineAng = 0, lineY = 0, flash = 0, bolts = [], wasPinched = {}, wasFist = false;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, mode = params.mode || 'fibre';
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (sys === undefined) sys = Magi.gpuParticles();
        if (mode !== lastMode) { lastMode = mode; if (sys) sys.reset(); prevTip = null; }
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
        var e = 1 - Math.exp(-dt / 0.25), baseR = 0.2 + params.size / 100 * 0.6;
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
          // Light painting: emit along the fingertip's path while the index finger is out.
          var painter = hands.filter(function (h) { return h.fingers.index.extended && !h.pinched && !h.fist; })[0];
          var tip = painter ? toW(painter.points[8]) : null;
          step.emitShape = 1; step.emitOn = !!tip;
          if (tip) { var from = prevTip || tip; step.lineA = from; step.lineB = tip; }
          prevTip = tip;
          var fistNow = hands.some(function (h) { return h.fist; });
          if (fistNow && !wasFist) sys.reset();
          wasFist = fistNow;
          var lifeS = 2 + params.trails / 100 * 10;
          step.amp = 0.004 + turb * 0.02; step.follow = 1; step.jitter = 0.003; step.lifeMin = lifeS * 0.8; step.lifeMax = lifeS;
          look.areaR = 0.08; look.pivot = [0, 0, 0]; look.spin = false; look.depthK = 0; look.trailsOverride = 0.55;
          if (params.flash && pinchStart) flash = 1;
        } else if (mode === 'thundercloud') {
          if (hd) want.c = toW(hd.center);
          hands.forEach(function (h) {
            if (h.fist) { want.rad *= 0.7; want.heat *= 2.2; want.amp *= 0.7; }
            else if (h.count >= 4 && !h.pinched) { want.rad *= 1.35; want.amp *= 1.5; }
            if (h.pinched && pinchStart === h) {
              var pm = h.points[8], c2 = [(center[0] / aspect + 1) / 2 * W, (1 - center[1]) / 2 * H];
              var path = [c2]; bolt(c2, [pm.x, pm.y], 0.55, 6, path); bolts.push({ path: path, born: t }); flash = 1;
            }
          });
          step.emitShape = 3; step.center = center; step.radius = radius * tk.rad; step.amp = (0.08 + turb * 0.7) * tk.amp; step.follow = 1.6;
          step.lifeMin = 3; step.lifeMax = 8; attract.push(center.concat([0.012 * (0.5 + hold)]));
          look.coreK = (1.1 + flash * 2.5) * tk.heat; look.depthK = 0.5;
        } else if (mode === 'symbiote') {
          var emit = [];
          hands.forEach(function (h) {
            h.points.forEach(function (q) { emit.push(toW(q)); });
            attract.push(toW(h.center).concat([0.015 * (0.4 + hold)]));
            want.amp *= 1 + Math.min(3, h.speed / H * 2);
          });
          if (emit.length) { step.emitShape = 2; step.emitPoints = emit; step.jitter = 0.03; }
          else { step.emitShape = 0; step.center = [Math.sin(t * 0.5) * 0.1, Math.cos(t * 0.37) * 0.08, 0]; step.radius = 0.18; step.jitter = 0.6; attract.push([0, 0, 0, 0.02]); }
          step.amp = (0.15 + turb * 0.9) * tk.amp; step.follow = 4; step.lifeMin = 1.5; step.lifeMax = 5; step.kscale = kscale * 1.6;
          look.areaR = 0.5; look.pivot = [0, 0, 0]; look.spin = false; look.depthK = 0.2; look.trailsOverride = 0.985;
        }
        center = center.map(function (v, i) { return v + (want.c[i] - v) * e; });
        radius += (want.r - radius) * e;
        ['amp', 'hold', 'rad', 'tide', 'heat'].forEach(function (k) { tk[k] += (want[k] - tk[k]) * e; });
        flash *= Math.exp(-dt / 0.3);

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
        var brightK = mode === 'lightbeam' ? 0.06 * (N / 250000) : mode === 'thundercloud' ? 0.6 : mode === 'symbiote' ? 0.2 : 0.45;
        sys.draw({
          w: w, h: h, view: M, pivot: look.pivot, color: col, focal: 3, psize: Math.max(1, Math.round((mode === 'lightbeam' ? 1.2 : 0.8) * u * sL)),
          bright: mode === 'lightbeam' ? brightK * 250000 / sys.count() : brightK * areaPx / nEff, decay: decay, exposure: 0.3 + params.exposure / 100 * 2.4,
          glow: (params.glow / 100) * (mode === 'lightbeam' || mode === 'thundercloud' ? 2.2 : 1.5), ink: ink,
          useCam: params.camera, cam: params.camera ? camCopy : null, depthK: look.depthK,
          accent: [1, 0.3, 0.12], accentShare: mode === 'lightbeam' && params.leak ? 0.14 : 0,
          coreColor: [1, 0.36, 0.12], coreK: look.coreK || 0, coreR: radius * tk.rad * 0.9, coreC: center
        });
        ctx.save();
        // Flash (Lightbeam, Thundercloud): a white flash over the background, under the light.
        if (flash > 0.02 && (mode === 'lightbeam' || mode === 'thundercloud')) { ctx.fillStyle = 'rgba(255,255,255,' + (flash * (mode === 'lightbeam' ? 0.85 : 0.35)).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
        ctx.globalCompositeOperation = ink ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sys.canvas, 0, 0, W, H);
        // Light leaks (Lightbeam): warm gradients drifting along the edges, added like light.
        if (mode === 'lightbeam' && params.leak) {
          ctx.globalCompositeOperation = 'lighter';
          [[0.05 + 0.04 * Math.sin(t * 0.3), 0.2 + 0.1 * Math.sin(t * 0.21), '255,80,20'], [0.95, 0.75 + 0.1 * Math.cos(t * 0.17), '255,170,40'], [0.6 + 0.2 * Math.sin(t * 0.11), 1.02, '255,40,60']].forEach(function (L) {
            var gx = L[0] * W, gy = L[1] * H, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.45);
            gr.addColorStop(0, 'rgba(' + L[2] + ',0.28)'); gr.addColorStop(1, 'rgba(' + L[2] + ',0)');
            ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
          });
        }
        // Lightning (Thundercloud): each bolt glows and fades over 0.35 s.
        if (bolts.length) {
          ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
          bolts = bolts.filter(function (B) {
            var a2 = 1 - (t - B.born) / 0.35; if (a2 <= 0) return false;
            [[7 * u, 0.15], [2.5 * u, 0.5], [Math.max(1, u), 1]].forEach(function (ps) {
              ctx.strokeStyle = 'rgba(200,220,255,' + (ps[1] * a2).toFixed(3) + ')'; ctx.lineWidth = ps[0];
              ctx.beginPath(); B.path.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke();
            });
            return true;
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
      reset: function () { lastT = null; grab = null; prevTip = null; bolts = []; if (sys) sys.reset(); }
    };
  }

  Magi.renderers.fibre = createFibre;
})();
