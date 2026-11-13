// Siri: a voice assistant's listening wave, driven by your hand instead of your voice (after
// references of the classic Siri wave and the newer glass pill).
//
// Gesture: open your hand to wake it. Each finger is tied to one color (thumb rose, index amber,
// middle green, ring blue, pinky violet): how straight that finger is (1 − curl) is how tall its
// wave stands, so you can play the colors one by one. How close your hand is to the camera (the
// palm's size in the picture, from 6% to 25% of the frame's short side) is the intensity: reach
// toward the camera and every wave grows. How fast your hand moves is the speed: the waves run
// faster while you move (up to 3×). Make a fist, or take your hand away, and it settles into a
// calm thin wave idling at the bottom. Waking eases in with a 0.25 s time constant; each finger's
// level follows with 0.06 s attack and 0.18 s release, like an audio level meter.
//
// Wave (the classic look): one curve per finger, y = A·att(x)·sin(f·x − φ) under SiriWave's
// envelope att(x) = (K / (K + x⁴))^K, K = 2, over x ∈ [−2, 2], so each swells in the middle and
// pinches to points at the ends. Each is filled between y and −y (a lens-shaped lobe) and blended
// with 'screen', 1 − (1 − a)(1 − b), which brightens where colors cross without blowing out to a
// flat white the way plain addition does; a thin bright edge traces each lobe, and a soft halo is
// the same drawing at a quarter size, scaled up.
// Pill (the newer look): a dark glass pill whose lower rim glows with a moving spectrum; the glow's
// height along the rim is a sum of sines scaled by the level, so it ripples like a level meter.
// Asleep, it shrinks to a short bar at the bottom, like a home indicator.
(function () {
  // Thumb, index, middle, ring, pinky.
  var FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  var COLORS = [[255, 72, 120], [255, 168, 52], [52, 222, 150], [44, 140, 255], [168, 92, 255]];
  function att(x) { var K = 2; return Math.pow(K / (K + Math.pow(x, 4)), K); }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  Magi.renderers.siri = function () {
    var wake = 0, near = 1, move = 0, lastT = null, phase = 0, halo = document.createElement('canvas'), hctx = halo.getContext('2d');
    // Each finger's curve: its own frequency and phase speed, so the five never move in step.
    var FREQ = [1.7, 2.3, 1.4, 2.0, 2.7], RATE = [1.1, -1.5, 1.3, -1.2, 1.7];
    var lv = [0, 0, 0, 0, 0];

    function wave(g, cx, cy, half, amps, alpha, ph, edge) {
      g.save();
      g.globalCompositeOperation = 'screen';
      COLORS.forEach(function (col, ci) {
        var a = amps[ci];
        if (a < 0.3) return;
        var N = 96, top = [];
        for (var k = 0; k <= N; k++) {
          var x = -2 + 4 * k / N;
          top.push([cx + x / 2 * half, a * att(x) * Math.sin(FREQ[ci] * x * 1.6 - ph * RATE[ci] + ci * 1.3)]);
        }
        var cc = col.join(',');
        g.fillStyle = 'rgba(' + cc + ',' + alpha + ')';
        g.beginPath();
        top.forEach(function (q, k) { k ? g.lineTo(q[0], cy - q[1]) : g.moveTo(q[0], cy - q[1]); });
        for (var j = top.length - 1; j >= 0; j--) g.lineTo(top[j][0], cy + top[j][1]);
        g.closePath(); g.fill();
        if (edge) {
          // A thin bright edge along each lobe, for a crisp outline.
          g.strokeStyle = 'rgba(' + col.map(function (v) { return Math.round(v + (255 - v) * 0.55); }).join(',') + ',' + Math.min(1, alpha + 0.25) + ')';
          g.lineWidth = edge; g.stroke();
        }
      });
      g.restore();
    }

    function haloOf(ctx, W, H, draw, strength, q) {
      q = q || 4; var hw = Math.max(1, Math.round(W / q)), hh = Math.max(1, Math.round(H / q));
      if (halo.width !== hw || halo.height !== hh) { halo.width = hw; halo.height = hh; }
      hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.clearRect(0, 0, hw, hh);
      hctx.setTransform(1 / q, 0, 0, 1 / q, 0, 0);
      draw(hctx);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = strength; ctx.imageSmoothingEnabled = true;
      // Two passes at growing scale: a cheap bloom.
      ctx.drawImage(halo, 0, 0, W, H);
      ctx.drawImage(halo, -W * 0.02, -H * 0.04, W * 1.04, H * 1.08);
      ctx.restore();
    }

    function pillPath(g, x, y, w, h) {
      var r = h / 2;
      g.beginPath();
      g.moveTo(x - w / 2 + r, y - h / 2); g.lineTo(x + w / 2 - r, y - h / 2);
      g.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x - w / 2 + r, y + h / 2);
      g.arc(x - w / 2 + r, y, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;

        // Hand → awake, each finger's level, intensity (closeness) and speed (motion).
        var hands = Magi.interaction.read(frame).hands, hd = hands.filter(function (h) { return !h.fist; })[0], open = 0;
        if (hd) open = Math.max(0, Math.min(1, (['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - hd.fingers[f].curl) / 4; }, 0) - 0.25) / 0.6));
        var awake = hd && open > 0.35 ? 1 : 0;
        wake += (awake - wake) * (1 - Math.exp(-dt / 0.25));
        FINGERS.forEach(function (f, k) {
          var tgt = awake ? Math.max(0, Math.min(1, (1 - hd.fingers[f].curl - 0.15) / 0.7)) : 0;
          lv[k] += (tgt - lv[k]) * (1 - Math.exp(-dt / (tgt > lv[k] ? 0.06 : 0.18)));
        });
        var level = lv.reduce(function (a, v) { return a + v; }, 0) / 5;
        var nearT = hd ? 0.35 + 1.3 * Math.max(0, Math.min(1, ((hd.size || M * 0.12) / M - 0.06) / 0.19)) : 1;
        near += (nearT - near) * (1 - Math.exp(-dt / 0.2));
        var moveT = hd ? Math.min(2, (hd.speed || 0) / H * 1.5) : 0;
        move += (moveT - move) * (1 - Math.exp(-dt / (moveT > move ? 0.1 : 0.5)));
        phase += dt * (1.5 + params.speed / 100 * 5) * (0.6 + 0.6 * level) * (1 + move);

        // Dim the camera as it wakes.
        var dim = params.dim / 100 * (0.35 + 0.65 * wake);
        if (dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dim.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }

        var s = smooth(wake), size = 0.45 + params.size / 100 * 0.55;
        if (params.mode === 'pill') {
          // Asleep: a short bar at the bottom. Awake: a wide glass pill in the middle.
          var bx = W / 2, by = H - M * 0.05, bw = W * 0.28, bh = Math.max(4, 5 * u);
          var aw = W * 0.85 * size, ah = M * 0.16 * size, py = H / 2;
          var x = bx, y = by + (py - by) * s, w = bw + (aw - bw) * s, h = bh + (ah - bh) * s;
          var lvl = (0.15 + 0.85 * level) * near, glowH = h * (0.35 + 1.4 * lvl * params.height / 100) * (0.25 + 0.75 * s);
          var rim = function (g) {
            // The spectrum along the lower rim, moving; its height ripples with the level.
            var N = 60, x0 = x - w / 2, gr = g.createLinearGradient(x0, 0, x0 + w, 0);
            for (var k = 0; k <= 6; k++) { var hue = (k / 6 * 360 + phase * 40) % 360; gr.addColorStop(k / 6, 'hsl(' + hue.toFixed(0) + ',95%,62%)'); }
            g.fillStyle = gr;
            g.beginPath(); g.moveTo(x0, y);
            for (var i = 0; i <= N; i++) {
              var xx = i / N, ripple = 0.55 + 0.25 * Math.sin(xx * 9 + phase * 2.3) + 0.2 * Math.sin(xx * 17 - phase * 3.1);
              g.lineTo(x0 + xx * w, y + h / 2 + glowH * ripple * Math.sin(Math.PI * xx));
            }
            g.lineTo(x0 + w, y); g.closePath(); g.fill();
          };
          // The glow is only ever seen blurred (the halo); on the pill itself a thin spectral rim.
          haloOf(ctx, W, H, rim, 0.3 + 0.6 * params.glow / 100, 6);
          haloOf(ctx, W, H, rim, 0.3 + 0.5 * params.glow / 100, 16);
          if (s > 0.05) {
            ctx.save();
            var sg = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
            for (var k2 = 0; k2 <= 6; k2++) sg.addColorStop(k2 / 6, 'hsla(' + ((k2 / 6 * 360 + phase * 40) % 360).toFixed(0) + ',95%,70%,' + (0.9 * s).toFixed(3) + ')');
            ctx.strokeStyle = sg; ctx.lineWidth = Math.max(1.5, 2 * u * (0.5 + lvl));
            ctx.beginPath(); ctx.arc(x + w / 2 - h / 2, y, h / 2, 0, Math.PI / 2); ctx.lineTo(x - w / 2 + h / 2, y + h / 2); ctx.arc(x - w / 2 + h / 2, y, h / 2, Math.PI / 2, Math.PI); ctx.stroke();
            ctx.restore();
          }
          ctx.save();
          pillPath(ctx, x, y, w, h);
          ctx.fillStyle = s < 0.15 ? 'rgba(255,255,255,0.9)' : 'rgba(8,8,10,' + (0.82 * s).toFixed(3) + ')'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 * s).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, u); ctx.stroke();
          ctx.restore();
        } else {
          // Asleep: a calm, thin wave idling at the bottom. Awake: the wave across the middle,
          // each finger's curve as tall as that finger is straight, all scaled by closeness.
          var cy = H - M * 0.08 + (H / 2 - (H - M * 0.08)) * s, half = W * (0.16 + (0.42 * size - 0.16) * s);
          var big = M * 0.3 * params.height / 100 * size * near, idle = M * 0.012 * (1 + 0.3 * Math.sin(t * 1.3));
          var amps = lv.map(function (v, k) { return idle * (1 - s) + big * (0.08 + 0.92 * v) * s + idle * 0.5 * (0.6 + 0.4 * Math.sin(t * 0.9 + k)); });
          var drawWave = function (g) { wave(g, W / 2, cy, half, amps, 0.75, phase, 0); };
          haloOf(ctx, W, H, drawWave, 0.15 + 0.45 * params.glow / 100);
          wave(ctx, W / 2, cy, half, amps, 0.62, phase, Math.max(1, 1.1 * u));
        }

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Open your hand to wake it. Each finger plays one color; bring your hand closer for more, move it for speed. A fist puts it to rest.');
      },
      reset: function () { lastT = null; wake = 0; near = 1; move = 0; lv = [0, 0, 0, 0, 0]; }
    };
  };
})();
