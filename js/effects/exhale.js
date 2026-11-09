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
// back out, overshooting, when you open your hand. No hand: it breathes on its own at Rate
// breaths a minute (B = ½ − ½cos 2πft).
//
// Two groups of particles, two spheres, always: with one hand (or none) they are merged into one
// sphere; with two hands each group follows its own hand. Merging is gradual and shared: a merge
// amount m eases toward 1 (time constant 0.8 s) and each particle moves from its place on its own
// sphere to its place on the merged sphere once m passes its own threshold. Thresholds are lowest
// on the side facing the other sphere, so particles cross over first where the spheres touch,
// forming a bridge, and the rest follow; the merged sphere interleaves both groups (group g takes
// the Fibonacci points 2k + g of 2n), so the two populations share one shell. Splitting runs the
// same way backwards.
// Two spheres attract: each center is held to its hand by a spring (1.6 Hz) and pulled toward the
// other by Newtonian gravity, a = G/d² (G = 1.9·ω²·R³, so 2.5 radii apart the pull moves each about
// a third of a radius off its hand). When their shells touch (centers closer than 0.9 of the summed
// radii) they merge; pull your hands more than 3.4 radii apart and it splits (no re-merge for 1 s).
// Each sphere turns as a rigid body (rotation matrix M, angular velocity ω). Brushing your hand
// across it spins it like a ball (ω gains the hand's velocity ÷ radius, about the axis perpendicular
// to the motion); rolling your hand turns it about the view axis; a swipe flings it. Spin slows with
// a 3 s half-life toward a slow idle turn.
// Pinch: the particles flow to the pinch. Each sets off after a delay that grows with its distance
// (so they leave as a stream, nearest first), and steers toward the pinch with a limited
// acceleration (no jumps), up to 2.2 frame heights a second × Speed. There they circle the pinch in
// a small swirling cloud while you hold it. Let go and the cloud blooms outward gently, then flows
// back into the sphere on springs (1.1 Hz × Speed, slightly underdamped).
// Speed scales all of that motion and the breath, ×0.35 to ×2.9 (2^((Speed − 50)/33)).
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function fib(k, n) { var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN; return [r * Math.cos(phi), y, r * Math.sin(phi)]; }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  function createGroup(n, g, breath) {
    var P = [];
    for (var k = 0; k < n; k++) {
      P.push({ d: fib(k, n), dm: fib(2 * k + g, 2 * n), r: breath, v: 0, w: 2 * Math.PI * (2 + Math.random() * 4), jit: 0.95 + Math.random() * 0.1,
        mode: 0, delay: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, sx: null, sy: null, orb: 0.4 + Math.random() * 0.6, ang: Math.random() * 6.28 });
    }
    return { P: P, breath: breath, center: null, cv: { x: 0, y: 0 }, M: [1, 0, 0, 0, 1, 0, 0, 0, 1], omega: [0, 0.25, 0], roll: null, wasPinched: false, pin: null, pinned: false };
  }
  // Rotation by angle a about unit axis k (Rodrigues), applied on the left: M ← R·M.
  function turn(S, k, a) {
    var M = S.M, c = Math.cos(a), s1 = Math.sin(a), t1 = 1 - c, x = k[0], y = k[1], z = k[2];
    var R2 = [t1 * x * x + c, t1 * x * y - s1 * z, t1 * x * z + s1 * y, t1 * x * y + s1 * z, t1 * y * y + c, t1 * y * z - s1 * x, t1 * x * z - s1 * y, t1 * y * z + s1 * x, t1 * z * z + c];
    var out = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out[i * 3 + j] = R2[i * 3] * M[j] + R2[i * 3 + 1] * M[3 + j] + R2[i * 3 + 2] * M[6 + j];
    S.M = out;
  }
  function rot(M, d) { return [M[0] * d[0] + M[1] * d[1] + M[2] * d[2], -(M[3] * d[0] + M[4] * d[1] + M[5] * d[2]), M[6] * d[0] + M[7] * d[1] + M[8] * d[2]]; }

  function createExhale() {
    var groups = [], key = '', lastT = null, seenEvents = 0, m = 1, mergedFlag = true, splitAt = -9;
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
        var spd = Math.pow(2, ((params.speed === undefined ? 50 : params.speed) - 50) / 33);
        var n = Math.max(1, Math.round(params.count / 2));
        if (key !== String(n)) { key = String(n); groups = [createGroup(n, 0, 0.3), createGroup(n, 1, 0.3)]; }
        var Rbase = Math.min(W, H) * 0.32 * (0.4 + params.size / 100 * 0.9), Rsep = Rbase / 1.4, F = 3;
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.42, 1, 0.45], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var bristle = params.bristles / 100;
        var events = ix.events.filter(function (e) { return e.n > seenEvents; });
        events.forEach(function (e) { seenEvents = Math.max(seenEvents, e.n); });
        var two = hands.length >= 2;
        // Each group's hands: its own with two hands; with one, both groups share it.
        var handsOf = function (g) { return two ? (m > 0.5 ? hands : [hands[g]]) : hands; };
        var ownHand = function (g) { return two ? hands[g] : hands[0]; };
        var home = { x: W / 2, y: H / 2 };

        // Merge state: one hand or none, merged; two hands, merge on touch and split when pulled apart.
        if (!two) mergedFlag = true;
        else if (mergedFlag && Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) > 3.4 * Rsep) { mergedFlag = false; splitAt = t; }
        groups.forEach(function (G, g) { if (!G.center) { var h0 = ownHand(g); G.center = h0 ? { x: h0.center.x, y: h0.center.y } : { x: home.x, y: home.y }; } });
        if (two && !mergedFlag && t - splitAt > 1) {
          var rr0 = Rsep * (0.02 + 1.03 * groups[0].breath), rr1 = Rsep * (0.02 + 1.03 * groups[1].breath);
          if (Math.hypot(groups[0].center.x - groups[1].center.x, groups[0].center.y - groups[1].center.y) < 0.9 * (rr0 + rr1)) mergedFlag = true;
        }
        m += ((mergedFlag ? 1 : 0) - m) * (1 - Math.exp(-dt / 0.8));
        if (Math.abs(m - (mergedFlag ? 1 : 0)) < 0.002) m = mergedFlag ? 1 : 0;

        // Centers: a spring to the hand (or home), plus mutual gravity while apart.
        var wc = 2 * Math.PI * 1.6, Gk = 1.9 * wc * wc * Rsep * Rsep * Rsep;
        groups.forEach(function (G, g) {
          var h0 = ownHand(g), aim = h0 ? h0.center : home;
          var ax = wc * wc * (aim.x - G.center.x) - 2 * 0.9 * wc * G.cv.x, ay = wc * wc * (aim.y - G.center.y) - 2 * 0.9 * wc * G.cv.y;
          if (!h0) { ax *= 0.15; ay *= 0.15; }
          if (two && m < 1) {
            var O = groups[1 - g].center, gx = O.x - G.center.x, gy = O.y - G.center.y, d = Math.max(Rsep * 0.5, Math.hypot(gx, gy));
            ax += (1 - m) * Gk / (d * d) * gx / d; ay += (1 - m) * Gk / (d * d) * gy / d;
          }
          G.cv.x += ax * dt; G.cv.y += ay * dt;
          G.center.x += G.cv.x * dt; G.center.y += G.cv.y * dt;
        });
        var cm = { x: (groups[0].center.x + groups[1].center.x) / 2, y: (groups[0].center.y + groups[1].center.y) / 2 };

        // Per group: breath, spin, pinch.
        var bOf = function (h) { return h.fist ? 0 : h.count >= 5 ? 1 : 0.15 + 0.85 * (h.count / 5); };
        groups.forEach(function (G, g) {
          var hs = handsOf(g), hd = ownHand(g);
          var target = hs.length ? hs.reduce(function (a, h) { return a + bOf(h); }, 0) / hs.length : 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
          G.breath += (target - G.breath) * (1 - Math.exp(-dt * spd / (target < G.breath ? 0.18 : 0.35)));
          if (hd) {
            var R = Rsep + (Rbase - Rsep) * m, c = m > 0.5 ? cm : G.center;
            var near = Math.hypot(hd.center.x - c.x, hd.center.y - c.y) < R * 1.3;
            if (near && hd.speed > H * 0.3) { G.omega[0] += hd.velocity.y / R * dt * 3; G.omega[1] += hd.velocity.x / R * dt * 3; }
            if (G.roll !== null) { var dr = (hd.rotation - G.roll) * Math.PI / 180; dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(dr) > 0.003) turn(G, [0, 0, 1], dr); }
            G.roll = hd.rotation;
            events.forEach(function (e) { if (e.type === 'swipe' && e.hand === hd.id) { var dd = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[e.dir] || [0, 0]; G.omega[0] += dd[1] * 4; G.omega[1] += dd[0] * 4; } });
          } else G.roll = null;
          var wl = Math.hypot(G.omega[0], G.omega[1], G.omega[2]);
          if (wl > 1e-4) turn(G, [G.omega[0] / wl, G.omega[1] / wl, G.omega[2] / wl], -wl * dt);
          var decay = Math.pow(0.5, dt / 3);
          G.omega = [G.omega[0] * decay, 0.25 + (G.omega[1] - 0.25) * decay, G.omega[2] * decay];
          // Pinch: start the stream (delays by distance, nearest first); let go: bloom and return.
          var ph = hs.filter(function (h) { return h.pinched; })[0], pinched = !!ph;
          if (ph) G.pin = { x: (ph.points[4].x + ph.points[8].x) / 2, y: (ph.points[4].y + ph.points[8].y) / 2 };
          if (pinched && !G.wasPinched) {
            var far = 1;
            G.P.forEach(function (q) { if (q.sx !== null) far = Math.max(far, Math.hypot(q.sx - G.pin.x, q.sy - G.pin.y)); });
            G.P.forEach(function (q) {
              if (q.sx === null) return;
              if (q.mode === 0) { q.fx = q.sx; q.fy = q.sy; q.fvx = 0; q.fvy = 0; }
              q.mode = 1; q.delay = (Math.hypot(q.fx - G.pin.x, q.fy - G.pin.y) / far * 0.5 + Math.random() * 0.15) / spd;
            });
          }
          if (!pinched && G.wasPinched) {
            G.P.forEach(function (q) {
              if (q.mode !== 1) return;
              var a = Math.atan2(q.fy - G.pin.y, q.fx - G.pin.x), bs = H * (0.6 + Math.random() * 0.6) * spd;
              q.fvx += Math.cos(a) * bs; q.fvy += Math.sin(a) * bs; q.mode = 2;
            });
          }
          G.wasPinched = pinched;
        });

        // Particles.
        var Mm = groups[0].M, bm = (groups[0].breath + groups[1].breath) / 2;
        var vmax = H * 2.2 * spd, amax = H * 9 * spd, wf = 2 * Math.PI * 1.1 * spd, Kf = wf * wf, Cf = 2 * 0.8 * wf, sub = 2;
        var dots = [[], [], []], streaks = [[], [], []];
        groups.forEach(function (G, g) {
          var O = groups[1 - g].center, ox0 = O.x - G.center.x, oy0 = O.y - G.center.y, ol = Math.hypot(ox0, oy0) || 1;
          var h = dt * spd / sub;
          G.P.forEach(function (q) {
            // Breath spring on the particle's own radius.
            var w0 = 0;
            var ds = rot(G.M, q.d);
            // Its share threshold: lowest facing the other sphere.
            var facing = (ds[0] * ox0 + -ds[1] * oy0) / ol, thr = 0.5 * (1 - facing) / 2;
            w0 = smooth((m - thr) / 0.5);
            var br = G.breath + (bm - G.breath) * w0;
            for (var s = 0; s < sub; s++) { var a = -q.w * q.w * (q.r - br * q.jit) - 2 * 0.35 * q.w * q.v; q.v += a * h; q.r += q.v * h; }
            var rr = 0.02 + 1.03 * Math.max(0, q.r);
            var k1 = F / (F + ds[2]), x1 = G.center.x + ds[0] * rr * Rsep * k1, y1 = G.center.y - ds[1] * rr * Rsep * k1;
            var dmv = rot(Mm, q.dm), k2 = F / (F + dmv[2]), x2 = cm.x + dmv[0] * rr * Rbase * k2, y2 = cm.y - dmv[1] * rr * Rbase * k2;
            var sx = x1 + (x2 - x1) * w0, sy = y1 + (y2 - y1) * w0, zz = ds[2] + (dmv[2] - ds[2]) * w0;
            var band = Math.abs(zz) < 0.35 ? 0 : Math.abs(zz) < 0.7 ? 1 : 2;
            q.sx = sx; q.sy = sy;
            if (q.mode === 1 && q.delay > 0) { q.delay -= dt; q.fx = sx; q.fy = sy; q.fvx = 0; q.fvy = 0; q.mode = 1; }
            else if (q.mode === 1 && G.pin) {
              // Steering with limited acceleration: velocity turns toward the pinch, never jumps.
              // Close in, the target becomes a point circling the pinch, so they swirl in a cloud.
              q.ang += dt * 3 * spd;
              var rad = H * 0.05 * q.orb, tx = G.pin.x + Math.cos(q.ang) * rad, ty = G.pin.y + Math.sin(q.ang) * rad;
              var gx = tx - q.fx, gy = ty - q.fy, gl = Math.hypot(gx, gy) || 1, want = Math.min(vmax, gl * 4);
              var ax = gx / gl * want - q.fvx, ay = gy / gl * want - q.fvy, al = Math.hypot(ax, ay), lim = amax * dt;
              if (al > lim) { ax *= lim / al; ay *= lim / al; }
              var px0 = q.fx, py0 = q.fy;
              q.fvx += ax; q.fvy += ay; q.fx += q.fvx * dt; q.fy += q.fvy * dt;
              dots[0].push(q.fx, q.fy);
              if (bristle > 0) streaks[0].push(q.fx, q.fy, px0 - q.fvx * dt * 2 * bristle, py0 - q.fvy * dt * 2 * bristle);
              return;
            }
            if (q.mode === 2) {
              var ax2 = -Kf * (q.fx - sx) - Cf * q.fvx, ay2 = -Kf * (q.fy - sy) - Cf * q.fvy, px1 = q.fx, py1 = q.fy;
              q.fvx += ax2 * dt; q.fvy += ay2 * dt; q.fx += q.fvx * dt; q.fy += q.fvy * dt;
              if (Math.hypot(q.fx - sx, q.fy - sy) < 1.5 && Math.hypot(q.fvx, q.fvy) < H * 0.05) q.mode = 0;
              dots[0].push(q.fx, q.fy);
              if (bristle > 0) streaks[0].push(q.fx, q.fy, px1 - q.fvx * dt * 2 * bristle, py1 - q.fvy * dt * 2 * bristle);
              return;
            }
            dots[band].push(sx, sy);
            var speed = Math.abs(q.v);
            if (bristle > 0 && speed > 0.3) {
              var back = Math.min(0.5, speed * 0.12 * bristle) * Math.sign(q.v), r0 = Math.max(0, rr - back), f0 = r0 / Math.max(rr, 1e-3);
              var cx0 = G.center.x + (cm.x - G.center.x) * w0, cy0 = G.center.y + (cm.y - G.center.y) * w0;
              streaks[band].push(sx, sy, cx0 + (sx - cx0) * f0, cy0 + (sy - cy0) * f0);
            }
          });
        });

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var sz = Math.max(1, 1.3 * u);
        var tightOf = function (b) { return Math.max(0, 1 - b / 0.15); };
        var tightAll = Math.max(tightOf(groups[0].breath), tightOf(groups[1].breath));
        var alphaBand = [0.95, 0.4 + 0.5 * tightAll, 0.1 + 0.8 * tightAll];
        for (var b = 2; b >= 0; b--) {
          ctx.strokeStyle = 'rgba(' + rgb + ',' + (alphaBand[b] * 0.8).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.6, 0.9 * u);
          ctx.beginPath();
          var sl = streaks[b];
          for (var j = 0; j < sl.length; j += 4) { ctx.moveTo(sl[j], sl[j + 1]); ctx.lineTo(sl[j + 2], sl[j + 3]); }
          ctx.stroke();
          // All of a band's dots in one path and one fill (thousands of fillRect calls are slow).
          ctx.fillStyle = 'rgba(' + rgb + ',' + Math.min(1, alphaBand[b]).toFixed(3) + ')';
          var dl = dots[b];
          ctx.beginPath();
          for (var j2 = 0; j2 < dl.length; j2 += 2) ctx.rect(dl[j2] - sz / 2, dl[j2 + 1] - sz / 2, sz, sz);
          ctx.fill();
        }
        // Implosion cores: the merged sphere's (weight m) and each separate sphere's (weight 1 − m).
        var core = function (cx, cy, R, tight, wgt) {
          if (tight * wgt < 0.2) return;
          var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12), k = tight * wgt;
          gr.addColorStop(0, 'rgba(255,255,255,' + (0.7 * k).toFixed(3) + ')');
          gr.addColorStop(0.4, 'rgba(' + rgb + ',' + (0.5 * k).toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(' + rgb + ',0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2); ctx.fill();
        };
        core(cm.x, cm.y, Rbase, tightOf(bm), m);
        groups.forEach(function (G) { core(G.center.x, G.center.y, Rsep, tightOf(G.breath), 1 - m); });
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
      },
      reset: function () { key = ''; lastT = null; groups = []; m = 1; mergedFlag = true; splitAt = -9; }
    };
  }

  Magi.renderers.exhale = createExhale;
})();
