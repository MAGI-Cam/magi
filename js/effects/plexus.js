// Particle Cloud and Pseudo Plexus: two GPU particle effects that follow your hands (after a
// TouchDesigner tutorial on particle clouds and "pseudo plexus"). Both run on Magi.gpuParticles; see
// that file for the physics (Kinematic Simulation turbulence, attractors, life) and the drawing.
//
// Hands become emitters: particles are born at your 21 landmarks per hand (up to 42), so the cloud
// takes the shape of your hands and streams off them. Palms are attractors (softened
// inverse-square, a = w·r/(r² + s²)^(3/2)), so what drifts away is drawn back while you hold still.
// With no hand, particles are born in a slowly turning volume in the middle of the picture.
//
// Particle Cloud: hundreds of thousands of fine points, born with a little scatter around each
// landmark, stirred by turbulence and added like light, with short trails, so they read as a soft
// luminous volume. Open palm: the turbulence rises and the pull loosens, the cloud blooms. Fist:
// the pull ×4 and the turbulence ×0.4, it condenses onto your hand. Pinch: a strong attractor at the
// pinch draws the cloud to your fingertips.
// Pseudo Plexus: fewer particles (tens of thousands), each born at a fixed landmark (index mod the
// landmark count), drifting slowly, joined by lines to partners a few landmark-counts along the list
// (same landmark, other moments) and one along (the next landmark), each line fading out with its
// length (see gpu-particles.js). It draws a web of straight lines between near points, the plexus
// look, that grows from your hands and stretches as you move. Links: how many partner strides;
// Reach: the longest line that still shows.
(function () {
  function toWorld(q, W, H) { var a = W / H; return [(q.x / W * 2 - 1) * a, 1 - q.y / H * 2, -(q.z || 0) * 2 * a]; }
  function idle(t, n) {
    // Points on a slowly turning ring of loops in the middle of the picture, when no hand is up.
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + t * 0.15, r = 0.35 + 0.12 * Math.sin(i * 2.3 + t * 0.4);
      pts.push([Math.cos(a) * r, Math.sin(a * 2) * 0.18 + Math.sin(i * 1.7) * 0.12, Math.sin(a) * r]);
    }
    return pts;
  }

  function create(kind) {
    var sys = undefined, lastT = null, view = { yaw: 0, pitch: 0 }, tk = { amp: 1, pull: 1 };
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (sys === undefined) sys = Magi.gpuParticles();
        var ink = params.mode === 'ink';
        ctx.fillStyle = (ink ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (!sys) { frame.say('This effect needs WebGL2 with float textures, which this browser doesn’t offer.'); return; }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var ix = Magi.interaction.read(frame), hands = ix.hands.slice(0, 2), plexus = kind === 'plexus';

        // Emitters and attractors from the hands.
        var emit = [], attract = [], want = { amp: 1, pull: 1 };
        hands.forEach(function (h) {
          h.points.forEach(function (q) { emit.push(toWorld(q, W, H)); });
          var c = toWorld(h.center, W, H);
          if (h.fist) { want.amp *= 0.4; want.pull *= 4; }
          else if (h.count >= 4 && !h.pinched) { want.amp *= 1.6; want.pull *= 0.5; }
          attract.push(c.concat([(plexus ? 0.006 : 0.02) * (params.hold / 50)]));
          if (h.pinched) attract.push(toWorld({ x: (h.points[4].x + h.points[8].x) / 2, y: (h.points[4].y + h.points[8].y) / 2, z: h.points[8].z }, W, H).concat([0.06]));
        });
        if (!emit.length) emit = idle(t, plexus ? 21 : 32);
        var e = 1 - Math.exp(-dt / 0.3);
        tk.amp += (want.amp - tk.amp) * e; tk.pull += (want.pull - tk.pull) * e;
        attract = attract.map(function (a) { return [a[0], a[1], a[2], a[3] * tk.pull]; });
        view.yaw = hands.length ? view.yaw * (1 - e) : view.yaw + dt * 0.12;

        var N = Math.round(params.count) * 1000;
        sys.setCount(N);
        sys.step({
          dt: dt, time: t, count: N, emitShape: 2, emitPoints: emit, emitByIndex: plexus, jitter: plexus ? 0.22 : 0.09,
          amp: (plexus ? 0.05 + params.turbulence / 100 * 0.35 : 0.05 + params.turbulence / 100 * 0.6) * tk.amp, kscale: 1 + params.scale / 100 * 3, follow: plexus ? 1.2 : 2,
          attract: attract, soft: 0.12, lifeMin: plexus ? 3 : 1.5, lifeMax: plexus ? 8 : 5
        });

        // Draw at up to 1280 px on the long side.
        var sL = Math.min(1, 1280 / Math.max(W, H)), w = Math.max(1, Math.round(W * sL)), h = Math.max(1, Math.round(H * sL));
        var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), M = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
        var decay = 1 - (0.5 * (1 - params.trails / 100) + 0.02), nEff = sys.count() / (1 - decay);
        var area = hands.length ? hands.length * Math.PI * Math.pow(0.35 * h / 2, 2) : Math.PI * Math.pow(0.45 * h / 2, 2);
        var col = params.color ? Magi.fx.inkColor(params.color) : [1, 1, 1];
        if (ink) col = col.map(function (v) { return params.color ? 1 - v : 1; });
        var lines = [];
        if (plexus) {
          var nE = emit.length, strides = [nE, nE + 1, 2 * nE, 3 * nE + 1, 5 * nE, 2 * nE - 1].slice(0, Math.round(params.links));
          var reach = 0.03 + params.reach / 100 * 0.3;
          strides.forEach(function (st) { lines.push({ stride: st, maxLen: reach, bright: 0.4 * (params.lines / 50) * Math.min(1, 15000 / sys.count()) }); });
        }
        sys.draw({
          w: w, h: h, view: M, pivot: [0, 0, 0], color: col, focal: 3, psize: Math.max(1, Math.round((plexus ? 1 : 0.8) * u * sL)),
          bright: (plexus ? 0.07 : 0.6) * area / nEff, decay: decay, exposure: 0.3 + params.exposure / 100 * 2.4, glow: params.glow / 100 * 1.5, ink: ink, depthK: 0.4,
          lines: lines
        });
        ctx.save();
        ctx.globalCompositeOperation = ink ? 'multiply' : 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sys.canvas, 0, 0, W, H);
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say(plexus ? 'Raise your hands: a web of lines grows from them. Fist pulls it in, open palm lets it drift.' : 'Raise your hands: the cloud streams off them. Open palm blooms it, fist condenses it, pinch draws it to your fingertips.');
      },
      reset: function () { lastT = null; if (sys) sys.reset(); }
    };
  }

  Magi.renderers['particle-cloud'] = function () { return create('cloud'); };
  Magi.renderers['pseudo-plexus'] = function () { return create('plexus'); };
})();
