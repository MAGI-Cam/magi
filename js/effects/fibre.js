// Fibre: a sphere of hundreds of thousands of particles stirred by turbulence into hair and fibre
// (after a reference of a grey fibrous sphere). Runs on Magi.gpuParticles (see that file for the
// physics: Kinematic Simulation turbulence, a spring to the sphere's shell, attractors, trails).
//
// The look comes from three things: very many very fine points (1 px), added together so the
// brightness is their density; frame feedback (Trails), which turns each particle's path into a
// fibre; and the balance between the turbulence pulling particles off the shell and the shell's
// spring (Hold) pulling them back, which decides whether it reads as a smooth ball or a fur.
// Looks (modes): Light, points added like light over the darkened camera (1 − e^(−E·density));
// Ink, the same density absorbed on paper (e^(−E·density), Beer–Lambert), multiplied over the camera.
// Camera: each particle takes the color of the video under it (Lookup Texture).
// Brightness is normalized by the expected density, about N·(1 − Trails decay)⁻¹ points spread over
// the sphere's disc πR², so changing Count or Trails doesn't change the exposure.
// Hands:
//   One hand: the sphere follows your palm. Two hands: it sits between them, its diameter the
//     distance between your palms.
//   Open palm: the turbulence rises and the shell lets go (×2.2 turbulence, ×0.3 hold): fibres fly.
//   Fist: it pulls tight (×0.3 turbulence, ×2.5 hold, half the radius).
//   Pinch and drag: turns it (1.6π across the frame about the vertical axis, 0.9π about the
//     horizontal), with momentum (0.8 s). Swipe: flings it into a spin.
//   Moving your hand fast through it blows the fibres away (a repelling attractor at the palm,
//     strength ∝ hand speed).
//   No hand: it turns slowly on its own.
(function () {
  function createFibre() {
    var sys = undefined, camCopy = document.createElement('canvas'), lastT = null, center = [0, 0, 0], radius = 0.5, view = { yaw: 0, pitch: 0.2 }, vel = { yaw: 0.15, pitch: 0 }, grab = null, seen = 0, tk = { amp: 1, hold: 1, rad: 1 };
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (sys === undefined) sys = Magi.gpuParticles();
        // Camera colors are looked up in an undimmed quarter-size copy of the picture.
        if (params.camera) {
          var cw = Math.max(1, Math.round(W / 4)), ch = Math.max(1, Math.round(H / 4));
          if (camCopy.width !== cw || camCopy.height !== ch) { camCopy.width = cw; camCopy.height = ch; }
          camCopy.getContext('2d').drawImage(out, 0, 0, cw, ch);
        }
        var ink = params.mode === 'ink';
        ctx.fillStyle = ink ? 'rgba(255,255,255,' + (params.dim / 100).toFixed(3) + ')' : 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (!sys) { frame.say('Fibre needs WebGL2 with float textures, which this browser doesn’t offer.'); return; }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var aspect = W / H, toW = function (p) { return [(p.x / W * 2 - 1) * aspect, 1 - p.y / H * 2, 0]; };

        // Hands.
        var ix = Magi.interaction.read(frame), hands = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1), hd = hands[0];
        var baseR = 0.2 + params.size / 100 * 0.6, want = { c: [0, 0, 0], r: baseR, amp: 1, hold: 1, rad: 1 }, attract = [];
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
        var e = 1 - Math.exp(-dt / 0.25);
        center = center.map(function (v, i) { return v + (want.c[i] - v) * e; });
        radius += (want.r - radius) * e;
        tk.amp += (want.amp - tk.amp) * e; tk.hold += (want.hold - tk.hold) * e; tk.rad += (want.rad - tk.rad) * e;
        // Turning: pinch and drag, momentum, swipes.
        var pincher = hands.filter(function (h) { return h.pinched; })[0];
        if (pincher) {
          var m = { x: (pincher.points[4].x + pincher.points[8].x) / 2, y: (pincher.points[4].y + pincher.points[8].y) / 2 };
          if (grab && grab.id === pincher.id) {
            var dy = (m.x - grab.x) / W * Math.PI * 1.6, dp = (m.y - grab.y) / H * Math.PI * 0.9;
            view.yaw += dy; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + dp));
            vel.yaw += (dy / dt - vel.yaw) * 0.3; vel.pitch += (dp / dt - vel.pitch) * 0.3;
          } else vel.yaw = vel.pitch = 0;
          grab = { id: pincher.id, x: m.x, y: m.y };
        } else {
          grab = null;
          var dk = Math.exp(-dt / 0.8);
          view.yaw += vel.yaw * dt; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + vel.pitch * dt));
          vel.yaw = hands.length ? vel.yaw * dk : vel.yaw + (0.15 - vel.yaw) * (1 - dk); vel.pitch *= dk;
        }
        ix.events.forEach(function (ev) { if (ev.n <= seen) return; seen = ev.n; if (ev.type === 'swipe' && (ev.dir === 'left' || ev.dir === 'right')) vel.yaw += ev.dir === 'right' ? 4 : -4; });

        // Simulate.
        var N = Math.round(params.count) * 1000;
        sys.setCount(N);
        var R = radius * tk.rad;
        sys.step({
          dt: dt, time: t, amp: (0.05 + params.turbulence / 100 * 1.1) * tk.amp, kscale: 0.5 + params.scale / 100 * 2.5, follow: 2.5,
          shellK: params.hold / 100 * 45 * tk.hold, radius: R, center: center, lifeMin: 3, lifeMax: 9, jitter: 0.04, attract: attract, soft: 0.1, count: N
        });

        // Draw at up to 1280 px on the long side.
        var sL = Math.min(1, 1280 / Math.max(W, H)), w = Math.max(1, Math.round(W * sL)), h = Math.max(1, Math.round(H * sL));
        var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        // view = Rx(pitch)·Ry(yaw), column-major for GLSL.
        var M = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
        var decay = 1 - (0.5 * (1 - params.trails / 100) + 0.012), Rpx = R * h / 2, nEff = sys.count() / (1 - decay);
        var col = params.color ? Magi.fx.inkColor(params.color) : [1, 1, 1];
        if (ink) col = col.map(function (v) { return params.color ? 1 - v : 1; });
        sys.draw({
          w: w, h: h, view: M, pivot: center, color: col, focal: 3, psize: Math.max(1, Math.round(0.8 * u * sL)),
          bright: 0.45 * Math.PI * Rpx * Rpx / nEff, decay: decay, exposure: 0.3 + params.exposure / 100 * 2.4, glow: params.glow / 100 * 1.5, ink: ink,
          useCam: params.camera, cam: params.camera ? camCopy : null, depthK: 0.6
        });
        ctx.save();
        ctx.globalCompositeOperation = ink ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sys.canvas, 0, 0, W, H);
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Open your hand to let the fibres fly, make a fist to pull them in, pinch and drag to turn it.');
      },
      reset: function () { lastT = null; grab = null; if (sys) sys.reset(); }
    };
  }

  Magi.renderers.fibre = createFibre;
})();
