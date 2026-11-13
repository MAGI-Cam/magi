// Siri: a voice assistant's listening wave, driven by your hand instead of your voice.
//
// Gesture: raise an open hand to wake it. How open your hand is (mean straightness of the four
// fingers, 1 − curl, mapped so a fist is 0 and a flat hand 1) is the loudness, followed like an
// audio level meter (0.06 s attack, 0.18 s release); a closed palm damps the wave down to a murmur.
// The wave sits at mid-height and follows your hand from side to side (time constant 0.15 s);
// pinch and spread thumb and index to shrink and grow it (0.4× to 1.4×). Lower your hand toward
// the bottom of the picture (below 78% of its height), or take it away, and Siri goes back to the
// bottom to rest.
//
// iOS 10 (after the classic iOS 9/10 Siri wave, as in the SiriWave library): three colors, blue
// (32, 133, 252), green (94, 252, 169) and red (253, 71, 103), added as light ('lighter'), so where
// they cross they make cyan, magenta and white, over a thin white line across the screen. Each
// color is the sum of 2–5 curves, each |A·sin(f·x − φ)|·att((x − c)/w) with
// att(u) = (4 / (4 + u²))⁴: a few lobes pinched to points between them, under a window placed and
// sized at random (center c across the middle, width w, amplitude 0.35–1, 2.2–3.8 radians per unit,
// either direction), filled between y and −y, lens-shaped. Each
// curve lives 1.5–3.5 s, swelling and fading as sin(π·age/life), then is born again elsewhere,
// so the wave keeps reshaping as it does when it listens. No glow, no reflection.
// iOS 27 (after the newer glowing Siri): the same curves in blue, magenta, amber and cyan, drawn
// soft and luminous: a blurred glow (the drawing at a quarter size, scaled up), translucent lobes
// and a white-hot core. Resting, it curls into a small glass orb at the bottom with the wave
// inside it.
(function () {
  var IOS10 = [[32, 133, 252], [94, 252, 169], [253, 71, 103]];
  var IOS27 = [[70, 120, 255], [255, 70, 160], [255, 180, 70], [80, 220, 255]];
  function att(x) { var K = 4; return Math.pow(K / (K + x * x), K); }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  Magi.renderers.siri = function () {
    var wake = 0, level = 0, lastT = null, cx = null, cy = null, sz = 1, groups = {};
    var glow = document.createElement('canvas'), gctx = glow.getContext('2d');
    function curve() { return { A: rnd(0.35, 1), c: rnd(-2, 2), w: rnd(0.5, 1.3), f: (Math.random() < 0.5 ? -1 : 1) * rnd(2.2, 3.8), sp: rnd(0.5, 1), ph: rnd(0, 6.28), age: 0, life: rnd(1.5, 3.5) }; }
    function colorCurves() { var c = [], k = Math.round(rnd(2, 5)); for (var i = 0; i < k; i++) { var q = curve(); q.age = rnd(0, q.life); c.push(q); } return c; }
    function setFor(key, n) {
      if (!groups[key]) { groups[key] = []; for (var i = 0; i < n; i++) groups[key].push(colorCurves()); }
      return groups[key];
    }
    function step(set, dt, rate) {
      set.forEach(function (cs) {
        cs.forEach(function (q, k) {
          q.age += dt; q.ph += dt * q.sp * rate;
          if (q.age > q.life) cs[k] = curve();
        });
      });
    }
    // One color's height at i ∈ [−3, 3] across the wave, about 0…1: the sum of its curves, each
    // |A·sin(f·i − φ)| (2.2–3.8 radians per unit, so a few lobes pinched to points between them) under
    // its own window att((i − c)/w) (center c, width w), swelling and fading over its life, all
    // under a gentle global taper so the ends thin to the line.
    function yOf(cs, i) {
      var y = 0;
      for (var k = 0; k < cs.length; k++) {
        var q = cs[k];
        y += Math.abs(q.A * Math.sin(q.f * i - q.ph)) * att((i - q.c) / q.w) * Math.sin(Math.PI * Math.min(1, q.age / q.life));
      }
      return Math.min(1.2, y) * att(i * 0.45);
    }
    function lobes(g, set, colors, x0, y0, half, amp, alpha, white) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      set.forEach(function (cs, ci) {
        var N = 120, top = [];
        for (var k = 0; k <= N; k++) { var i = -3 + 6 * k / N; top.push([x0 + i / 3 * half, yOf(cs, i) * amp]); }
        g.fillStyle = 'rgba(' + (white ? '255,255,255' : colors[ci].join(',')) + ',' + alpha + ')';
        g.beginPath();
        top.forEach(function (q, k) { k ? g.lineTo(q[0], y0 - q[1]) : g.moveTo(q[0], y0 - q[1]); });
        for (var j = top.length - 1; j >= 0; j--) g.lineTo(top[j][0], y0 + top[j][1]);
        g.closePath(); g.fill();
      });
      g.restore();
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        var ios27 = params.mode === 'ios27';

        // Hand: awake unless low or gone; loudness = openness (a fist damps it); x and size.
        var hands = Magi.interaction.read(frame).hands, hd = hands[0], open = 0;
        var up = !!hd && hd.center.y < H * 0.78;
        if (hd) open = hd.fist ? 0 : Math.max(0, Math.min(1, (['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - hd.fingers[f].curl) / 4; }, 0) - 0.25) / 0.6));
        wake += ((up ? 1 : 0) - wake) * (1 - Math.exp(-dt / 0.25));
        var target = up ? 0.08 + 0.92 * open : 0;
        level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.06 : 0.18)));
        var restY = H - M * 0.09, tx = up ? hd.center.x : W / 2, ty = up ? H / 2 : restY;
        if (cx === null) { cx = W / 2; cy = restY; }
        var kf = 1 - Math.exp(-dt / 0.15);
        cx += (tx - cx) * kf; cy += (ty - cy) * kf;
        var szT = hd ? 0.4 + Math.max(0, Math.min(1, ((hd.pinchWith.index.distance || 0) - 0.15) / 1.0)) : 1;
        sz += (szT - sz) * kf;

        var dim = params.dim / 100 * (0.35 + 0.65 * wake);
        if (dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dim.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }

        var colors = ios27 ? IOS27 : IOS10, set = setFor(ios27 ? 'b' : 'a', colors.length);
        step(set, dt, 2 + params.speed / 100 * 7);
        var s = smooth(wake), size = 0.45 + params.size / 100 * 0.55;
        var half = W * (0.12 + (0.46 * size * sz - 0.12) * s);
        var amp = M * 0.2 * params.height / 100 * size * sz * (0.03 + 0.97 * level) * (0.25 + 0.75 * s) + M * 0.004;

        if (!ios27) {
          // The thin white line across the screen, fading at its ends.
          var lw = W * (0.3 + 0.65 * s), gr = ctx.createLinearGradient(cx - lw / 2, 0, cx + lw / 2, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(cx - lw / 2, cy - Math.max(0.5, 0.6 * u), lw, Math.max(1, 1.2 * u));
          lobes(ctx, set, colors, cx, cy, half, amp, 0.75, false);
        } else {
          // Glow: the lobes at a quarter size, scaled up twice; then translucent lobes and a white core.
          var q = 4, gw = Math.max(1, Math.round(W / q)), gh = Math.max(1, Math.round(H / q));
          if (glow.width !== gw || glow.height !== gh) { glow.width = gw; glow.height = gh; }
          gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, gw, gh);
          gctx.setTransform(1 / q, 0, 0, 1 / q, 0, 0);
          lobes(gctx, set, colors, cx, cy, half, amp * 1.15, 0.9, false);
          var orbR = M * 0.055;
          ctx.save();
          if (s < 0.98) { var R = orbR + (Math.max(W, H) - orbR) * s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip(); }
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 + 0.4 * params.glow / 100;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(glow, 0, 0, W, H);
          ctx.drawImage(glow, -W * 0.03, -H * 0.05, W * 1.06, H * 1.1);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          lobes(ctx, set, colors, cx, cy, half, amp, 0.45, false);
          lobes(ctx, set, colors, cx, cy, half, amp * 0.18, 0.22, true);
          ctx.restore();
          if (s < 0.9) {
            // Resting: a glass orb round the curled-up wave (a rim of light, brighter at the top).
            var a = 1 - s / 0.9, rg = ctx.createRadialGradient(cx, cy, orbR * 0.75, cx, cy, orbR);
            rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(1, 'rgba(255,255,255,' + (0.35 * a).toFixed(3) + ')');
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * a).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, 0.9 * u);
            ctx.beginPath(); ctx.arc(cx, cy, orbR, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
          }
        }

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Raise an open hand to wake it; open it wider to make it louder, close it to quiet it. Lower your hand to send it back down.');
      },
      reset: function () { lastT = null; wake = 0; level = 0; cx = null; sz = 1; groups = {}; }
    };
  };
})();
