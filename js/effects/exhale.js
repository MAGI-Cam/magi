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
// Pinch: the sphere moves to your pinch, carried there by its particles rather than jumping: the
// sphere's center goes to the pinch at once, but every particle follows the center through its own
// lag (a first-order follower, time constant 0.05–0.95 s ÷ Speed, random per particle, for 1.6 s
// after a pinch or a release; 0.04–0.12 s otherwise). So they set off in a stream and gather into
// the sphere at the pinch, holding there while you pinch; let go and they stream back to your palm.
// Speed scales all of that motion and the breath, ×0.35 to ×2.9 (2^((Speed − 50)/33)).
// Looks (modes): Sphere (dots), Zero (each particle a digit, its latitude band on its own sphere
// counted 0–9 from the top pole, as in the Zero landmark) and Binary (each particle a bit, 0 or 1,
// flipping at random about every 2.5 s).
// Drawing: everything goes into one pixel buffer (an ImageData at up to 1280 px), added like light
// (dots as small squares, digits from glyph masks, streaks as DDA lines), then drawn over the
// camera once with 'lighter' compositing: a few thousand canvas paths with additive blending are
// what slowed phones. Glow adds a bloom of that layer (fx.bloom).
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function fib(k, n) { var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN; return [r * Math.cos(phi), y, r * Math.sin(phi)]; }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  function createGroup(n, g, breath) {
    var P = [];
    for (var k = 0; k < n; k++) {
      P.push({ d: fib(k, n), dm: fib(2 * k + g, 2 * n), r: breath, v: 0, w: 2 * Math.PI * (2 + Math.random() * 4), jit: 0.95 + Math.random() * 0.1,
        lag: Math.random(), cx: null, cy: null, lx: null, ly: null, digit: Math.round(Math.acos(fib(k, n)[1]) / Math.PI * 20) % 10, bit: Math.random() < 0.5 ? 1 : 0 });
    }
    return { P: P, breath: breath, center: null, cv: { x: 0, y: 0 }, M: [1, 0, 0, 0, 1, 0, 0, 0, 1], omega: [0, 0.25, 0], roll: null, wasPinched: false, pin: null, flowUntil: -9 };
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
    var groups = [], key = '', lastT = null, seenEvents = 0, m = 1, mergedFlag = true, splitAt = -9;
    var layer = document.createElement('canvas'), lctx = layer.getContext('2d'), img = null, buf = null, u32 = null;
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
        var bristle = params.bristles / 100, look = params.mode || 'sphere';
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

        // Pinches: a pinched group's center goes straight to the pinch (its particles follow with lag).
        groups.forEach(function (G, g) {
          var ph = handsOf(g).filter(function (h) { return h.pinched; })[0], pinched = !!ph;
          G.pin = ph ? { x: (ph.points[4].x + ph.points[8].x) / 2, y: (ph.points[4].y + ph.points[8].y) / 2 } : null;
          if (pinched !== G.wasPinched) G.flowUntil = t + 1.6 / spd;
          G.wasPinched = pinched;
        });
        // Centers: the pinch, or a spring to the hand (or home), plus mutual gravity while apart.
        var wc = 2 * Math.PI * 1.6, Gk = 1.9 * wc * wc * Rsep * Rsep * Rsep;
        groups.forEach(function (G, g) {
          if (G.pin) { G.center.x = G.pin.x; G.center.y = G.pin.y; G.cv.x = G.cv.y = 0; return; }
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

        // Per group: breath and spin.
        var bOf = function (h) { return h.fist ? 0 : h.count >= 5 ? 1 : 0.15 + 0.85 * (h.count / 5); };
        groups.forEach(function (G, g) {
          var hs = handsOf(g), hd = ownHand(g);
          var target = hs.length ? hs.reduce(function (a, h) { return a + bOf(h); }, 0) / hs.length : 0.5 - 0.5 * Math.cos(2 * Math.PI * (params.rate / 60) * t);
          G.breath += (target - G.breath) * (1 - Math.exp(-dt * spd / (target < G.breath ? 0.18 : 0.35)));
          if (hd) {
            var R = Rsep + (Rbase - Rsep) * m, c = m > 0.5 ? cm : G.center;
            var near = Math.hypot(hd.center.x - c.x, hd.center.y - c.y) < R * 1.3;
            if (near && hd.speed > H * 0.3 && !hd.pinched) { G.omega[0] += hd.velocity.y / R * dt * 3; G.omega[1] += hd.velocity.x / R * dt * 3; }
            if (G.roll !== null) { var dr = (hd.rotation - G.roll) * Math.PI / 180; dr -= Math.round(dr / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(dr) > 0.003) turn(G, [0, 0, 1], dr); }
            G.roll = hd.rotation;
            events.forEach(function (e) { if (e.type === 'swipe' && e.hand === hd.id) { var dd = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[e.dir] || [0, 0]; G.omega[0] += dd[1] * 4; G.omega[1] += dd[0] * 4; } });
          } else G.roll = null;
          var wl = Math.hypot(G.omega[0], G.omega[1], G.omega[2]);
          if (wl > 1e-4) turn(G, [G.omega[0] / wl, G.omega[1] / wl, G.omega[2] / wl], -wl * dt);
          var decay = Math.pow(0.5, dt / 3);
          G.omega = [G.omega[0] * decay, 0.25 + (G.omega[1] - 0.25) * decay, G.omega[2] * decay];
        });

        // The pixel layer: opaque black (adds nothing under 'lighter'), at up to 1280 px.
        var sL = Math.min(1, 1280 / Math.max(W, H)), LW = Math.max(1, Math.round(W * sL)), LH = Math.max(1, Math.round(H * sL));
        if (layer.width !== LW || layer.height !== LH) { layer.width = LW; layer.height = LH; img = null; }
        if (!img) { img = lctx.createImageData(LW, LH); buf = img.data; u32 = new Uint32Array(buf.buffer); }
        u32.fill(0xFF000000);
        var IR = ink[0] * 255, IG = ink[1] * 255, IB = ink[2] * 255;
        var ds = Math.max(1, Math.round(1.3 * u * sL));
        function dot(x, y, k) {
          var x0 = Math.round(x * sL - ds / 2), y0 = Math.round(y * sL - ds / 2);
          if (x0 < 0 || y0 < 0 || x0 + ds > LW || y0 + ds > LH) return;
          for (var yy = 0; yy < ds; yy++) for (var xx = 0, i = ((y0 + yy) * LW + x0) * 4; xx < ds; xx++, i += 4) { buf[i] += IR * k; buf[i + 1] += IG * k; buf[i + 2] += IB * k; }
        }
        var masks = look === 'zero' ? Magi.fx.glyphMasks('0123456789', Math.max(5, Math.round(7 * u * sL))) : look === 'binary' ? Magi.fx.glyphMasks('01', Math.max(5, Math.round(7 * u * sL))) : null;
        function glyph(x, y, gm, k) {
          var x0 = Math.round(x * sL - gm.w / 2), y0 = Math.round(y * sL - gm.h / 2);
          if (x0 < 0 || y0 < 0 || x0 + gm.w > LW || y0 + gm.h > LH) return;
          var a = gm.a, j = 0;
          for (var yy = 0; yy < gm.h; yy++) for (var xx = 0, i = ((y0 + yy) * LW + x0) * 4; xx < gm.w; xx++, i += 4, j++) { var c = a[j] * k; if (c > 0.02) { buf[i] += IR * c; buf[i + 1] += IG * c; buf[i + 2] += IB * c; } }
        }
        function line(x0, y0, x1, y1, k) {
          x0 *= sL; y0 *= sL; x1 *= sL; y1 *= sL;
          var steps = Math.min(80, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
          for (var s = 0; s <= steps; s++) {
            var f = steps ? s / steps : 0, px = Math.round(x0 + (x1 - x0) * f), py = Math.round(y0 + (y1 - y0) * f);
            if (px < 0 || py < 0 || px >= LW || py >= LH) continue;
            var i = (py * LW + px) * 4, kk = k * (1 - f * 0.7);
            buf[i] += IR * kk; buf[i + 1] += IG * kk; buf[i + 2] += IB * kk;
          }
        }

        // Particles.
        var Mm = groups[0].M, bm = (groups[0].breath + groups[1].breath) / 2;
        var tightOf = function (b) { return Math.max(0, 1 - b / 0.15); };
        var tightAll = Math.max(tightOf(groups[0].breath), tightOf(groups[1].breath));
        var bandK = [0.95, 0.4 + 0.5 * tightAll, 0.1 + 0.8 * tightAll], flip = dt * 0.4;
        groups.forEach(function (G, g) {
          var O = groups[1 - g].center, ox0 = O.x - G.center.x, oy0 = O.y - G.center.y, ol = Math.hypot(ox0, oy0) || 1;
          var h = dt * spd / 2, M = G.M, flowing = t < G.flowUntil;
          var mFull = m >= 1, mNone = m <= 0;
          G.P.forEach(function (q) {
            var d = q.d, dx = M[0] * d[0] + M[1] * d[1] + M[2] * d[2], dy = -(M[3] * d[0] + M[4] * d[1] + M[5] * d[2]), dz = M[6] * d[0] + M[7] * d[1] + M[8] * d[2];
            // Its share threshold: lowest facing the other sphere.
            var w0 = mFull ? 1 : mNone ? 0 : smooth((m - 0.25 * (1 - (dx * ox0 - dy * oy0) / ol)) / 0.5);
            var br = G.breath + (bm - G.breath) * w0;
            for (var s = 0; s < 2; s++) { var a = -q.w * q.w * (q.r - br * q.jit) - 2 * 0.35 * q.w * q.v; q.v += a * h; q.r += q.v * h; }
            var rr = 0.02 + 1.03 * Math.max(0, q.r), k1 = F / (F + dz), ox = dx * rr * Rsep * k1, oy = -dy * rr * Rsep * k1, zz = dz;
            if (w0 > 0) {
              var e = q.dm, mx = Mm[0] * e[0] + Mm[1] * e[1] + Mm[2] * e[2], my = -(Mm[3] * e[0] + Mm[4] * e[1] + Mm[5] * e[2]), mz = Mm[6] * e[0] + Mm[7] * e[1] + Mm[8] * e[2], k2 = F / (F + mz);
              ox += (mx * rr * Rbase * k2 - ox) * w0; oy += (-my * rr * Rbase * k2 - oy) * w0; zz += (mz - zz) * w0;
            }
            // Each particle follows the center through its own lag (long while flowing to or from a pinch).
            var tcx = G.center.x + (cm.x - G.center.x) * w0, tcy = G.center.y + (cm.y - G.center.y) * w0;
            if (q.cx === null) { q.cx = tcx; q.cy = tcy; }
            var tau = flowing ? (0.05 + 0.9 * q.lag) / spd : 0.04 + 0.08 * q.lag, kf = 1 - Math.exp(-dt / tau);
            q.cx += (tcx - q.cx) * kf; q.cy += (tcy - q.cy) * kf;
            var sx = q.cx + ox, sy = q.cy + oy, band = Math.abs(zz) < 0.35 ? 0 : Math.abs(zz) < 0.7 ? 1 : 2, kb = bandK[band];
            if (masks) {
              if (look === 'binary' && Math.random() < flip) q.bit ^= 1;
              glyph(sx, sy, masks[look === 'binary' ? q.bit : q.digit], kb);
            } else dot(sx, sy, kb);
            if (bristle > 0) {
              var speed = Math.abs(q.v);
              if (speed > 0.3) {
                var back = Math.min(0.5, speed * 0.12 * bristle) * Math.sign(q.v), f0 = Math.max(0, rr - back) / Math.max(rr, 1e-3);
                line(sx, sy, q.cx + ox * f0, q.cy + oy * f0, kb * 0.6);
              }
              // A streak behind particles that are travelling (to or from a pinch).
              if (q.lx !== null) { var mvx = sx - q.lx, mvy = sy - q.ly; if (mvx * mvx + mvy * mvy > 9) line(sx, sy, sx - mvx * 3 * bristle, sy - mvy * 3 * bristle, kb * 0.5); }
            }
            q.lx = sx; q.ly = sy;
          });
        });
        lctx.putImageData(img, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(layer, 0, 0, W, H);
        ctx.restore();
        Magi.fx.bloom(ctx, layer, W, H, (params.glow === undefined ? 40 : params.glow) / 100);

        // Implosion cores: the merged sphere's (weight m) and each separate sphere's (weight 1 − m).
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
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
