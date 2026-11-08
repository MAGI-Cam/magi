// Exhale: spheres of particles that breathe with your hands (after a reference of a green ring that
// blooms outward and collapses back into a bright core).
//
// Particles sit on a sphere, spread evenly as a Fibonacci sphere (y = 1 − 2(k + ½)/N, φ = k·137.5°),
// drawn in perspective (focal length 3) and lit at the rim: bright where the shell is seen edge-on,
// faint where it faces you, so it reads as a ring. Each particle has its own radius, which follows
// the breath B through a damped spring with its own stiffness (2–6 Hz): on an exhale the fast ones
// lead and the shell turns bristled; on an inhale they rush back. Moving particles leave a streak
// back along their motion (Bristles).
// Breath, B from 0 (in) to 1 (out), per hand: open palm exhales (B → 1), a fist inhales all the way
// to 0, and the hand's openness sets anything between. At B → 0 the sphere implodes: the shell
// collapses into a bright core (radius 2% of the sphere, brighter the tighter it gets) and blooms
// back out, overshooting, when you open your hand. No hand: one sphere breathes on its own at Rate
// breaths a minute (B = ½ − ½cos 2πft).
// Two hands: two spheres, one per hand, each following its hand and breathing with it.
// Each sphere follows its palm and turns as a rigid body (rotation matrix M, angular velocity ω).
// Brushing your hand across it spins it like a ball (ω gains the hand's velocity ÷ radius, about the
// axis perpendicular to the motion); rolling your hand turns it about the view axis; a swipe flings
// it. Spin slows with a 3 s half-life toward a slow idle turn.
// Pinch: the sphere's particles teleport to the pinch and burst outward (each a random direction,
// 1.5–3.5 frame heights a second), then fall back into the sphere on springs (1.1 Hz, slightly
// underdamped), landing where they belong.
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function createSphere(n, breath) {
    var P = [];
    for (var k = 0; k < n; k++) {
      var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
      P.push({ d: [r * Math.cos(phi), y, r * Math.sin(phi)], r: breath, v: 0, w: 2 * Math.PI * (2 + Math.random() * 4), jit: 0.95 + Math.random() * 0.1, free: false, fx: 0, fy: 0, fvx: 0, fvy: 0 });
    }
    return { P: P, breath: breath, center: null, M: [1, 0, 0, 0, 1, 0, 0, 0, 1], omega: [0, 0.25, 0], roll: null, wasPinched: false, last: null, seen: 0 };
  }
  // Rotation by angle a about unit axis k (Rodrigues), applied on the left: M ← R·M.
  function turn(S, k, a) {
    var M = S.M, c = Math.cos(a), s1 = Math.sin(a), t1 = 1 - c, x = k[0], y = k[1], z = k[2];
    var R2 = [t1 * x * x + c, t1 * x * y - s1 * z, t1 * x * z + s1 * y, t1 * x * y + s1 * z, t1 * y * y + c, t1 * y * z - s1 * x, t1 * x * z - s1 * y, t1 * y * z + s1 * x, t1 * z * z + c];
    var out = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[i * 3 + j] = R2[i * 3] * M[j] + R2[i * 3 + 1] * M[3 + j] + R2[i * 3 + 2] * M[6 + j];
    S.M = out;
  }

  function createExhale() {
    var spheres = [], key = '', lastT = null, seenEvents = 0;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var ix = Magi.interaction.read(frame), hands = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1);
        var count = Math.max(1, hands.length), n = Math.round(params.count / count);
        if (key !== n + ':' + count) { key = n + ':' + count; spheres = []; for (var s0 = 0; s0 < count; s0++) spheres.push(createSphere(n, 0.3)); }
        var R = Math.min(W, H) * 0.32 * (0.4 + params.size / 100 * 0.9) / (count > 1 ? 1.4 : 1), F = 3;
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.42, 1, 0.45], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var bristle = params.bristles / 100;
        var events = ix.events.filter(function (e) { return e.n > seenEvents; });
        events.forEach(function (e) { seenEvents = Math.max(seenEvents, e.n); });

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        spheres.forEach(function (S, si) {
          var hd = hands[si];
          if (!S.center) S.center = { x: W * (count > 1 ? (si ? 0.68 : 0.32) : 0.5), y: H / 2 };
          // Follow the hand (or drift home).
          var aim = hd ? hd.center : { x: W * (count > 1 ? (si ? 0.68 : 0.32) : 0.5), y: H / 2 }, ef = 1 - Math.exp(-dt / (hd ? 0.12 : 0.8));
          S.center.x += (aim.x - S.center.x) * ef; S.center.y += (aim.y - S.center.y) * ef;
          // Breath.
          var target = hd ? (hd.fist ? 0 : hd.count >= 5 ? 1 : 0.15 + 0.85 * (hd.count / 5)) : 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
          S.breath += (target - S.breath) * (1 - Math.exp(-dt / (target < S.breath ? 0.18 : 0.35)));
          // Spin: brushing, rolling, swipes; decaying to an idle turn.
          if (hd) {
            var dxh = hd.center.x - S.center.x, dyh = hd.center.y - S.center.y, near = Math.hypot(dxh, dyh) < R * 1.3;
            if (near && hd.speed > H * 0.3) { S.omega[0] += hd.velocity.y / R * dt * 3; S.omega[1] += hd.velocity.x / R * dt * 3; }
            if (S.roll !== null) { var dr = (hd.rotation - S.roll) * Math.PI / 180; dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(dr) > 0.003) turn(S, [0, 0, 1], dr); }
            S.roll = hd.rotation;
            events.forEach(function (e) { if (e.type === 'swipe' && e.hand === hd.id) { var d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[e.dir] || [0, 0]; S.omega[0] += d[1] * 4; S.omega[1] += d[0] * 4; } });
          } else S.roll = null;
          var wl = Math.hypot(S.omega[0], S.omega[1], S.omega[2]);
          if (wl > 1e-4) turn(S, [S.omega[0] / wl, S.omega[1] / wl, S.omega[2] / wl], -wl * dt);
          var decay = Math.pow(0.5, dt / 3);
          S.omega = [S.omega[0] * decay, 0.25 + (S.omega[1] - 0.25) * decay, S.omega[2] * decay];
          // Pinch: teleport to the pinch and burst out.
          var pinched = hd && hd.pinched;
          if (pinched && !S.wasPinched) {
            var pm = { x: (hd.points[4].x + hd.points[8].x) / 2, y: (hd.points[4].y + hd.points[8].y) / 2 };
            S.P.forEach(function (q) { var a = Math.random() * Math.PI * 2, sp = H * (1.5 + Math.random() * 2); q.free = true; q.fx = pm.x; q.fy = pm.y; q.fvx = Math.cos(a) * sp; q.fvy = Math.sin(a) * sp; });
          }
          S.wasPinched = pinched;

          // Particles: radial springs, then projection, then the free ones' return springs.
          var sub = 2, h = dt / sub, M = S.M, cx = S.center.x, cy = S.center.y, Kf = Math.pow(2 * Math.PI * 1.1, 2), Cf = 2 * 0.8 * 2 * Math.PI * 1.1;
          var tight = Math.max(0, 1 - S.breath / 0.15), dots = [[], [], []], streaks = [[], [], []];
          S.P.forEach(function (q) {
            for (var s = 0; s < sub; s++) { var a = -q.w * q.w * (q.r - S.breath * q.jit) - 2 * 0.35 * q.w * q.v; q.v += a * h; q.r += q.v * h; }
            var x = M[0] * q.d[0] + M[1] * q.d[1] + M[2] * q.d[2], y = -(M[3] * q.d[0] + M[4] * q.d[1] + M[5] * q.d[2]), zz = M[6] * q.d[0] + M[7] * q.d[1] + M[8] * q.d[2];
            var kp = F / (F + zz), rr = 0.02 + 1.03 * Math.max(0, q.r), sx = cx + x * rr * R * kp, sy = cy - y * rr * R * kp;
            var band = Math.abs(zz) < 0.35 ? 0 : Math.abs(zz) < 0.7 ? 1 : 2;
            if (q.free) {
              var ax = -Kf * (q.fx - sx) - Cf * q.fvx, ay = -Kf * (q.fy - sy) - Cf * q.fvy;
              var ox = q.fx, oy = q.fy;
              q.fvx += ax * dt; q.fvy += ay * dt; q.fx += q.fvx * dt; q.fy += q.fvy * dt;
              if (Math.hypot(q.fx - sx, q.fy - sy) < 1.5 && Math.hypot(q.fvx, q.fvy) < H * 0.05) q.free = false;
              dots[0].push(q.fx, q.fy);
              if (bristle > 0) streaks[0].push(q.fx, q.fy, ox - q.fvx * dt * 2 * bristle, oy - q.fvy * dt * 2 * bristle);
              return;
            }
            dots[band].push(sx, sy);
            var speed = Math.abs(q.v);
            if (bristle > 0 && speed > 0.3) {
              var back = Math.min(0.5, speed * 0.12 * bristle) * Math.sign(q.v), r0 = Math.max(0, rr - back);
              streaks[band].push(sx, sy, cx + x * r0 * R * kp, cy - y * r0 * R * kp);
            }
          });
          // The core glows brighter the tighter it implodes.
          var sz = Math.max(1, 1.3 * u), alphaBand = [0.95, 0.4 + 0.5 * tight, 0.1 + 0.8 * tight];
          for (var b = 2; b >= 0; b--) {
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (alphaBand[b] * 0.8).toFixed(3) + ')';
            ctx.lineWidth = Math.max(0.6, 0.9 * u);
            ctx.beginPath();
            var sl = streaks[b];
            for (var j = 0; j < sl.length; j += 4) { ctx.moveTo(sl[j], sl[j + 1]); ctx.lineTo(sl[j + 2], sl[j + 3]); }
            ctx.stroke();
            ctx.fillStyle = 'rgba(' + rgb + ',' + Math.min(1, alphaBand[b]).toFixed(3) + ')';
            var dl = dots[b];
            for (var j2 = 0; j2 < dl.length; j2 += 2) ctx.fillRect(dl[j2] - sz / 2, dl[j2 + 1] - sz / 2, sz, sz);
          }
          if (tight > 0.2) {
            var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12);
            g.addColorStop(0, 'rgba(255,255,255,' + (0.7 * tight).toFixed(3) + ')');
            g.addColorStop(0.4, 'rgba(' + rgb + ',' + (0.5 * tight).toFixed(3) + ')');
            g.addColorStop(1, 'rgba(' + rgb + ',0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2); ctx.fill();
          }
        });
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
      },
      reset: function () { key = ''; lastT = null; spheres = []; }
    };
  }

  Magi.renderers.exhale = createExhale;
})();
