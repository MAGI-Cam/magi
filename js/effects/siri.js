// Siri: a voice assistant's listening wave, driven by your hand instead of your voice (after
// a reference of the classic Siri wave).
//
// Gesture: open your hand to wake it. How open your hand is (mean straightness of the four
// fingers, 1 − curl, mapped so a fist is 0 and a flat hand 1) is the loudness: the waves swell and
// shrink with it the way they follow a voice (0.06 s attack, 0.18 s release, like a level meter).
// The wave follows your hand from side to side (its center follows your palm's x, time constant
// 0.15 s) and stays at mid-height.
// Pinch and spread thumb and index: the wave shrinks and grows with them (0.4× to 1.4× its size).
// Make a fist, or take your hand away, and it settles into a calm thin wave resting at the bottom.
//
// Wave (the classic look, kept minimal): three curves (pink, light blue, violet), each
// y = A·att(x)·sin(f·x − φ) under SiriWave's envelope att(x) = (K / (K + x⁴))^K, K = 2, over
// x ∈ [−2, 2], so each swells in the middle and pinches to points at the ends, each breathing on
// its own. Each is filled between y and −y (a lens-shaped lobe) and blended with 'screen',
// 1 − (1 − a)(1 − b), which brightens where colors cross without blowing out to flat white; a thin
// bright edge traces each lobe, and a soft halo is the same drawing at a quarter size, scaled up.
(function () {
  var COLORS = [[240, 74, 150], [70, 175, 255], [120, 86, 255]];
  function att(x) { var K = 2; return Math.pow(K / (K + Math.pow(x, 4)), K); }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  Magi.renderers.siri = function () {
    var wake = 0, lastT = null, phase = 0, halo = document.createElement('canvas'), hctx = halo.getContext('2d');
    // Each curve: its own frequency and phase speed, so the three never move in step.
    var FREQ = [1.7, 2.4, 1.3], RATE = [1.1, -1.5, 1.35];
    var level = 0, cx = null, cy = null, sz = 1;

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

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), t = frame.time / 1000, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;

        // Hand → awake, loudness (openness), place (palm) and size (thumb–index spread).
        var hands = Magi.interaction.read(frame).hands, hd = hands.filter(function (h) { return !h.fist; })[0], open = 0;
        if (hd) open = Math.max(0, Math.min(1, (['index', 'middle', 'ring', 'pinky'].reduce(function (a, f) { return a + (1 - hd.fingers[f].curl) / 4; }, 0) - 0.25) / 0.6));
        var awake = hd && open > 0.35 ? 1 : 0;
        wake += (awake - wake) * (1 - Math.exp(-dt / 0.25));
        var target = awake ? open : 0;
        level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.06 : 0.18)));
        var restY = H - M * 0.08, tx = awake ? hd.center.x : W / 2, ty = awake ? H / 2 : restY;
        if (cx === null) { cx = W / 2; cy = restY; }
        var kf = 1 - Math.exp(-dt / 0.15);
        cx += (tx - cx) * kf; cy += (ty - cy) * kf;
        var szT = hd ? 0.4 + Math.max(0, Math.min(1, ((hd.pinchWith.index.distance || 0) - 0.15) / 1.0)) : 1;
        sz += (szT - sz) * kf;
        phase += dt * (1.5 + params.speed / 100 * 5) * (0.5 + level);

        // Dim the camera as it wakes.
        var dim = params.dim / 100 * (0.35 + 0.65 * wake);
        if (dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + dim.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }

        var s = smooth(wake), size = 0.45 + params.size / 100 * 0.55;
        {
          // Asleep: a calm, thin wave resting at the bottom. Awake: mid-height, under your hand from
          // side to side, as tall as your hand is open, scaled by the thumb–index spread.
          var half = W * (0.16 + (0.42 * size * sz - 0.16) * s);
          var big = M * 0.3 * params.height / 100 * size * sz, idle = M * 0.012 * (1 + 0.3 * Math.sin(t * 1.3));
          var amps = COLORS.map(function (c, k) {
            var breath = 0.55 + 0.45 * Math.sin(phase * (0.6 + k * 0.23) + k * 2.1);
            return idle * (1 - s) + big * (0.1 + 0.9 * level) * breath * s;
          });
          var drawWave = function (g) { wave(g, cx, cy, half, amps, 0.75, phase, 0); };
          haloOf(ctx, W, H, drawWave, 0.15 + 0.45 * params.glow / 100);
          wave(ctx, cx, cy, half, amps, 0.62, phase, Math.max(1, 1.1 * u));
        }

        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Open your hand to wake it; open it wider to make it louder. It follows your hand side to side; pinch and spread to shrink and grow it. A fist puts it to rest.');
      },
      reset: function () { lastT = null; wake = 0; level = 0; cx = null; sz = 1; }
    };
  };
})();
