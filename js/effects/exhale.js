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
// Pinch: the sphere's particles travel to the pinch, in a stream (each sets off after a random delay
// of up to 0.3 s and steers toward the pinch at up to 2.2 frame heights a second), burst outward
// when they reach it (a random direction, 1–2.5 frame heights a second), then fall back into the
// sphere on springs (1.1 Hz, slightly underdamped), landing where they belong.
// Speed scales all of that motion (travel, burst, return and the breath), ×0.35 to ×2.9.
// Two spheres attract: each center is held to its hand by a spring (1.6 Hz) and pulled toward the
// other by Newtonian gravity, a = G/d² (G = 1.9·ω²·R³, so at 2.5 sphere radii apart the pull moves
// each about a third of a radius off its hand). When their shells touch (centers closer than 0.9 of
// the summed radii) they merge into one sphere of all the particles, at the hands' midpoint and
// breathing with both; pull your hands more than 3.4 radii apart and it splits again (no re-merge
// for 1 s). On every merge, split or change in hands, particles fly from where they were to their
// new places on the return springs, so nothing jumps.
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function createSphere(n, breath) {
    var P = [];
    for (var k = 0; k < n; k++) {
      var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
      P.push({ d: [r * Math.cos(phi), y, r * Math.sin(phi)], r: breath, v: 0, w: 2 * Math.PI * (2 + Math.random() * 4), jit: 0.95 + Math.random() * 0.1, mode: 0, delay: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, sx: null, sy: null });
    }
    return { P: P, breath: breath, center: null, cv: { x: 0, y: 0 }, M: [1, 0, 0, 0, 1, 0, 0, 0, 1], omega: [0, 0.25, 0], roll: null, wasPinched: false, pin: null };
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
    var spheres = [], key = '', lastT = null, seenEvents = 0, merged = false, splitAt = -9;
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
        var spd = Math.pow(2, (params.speed === undefined ? 50 : params.speed) / 33 - 50 / 33);
        var count = Math.max(1, hands.length);
        var Rbase = Math.min(W, H) * 0.32 * (0.4 + params.size / 100 * 0.9), Rsep = Rbase / 1.4;
        // Split when the hands pull apart.
        if (merged && (hands.length < 2 || Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) > 3.4 * Rsep)) { merged = false; splitAt = t; }
        var shown = count > 1 && !merged ? 2 : 1, n = Math.round(params.count / shown);
        if (key !== n + ':' + shown) {
          // Rebuild, carrying every particle's last screen position so it flies to its new place.
          var old = [], oldS = spheres;
          oldS.forEach(function (S) { S.P.forEach(function (q) { if (q.sx !== null) old.push([q.sx, q.sy]); }); });
          var oc = oldS.map(function (S) { return S.center; }).filter(Boolean);
          key = n + ':' + shown; spheres = [];
          for (var s0 = 0; s0 < shown; s0++) {
            var S1 = createSphere(n, oldS[0] ? oldS[0].breath : 0.3);
            // One sphere starts where the old ones were (their mean); two start at their hands.
            if (shown === 1 && oc.length) S1.center = { x: oc.reduce(function (a, c) { return a + c.x; }, 0) / oc.length, y: oc.reduce(function (a, c) { return a + c.y; }, 0) / oc.length };
            else if (shown > 1 && hands[s0]) S1.center = { x: hands[s0].center.x, y: hands[s0].center.y };
            spheres.push(S1);
          }
          if (shown > 1) splitAt = t;
          if (old.length) spheres.forEach(function (S, si) { S.P.forEach(function (q, k) { var o = old[(si * n + k) % old.length]; q.mode = 2; q.fx = o[0]; q.fy = o[1]; q.fvx = 0; q.fvy = 0; }); });
        }
        var R = shown > 1 ? Rsep : Rbase, F = 3;
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.42, 1, 0.45], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var bristle = params.bristles / 100;
        var events = ix.events.filter(function (e) { return e.n > seenEvents; });
        events.forEach(function (e) { seenEvents = Math.max(seenEvents, e.n); });
        // Each sphere's hands: its own, or both when merged.
        var handsOf = function (si) { return shown === 1 ? hands : hands[si] ? [hands[si]] : []; };
        var home = function (si) { return { x: W * (shown > 1 ? (si ? 0.68 : 0.32) : 0.5), y: H / 2 }; };
        // Centers: a spring to the hand (or the hands' midpoint, or home), plus mutual gravity.
        var wc = 2 * Math.PI * 1.6, G = 1.9 * wc * wc * R * R * R;
        spheres.forEach(function (S, si) { if (!S.center) S.center = home(si); });
        spheres.forEach(function (S, si) {
          var hs = handsOf(si), aim = hs.length ? { x: hs.reduce(function (a, h) { return a + h.center.x; }, 0) / hs.length, y: hs.reduce(function (a, h) { return a + h.center.y; }, 0) / hs.length } : home(si);
          var ax = wc * wc * (aim.x - S.center.x) - 2 * 0.9 * wc * S.cv.x, ay = wc * wc * (aim.y - S.center.y) - 2 * 0.9 * wc * S.cv.y;
          if (!hs.length) { ax *= 0.15; ay *= 0.15; }
          if (shown > 1) {
            var O = spheres[1 - si].center, gx = O.x - S.center.x, gy = O.y - S.center.y, d = Math.max(R * 0.5, Math.hypot(gx, gy));
            ax += G / (d * d) * gx / d; ay += G / (d * d) * gy / d;
          }
          S.cv.x += ax * dt; S.cv.y += ay * dt;
          S.center.x += S.cv.x * dt; S.center.y += S.cv.y * dt;
        });
        // Touching shells merge.
        if (shown > 1 && t - splitAt > 1) {
          var A0 = spheres[0], A1 = spheres[1], rr0 = R * (0.02 + 1.03 * A0.breath), rr1 = R * (0.02 + 1.03 * A1.breath);
          if (Math.hypot(A0.center.x - A1.center.x, A0.center.y - A1.center.y) < 0.9 * (rr0 + rr1)) merged = true;
        }

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        spheres.forEach(function (S, si) {
          var hs = handsOf(si), hd = hs[0];
          // Breath (merged: the mean of both hands').
          var bOf = function (h) { return h.fist ? 0 : h.count >= 5 ? 1 : 0.15 + 0.85 * (h.count / 5); };
          var target = hs.length ? hs.reduce(function (a, h) { return a + bOf(h); }, 0) / hs.length : 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
          S.breath += (target - S.breath) * (1 - Math.exp(-dt * spd / (target < S.breath ? 0.18 : 0.35)));
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
          // Pinch: the particles set off toward the pinch (which they follow while you hold it).
          var ph = hs.filter(function (h) { return h.pinched; })[0], pinched = !!ph;
          if (ph) S.pin = { x: (ph.points[4].x + ph.points[8].x) / 2, y: (ph.points[4].y + ph.points[8].y) / 2 };
          if (pinched && !S.wasPinched) {
            S.P.forEach(function (q) { if (q.sx === null) return; q.mode = 1; q.delay = Math.random() * 0.3 / spd; q.fx = q.sx; q.fy = q.sy; q.fvx = 0; q.fvy = 0; });
          }
          S.wasPinched = pinched;

          // Particles: radial springs, then projection, then the free ones' return springs.
          var sub = 2, h = dt * spd / sub, M = S.M, cx = S.center.x, cy = S.center.y, wf = 2 * Math.PI * 1.1 * spd, Kf = wf * wf, Cf = 2 * 0.8 * wf;
          var vmax = H * 2.2 * spd, arrive = H * 0.02, pin = S.pin;
          var tight = Math.max(0, 1 - S.breath / 0.15), dots = [[], [], []], streaks = [[], [], []];
          S.P.forEach(function (q) {
            for (var s = 0; s < sub; s++) { var a = -q.w * q.w * (q.r - S.breath * q.jit) - 2 * 0.35 * q.w * q.v; q.v += a * h; q.r += q.v * h; }
            var x = M[0] * q.d[0] + M[1] * q.d[1] + M[2] * q.d[2], y = -(M[3] * q.d[0] + M[4] * q.d[1] + M[5] * q.d[2]), zz = M[6] * q.d[0] + M[7] * q.d[1] + M[8] * q.d[2];
            var kp = F / (F + zz), rr = 0.02 + 1.03 * Math.max(0, q.r), sx = cx + x * rr * R * kp, sy = cy - y * rr * R * kp;
            var band = Math.abs(zz) < 0.35 ? 0 : Math.abs(zz) < 0.7 ? 1 : 2;
            q.sx = sx; q.sy = sy;
            if (q.mode === 1 && q.delay > 0) { q.delay -= dt; q.fx = sx; q.fy = sy; }
            else if (q.mode === 1 && pin) {
              // Steering toward the pinch: velocity eases toward full speed along the line to it.
              var gx = pin.x - q.fx, gy = pin.y - q.fy, gl = Math.hypot(gx, gy) || 1, kv = Math.min(1, dt * 8);
              q.fvx += (gx / gl * vmax - q.fvx) * kv; q.fvy += (gy / gl * vmax - q.fvy) * kv;
              var ox1 = q.fx, oy1 = q.fy;
              q.fx += q.fvx * dt; q.fy += q.fvy * dt;
              if (gl < arrive + vmax * dt) {
                // Arrived: burst outward, then return on the springs.
                var ba = Math.random() * Math.PI * 2, bs = H * (1 + Math.random() * 1.5) * spd;
                q.fx = pin.x; q.fy = pin.y; q.fvx = Math.cos(ba) * bs; q.fvy = Math.sin(ba) * bs; q.mode = 2;
              }
              dots[0].push(q.fx, q.fy);
              if (bristle > 0) streaks[0].push(q.fx, q.fy, ox1 - q.fvx * dt * 2 * bristle, oy1 - q.fvy * dt * 2 * bristle);
              return;
            }
            if (q.mode === 2) {
              var ax = -Kf * (q.fx - sx) - Cf * q.fvx, ay = -Kf * (q.fy - sy) - Cf * q.fvy;
              var ox = q.fx, oy = q.fy;
              q.fvx += ax * dt; q.fvy += ay * dt; q.fx += q.fvx * dt; q.fy += q.fvy * dt;
              if (Math.hypot(q.fx - sx, q.fy - sy) < 1.5 && Math.hypot(q.fvx, q.fvy) < H * 0.05) q.mode = 0;
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
            // All of a band's dots in one path and one fill (thousands of fillRect calls are slow).
            var dl = dots[b];
            ctx.beginPath();
            for (var j2 = 0; j2 < dl.length; j2 += 2) ctx.rect(dl[j2] - sz / 2, dl[j2 + 1] - sz / 2, sz, sz);
            ctx.fill();
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
      reset: function () { key = ''; lastT = null; spheres = []; merged = false; splitAt = -9; }
    };
  }

  Magi.renderers.exhale = createExhale;
})();
