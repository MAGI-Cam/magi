// Polar: a ball of hair-like strands swirling round a pole, seen through a fisheye lens (after a
// reference of a "polar coordinates" study in TouchDesigner). Runs on Magi.gpuParticles.
//
// The strands are particle trails: particles are born in a ball (uniform in volume) and follow fine
// turbulence (Kinematic Simulation at a small scale, so each path kinks like a hair) plus a twist
// about the pole's axis — in polar coordinates (r, θ) about that axis, an azimuthal speed
// θ̇·r = τ·r/(0.15 + r²) — so the strands comb round the pole. A soft attractor at the center keeps
// the ball together (a softened inverse-square pull, nearly a spring near the center); short lives
// keep it from drifting off. Frame feedback (Strands) draws each
// particle's path as a strand.
// The view is an equidistant fisheye (image radius ∝ the angle off the lens axis): the ball bulges
// toward you and its edges bow, and Fisheye sets the field of view, 100°–260°.
//
// Gesture: your hand is the pole. The ball sits at your palm. How open your hand is sets its size:
// a fist packs it into a small dense ball, an open hand lets the strands fly out (bigger, wilder).
// Rolling your wrist twists the strands (either way). Pinch and drag to spin the sphere; it coasts
// when you let go. Two hands: the ball sits between them and their distance sets the field of
// view. No hand: it turns slowly in the middle. Color: 0 drifts through lilac, teal and white.
(function () {
  var DRIFT = [[0.78, 0.62, 1.0], [0.55, 0.95, 0.88], [1.0, 1.0, 1.0], [0.72, 0.45, 1.0], [0.6, 0.75, 1.0]];
  function toWorld(q, W, H) { var a = W / H; return [(q.x / W * 2 - 1) * a, 1 - q.y / H * 2, 0]; }
  // Where on the plane z = 0 a screen point lands under the fisheye, so the ball sits under your
  // palm: a point seen at screen radius ρ is at angle θ = ρ·fov/2 off the axis, so at distance
  // focal·tan θ from it (θ capped below 90°).
  var FOCAL = 1.6;
  function underLens(v, fov) {
    var rho = Math.hypot(v[0], v[1]), th = Math.min(1.35, rho * fov / 2);
    if (rho < 1e-5) return [0, 0, 0];
    var r = FOCAL * Math.tan(th);
    return [v[0] / rho * r, v[1] / rho * r, 0];
  }
  function openness(h) { var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0); return Math.max(0, Math.min(1, (o - 0.25) / 0.6)); }

  Magi.renderers.polar = function () {
    var sys, lastT = null, S = { c: [0, 0, 0], r: 0.35, open: 0.5, twist: 0, fov: 0 }, spin = { yaw: 0, pitch: 0.3, vy: 0.12, vp: 0 }, grab = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (sys === undefined) sys = Magi.gpuParticles();
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        if (!sys) { frame.say('This effect needs WebGL2 with float textures, which this browser doesn’t offer.'); return; }
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT)); lastT = t;
        var ix = Magi.interaction.read(frame), hands = ix.hands.slice(0, 2), hd = hands[0];

        // Targets from the hands.
        var fovP = (100 + params.fisheye / 100 * 160) * Math.PI / 180;
        var T = { c: [0, 0, 0], open: 0.5, twist: 0, fov: fovP };
        if (hands.length === 2) {
          var a = toWorld(hands[0].center, W, H), b = toWorld(hands[1].center, W, H);
          T.open = (openness(hands[0]) + openness(hands[1])) / 2;
          var d = Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) / W;
          T.fov = (100 + Math.max(0, Math.min(1, (d - 0.15) / 0.6)) * 160) * Math.PI / 180;
          T.c = underLens([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], T.fov);
          T.twist = ((hands[0].rotation || 0) + (hands[1].rotation || 0)) / 2 / 60;
        } else if (hd) {
          T.c = underLens(toWorld(hd.center, W, H), T.fov); T.open = openness(hd); T.twist = (hd.rotation || 0) / 60;
        }
        var e = 1 - Math.exp(-dt / 0.25);
        S.c = S.c.map(function (v, i) { return v + (T.c[i] - v) * e; });
        S.open += (T.open - S.open) * e;
        S.twist += (Math.max(-1.5, Math.min(1.5, T.twist)) - S.twist) * e;
        S.fov = S.fov ? S.fov + (T.fov - S.fov) * e : T.fov;

        // Pinch and drag: spin the sphere (trackball); it coasts and slows when released.
        var pin = hands.filter(function (h) { return h.pinched; })[0];
        if (pin) {
          var pm = { x: (pin.points[4].x + pin.points[8].x) / 2, y: (pin.points[4].y + pin.points[8].y) / 2 };
          if (grab) { spin.vy = (pm.x - grab.x) / W * 6 / Math.max(dt, 1e-3) * 0.5 + spin.vy * 0.5; spin.vp = (pm.y - grab.y) / H * 6 / Math.max(dt, 1e-3) * 0.5 + spin.vp * 0.5; }
          grab = pm;
        } else {
          grab = null;
          var base = hands.length ? 0 : 0.12;
          spin.vy += (base - spin.vy) * (1 - Math.exp(-dt / 1.5)); spin.vp *= Math.exp(-dt / 1.2);
        }
        spin.yaw += spin.vy * dt; spin.pitch = Math.max(-1.2, Math.min(1.2, spin.pitch + spin.vp * dt));

        var R = (0.16 + 0.5 * S.open) * (0.5 + params.size / 100);
        var N = Math.round(params.count) * 1000;
        sys.setCount(N);
        var tw = (params.twist / 100 * 2.5) * (hands.length ? S.twist : 0.6);
        sys.step({
          dt: dt, time: t, count: N, emitShape: 3, center: S.c, radius: R, jitter: 0,
          amp: (0.08 + params.turbulence / 100 * 0.5) * (0.5 + S.open), kscale: 4 + params.turbulence / 100 * 4, follow: 3,
          twist: tw, twistAxis: [0, 1, 0],
          attract: [S.c.concat([0.02 * (1.6 - S.open)])], soft: 0.15, lifeMin: 0.8, lifeMax: 2.6
        });

        var sL = Math.min(1, 1280 / Math.max(W, H)), w = Math.max(1, Math.round(W * sL)), h = Math.max(1, Math.round(H * sL));
        var cy = Math.cos(spin.yaw), sy = Math.sin(spin.yaw), cp = Math.cos(spin.pitch), sp = Math.sin(spin.pitch);
        // View rotation: yaw about y, then pitch about x (column-major mat3).
        var M = [cy, sy * sp, -sy * cp, 0, cp, sp, sy, -cy * sp, cy * cp];
        var col;
        if (params.color) col = Magi.fx.inkColor(params.color);
        else { var k = (t * 0.08) % DRIFT.length, i0 = Math.floor(k), f = k - i0, A = DRIFT[i0], B = DRIFT[(i0 + 1) % DRIFT.length]; f = f * f * (3 - 2 * f); col = A.map(function (v, j) { return v + (B[j] - v) * f; }); }
        var decay = 0.6 + params.strands / 100 * 0.37, nEff = sys.count() / (1 - decay), area = Math.PI * Math.pow(R * h / 2, 2) * 2;
        sys.draw({
          w: w, h: h, view: M, pivot: S.c, color: col, focal: FOCAL, psize: Math.max(1, Math.round(0.8 * u * sL)),
          bright: 0.12 * area / nEff, decay: decay, exposure: 0.3 + params.exposure / 100 * 2.4, glow: params.glow / 100 * 1.5, depthK: 0.5,
          fisheye: true, fov: S.fov
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sys.canvas, 0, 0, W, H);
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise your hand: it is the pole. Close it for a tight ball, open it to let the strands fly, roll your wrist to twist them, pinch and drag to spin.');
      },
      reset: function () { lastT = null; if (sys) sys.reset(); }
    };
  };
})();
