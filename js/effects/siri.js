// Siri: a voice assistant's listening wave, driven by your hand instead of your voice (after
// references of the classic Siri wave and the newer glass pill).
//
// Gesture: open your hand to wake it. How open your hand is (mean straightness of the four
// fingers, 1 − curl, mapped so a fist is 0 and a flat hand 1) is the loudness: the waves swell and
// shrink with it the way they follow a voice. Close your hand, or take it out of the picture, and
// it shrinks away to the bottom of the screen. Waking eases in with a 0.25 s time constant;
// loudness follows with 0.06 s attack and 0.18 s release, like an audio level meter.
//
// Wave (the classic look): three colored curves, each the sum of two sines under SiriWave's
// envelope att(x) = (K / (K + x⁴))^K, K = 2, over x ∈ [−2, 2], so they swell in the middle and
// pinch to points at the ends. Each curve is filled between y and −y (lens-shaped lobes) and added
// as light ('lighter'), so where the colors overlap they mix toward white; a soft halo is the same
// drawing at a quarter size, scaled up. Asleep, the wave curls up inside a small glass orb at the
// bottom.
// Pill (the newer look): a dark glass pill whose lower rim glows with a moving spectrum; the glow's
// height along the rim is a sum of sines scaled by loudness, so it ripples like a level meter.
// Asleep, it shrinks to a short bar at the bottom, like a home indicator.
(function () {
  var COLORS = [[173, 57, 76], [48, 220, 155], [15, 82, 169], [140, 60, 230]];
  function att(x) { var K = 2; return Math.pow(K / (K + Math.pow(x, 4)), K); }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  Magi.renderers.siri = function () {
    var wake = 0, level = 0, lastT = null, phase = 0, halo = document.createElement('canvas'), hctx = halo.getContext('2d');
    // A curve's two partials: frequency, phase speed and loudness share, fixed per curve.
    var PARTS = COLORS.map(function (c, i) { return [[1.6 + i * 0.35, 1.1 + i * 0.4, 0.65], [3.1 - i * 0.3, -1.7 - i * 0.25, 0.35]]; });

    function wave(g, cx, cy, half, amp, alpha, ph) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      PARTS.forEach(function (parts, ci) {
        // Each curve breathes on its own: loudness × (0.55 + 0.45·sin(slow)).
        var a = amp * (0.55 + 0.45 * Math.sin(ph * (0.6 + ci * 0.23) + ci * 2.1));
        var N = 90, top = [];
        for (var k = 0; k <= N; k++) {
          var x = -2 + 4 * k / N, y = 0;
          parts.forEach(function (p) { y += p[2] * Math.sin(p[0] * x * 1.6 - ph * p[1] + ci); });
          top.push([cx + x / 2 * half, y * att(x) * a]);
        }
        // Each lobe glows from its axis outward: full color at the center line, a third at the rim.
        var ext = Math.max(1, a), vg = g.createLinearGradient(0, cy - ext, 0, cy + ext), cc = COLORS[ci].join(',');
        vg.addColorStop(0, 'rgba(' + cc + ',' + (alpha * 0.35).toFixed(3) + ')');
        vg.addColorStop(0.5, 'rgba(' + cc + ',' + alpha + ')');
        vg.addColorStop(1, 'rgba(' + cc + ',' + (alpha * 0.35).toFixed(3) + ')');
        g.fillStyle = vg;
        g.beginPath();
        top.forEach(function (q, k) { k ? g.lineTo(q[0], cy - q[1]) : g.moveTo(q[0], cy - q[1]); });
        for (var j = top.length - 1; j >= 0; j--) g.lineTo(top[j][0], cy + top[j][1]);
        g.closePath(); g.fill();
      });
      // The bright core: a thin white line, fading to nothing at the ends.
      var gr = g.createLinearGradient(cx - half, 0, cx + half, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + (0.5 * alpha + 0.2).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(cx - half, cy - Math.max(0.6, amp * 0.03), half * 2, Math.max(1.2, amp * 0.06));
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

        // Hand → awake and loudness.
        var hands = Magi.interaction.read(frame).hands, open = 0;
        hands.forEach(function (h) {
          if (h.fist) return;
          var o = ['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - h.fingers[f].curl) / 4; }, 0);
          open = Math.max(open, Math.max(0, Math.min(1, (o - 0.25) / 0.6)));
        });
        var awake = open > 0.35 ? 1 : 0;
        wake += (awake - wake) * (1 - Math.exp(-dt / 0.25));
        var target = awake ? open : 0;
        level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.06 : 0.18)));
        phase += dt * (1.5 + params.speed / 100 * 5) * (0.5 + level);

        // Dim the camera as it wakes.
        var dim = params.dim / 100 * (0.35 + 0.65 * wake);
        if (dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dim.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }

        var s = smooth(wake), size = 0.45 + params.size / 100 * 0.55;
        if (params.mode === 'pill') {
          // Asleep: a short bar at the bottom. Awake: a wide glass pill in the middle.
          var bx = W / 2, by = H - M * 0.05, bw = W * 0.28, bh = Math.max(4, 5 * u);
          var aw = W * 0.85 * size, ah = M * 0.16 * size, py = H / 2;
          var x = bx, y = by + (py - by) * s, w = bw + (aw - bw) * s, h = bh + (ah - bh) * s;
          var lv = 0.15 + 0.85 * level, glowH = h * (0.35 + 1.4 * lv * params.height / 100) * (0.25 + 0.75 * s);
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
            ctx.strokeStyle = sg; ctx.lineWidth = Math.max(1.5, 2 * u * (0.5 + lv));
            ctx.beginPath(); ctx.arc(x + w / 2 - h / 2, y, h / 2, 0, Math.PI / 2); ctx.lineTo(x - w / 2 + h / 2, y + h / 2); ctx.arc(x - w / 2 + h / 2, y, h / 2, Math.PI / 2, Math.PI); ctx.stroke();
            ctx.restore();
          }
          ctx.save();
          pillPath(ctx, x, y, w, h);
          ctx.fillStyle = s < 0.15 ? 'rgba(255,255,255,0.9)' : 'rgba(8,8,10,' + (0.82 * s).toFixed(3) + ')'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 * s).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, u); ctx.stroke();
          ctx.restore();
        } else {
          // Asleep: a glass orb at the bottom with the wave curled inside. Awake: the wave across the middle.
          var ox = W / 2, oy = H - M * 0.1, orR = M * 0.05;
          var cx = ox, cy = oy + (H / 2 - oy) * s, half = orR * 0.9 + (W * 0.42 * size - orR * 0.9) * s;
          var amp = (orR * 0.35 + (M * 0.2 * params.height / 100 * size) * (0.12 + 0.88 * level)) * (0.6 + 0.4 * s) * (s < 0.5 ? 1 : 1);
          var drawWave = function (g) { wave(g, cx, cy, half, amp, 0.5, phase); };
          haloOf(ctx, W, H, drawWave, 0.3 + 0.7 * params.glow / 100);
          ctx.save();
          if (s < 0.98) {
            // The orb: clipped while it shrinks in, its glass rim fading as the wave leaves it.
            var R = orR + (Math.max(W, H) - orR) * s;
            ctx.beginPath(); ctx.arc(ox, oy + (H / 2 - oy) * s, R, 0, Math.PI * 2); ctx.clip();
          }
          wave(ctx, cx, cy, half, amp, 0.42, phase);
          ctx.restore();
          if (s < 0.9) {
            var a = 1 - s / 0.9, rg = ctx.createRadialGradient(ox, oy - orR * 0.3, orR * 0.2, ox, oy, orR);
            rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.8, 'rgba(255,255,255,' + (0.05 * a).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,255,255,' + (0.5 * a).toFixed(3) + ')');
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(ox, oy, orR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 * a).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, 0.8 * u); ctx.stroke();
          }
        }

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Open your hand to wake it; open it wider to make it louder. Close it to put it away.');
      },
      reset: function () { lastT = null; wake = 0; level = 0; }
    };
  };
})();
