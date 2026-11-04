// Tendrils: threads stream from your fingertips and curl through the air.
//
// Each fingertip releases particles in proportion to its speed (Count), launched with a third of the
// finger's velocity. A particle then follows a curl-noise flow: the curl of a stream function
// ψ(x, y, t) = Σ sin(k·x + ωt)·sin(k·y − ω′t) at two scales, u = (∂ψ/∂y, −∂ψ/∂x), which is
// divergence-free, so the flow swirls without sources or sinks (Curl sets its strength), with drag
// toward the flow, dv/dt = (u − v)/τ, τ = 0.35 s. Particles live 1.5–3 s.
// Each particle keeps its last 6–36 positions (Length) and is drawn as one thread through them,
// tapering from the head to a fine tail (width ∝ (1 − i/n)^1.3), fading in at birth and out at
// the end of its life.
// Modes: Silk, fine pale threads painted over the picture; Neon, colored tubes with a white-hot
// core, added like light, with a soft bloom (Glow).
// Pinch: particles are drawn toward the pinch point (an attraction of 2.5 frame heights/s²).
// Open a fist: a burst of 120 particles leaves the palm in a ring.
(function () {
  var TIPS = [4, 8, 12, 16, 20], MAX = 1200, TAU = 0.35, BINS = 4;

  function createTendrils() {
    var parts = [], prev = {}, wasFist = {}, lastT = null, lastIx = null;

    function flow(x, y, t, H, k) {
      var a1 = 4.3 / H, a2 = 9.7 / H;
      var s1 = Math.sin(a1 * x + t * 0.6), c1 = Math.cos(a1 * x + t * 0.6), s2 = Math.sin(a1 * y - t * 0.45), c2 = Math.cos(a1 * y - t * 0.45);
      var s3 = Math.sin(a2 * x - t * 1.1), c3 = Math.cos(a2 * x - t * 1.1), s4 = Math.sin(a2 * y + t * 0.9), c4 = Math.cos(a2 * y + t * 0.9);
      return [k * (s1 * c2 + 0.45 * s3 * c4), -k * (c1 * s2 + 0.45 * c3 * s4)];
    }

    function emit(x, y, vx, vy) {
      if (parts.length >= MAX) return;
      parts.push({ x: x, y: y, vx: vx, vy: vy, age: 0, life: 1.5 + Math.random() * 1.5, w: 0.7 + Math.random() * 0.6, h: [{ x: x, y: y }] });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 120, Math.min(1 / 30, t - lastT));
        lastT = t;
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), newFrame = ix !== lastIx;
        lastIx = ix;
        var neon = params.mode === 'neon', keep = Math.round(6 + params.length / 100 * 30);

        // Emission from moving fingertips (measured between camera frames).
        var seen = {}, pulls = [];
        ix.hands.forEach(function (hd) {
          var p = hd.points, last = prev[hd.id];
          seen[hd.id] = true;
          if (hd.pinched) pulls.push({ x: (p[4].x + p[8].x) / 2, y: (p[4].y + p[8].y) / 2 });
          if (newFrame && last) {
            var ft = Math.max(1e-3, ix.t - last.t);
            TIPS.forEach(function (ti) {
              var vx = (p[ti].x - last.p[ti].x) / ft, vy = (p[ti].y - last.p[ti].y) / ft, sp = Math.hypot(vx, vy) / H;
              var n = (params.count / 100) * 12 * Math.min(3, sp) * ft * 6, k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
              for (var j = 0; j < k; j++) emit(p[ti].x, p[ti].y, vx * 0.33, vy * 0.33);
            });
          }
          // Open a fist: a ring of particles bursts from the palm.
          if (wasFist[hd.id] && !hd.fist && hd.count >= 4) {
            for (var b = 0; b < 120; b++) { var a = b / 120 * Math.PI * 2, s = H * (0.4 + Math.random() * 0.5); emit(hd.center.x, hd.center.y, Math.cos(a) * s, Math.sin(a) * s); }
          }
          wasFist[hd.id] = hd.fist;
          if (newFrame || !last) prev[hd.id] = { t: ix.t, p: p.map(function (q) { return { x: q.x, y: q.y }; }) };
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k]) { delete prev[k]; delete wasFist[k]; } });

        // Motion: drag toward the curl-noise flow, plus pinch attraction; the path is remembered.
        var drag = 1 - Math.exp(-dt / TAU), strength = (params.curl / 100) * H * 0.9;
        parts = parts.filter(function (q) {
          q.age += dt;
          if (q.age >= q.life) return false;
          var f = flow(q.x, q.y, t, H, strength);
          q.vx += (f[0] - q.vx) * drag;
          q.vy += (f[1] - q.vy) * drag;
          pulls.forEach(function (pl) {
            var dx = pl.x - q.x, dy = pl.y - q.y, d = Math.hypot(dx, dy) || 1;
            q.vx += dx / d * H * 2.5 * dt; q.vy += dy / d * H * 2.5 * dt;
          });
          q.x += q.vx * dt; q.y += q.vy * dt;
          q.h.push({ x: q.x, y: q.y });
          while (q.h.length > keep) q.h.shift();
          return q.x > -W * 0.2 && q.x < W * 1.2 && q.y > -H * 0.2 && q.y < H * 1.2;
        });

        // Threads, batched: BINS bands along the thread (head to tail) × BINS levels of life fade,
        // one path each, so thousands of segments cost a few dozen strokes.
        var paths = [];
        for (var i = 0; i < BINS * BINS; i++) paths.push([]);
        parts.forEach(function (q) {
          var n = q.h.length;
          if (n < 2) return;
          var life = Math.min(1, q.age / 0.15, (q.life - q.age) / 0.6), lb = Math.min(BINS - 1, Math.floor(life * BINS));
          for (var j = n - 1; j > 0; j--) {
            var band = Math.min(BINS - 1, Math.floor((n - 1 - j) / (n - 1) * BINS));
            paths[band * BINS + lb].push(q.h[j], q.h[j - 1]);
          }
        });
        var base = params.color ? Magi.fx.inkColor(params.color) : (neon ? [0.25, 0.95, 1] : [0.85, 1, 0.95]);
        var silk = base.map(function (v) { return v + (1 - v) * 0.55; });
        var rgb = function (c) { return c.map(function (v) { return Math.round(v * 255); }).join(','); };
        var glow = params.glow / 100;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        function stroke(list, color, alpha, width) {
          if (!list.length || alpha <= 0) return;
          ctx.strokeStyle = 'rgba(' + color + ',' + alpha.toFixed(3) + ')';
          ctx.lineWidth = width;
          ctx.beginPath();
          for (var k = 0; k < list.length; k += 2) { ctx.moveTo(list[k].x, list[k].y); ctx.lineTo(list[k + 1].x, list[k + 1].y); }
          ctx.stroke();
        }
        for (var band = 0; band < BINS; band++) {
          var taper = Math.pow(1 - (band + 0.5) / BINS, 1.3);
          for (var lb = 0; lb < BINS; lb++) {
            var list = paths[band * BINS + lb], a = (lb + 1) / BINS;
            if (neon) {
              ctx.globalCompositeOperation = 'lighter';
              if (glow > 0) stroke(list, rgb(base), 0.12 * glow * a, (2 + 7 * taper) * u);
              stroke(list, rgb(base), 0.8 * a, (0.6 + 2.6 * taper) * u);
              stroke(list, '255,255,255', 0.7 * a * taper, Math.max(0.6, 0.9 * taper * u));
            } else {
              if (glow > 0) { ctx.globalCompositeOperation = 'lighter'; stroke(list, rgb(base), 0.08 * glow * a, (1.5 + 4 * taper) * u); }
              ctx.globalCompositeOperation = 'source-over';
              stroke(list, rgb(silk), 0.85 * a, Math.max(0.35, (0.25 + 1.4 * taper) * u));
            }
          }
        }
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and sweep your fingers.');
      },
      reset: function () { parts = []; prev = {}; wasFist = {}; lastT = null; lastIx = null; }
    };
  }

  Magi.renderers.tendrils = createTendrils;
})();
