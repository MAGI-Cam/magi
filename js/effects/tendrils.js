// Tendrils: glowing threads stream from your fingertips and curl through the air.
//
// Each fingertip releases particles in proportion to its speed (Count), launched with a third of the
// finger's velocity. A particle then follows a curl-noise flow: the curl of a stream function
// ψ(x, y, t) = Σ sin(k·x + ωt)·sin(k·y − ω′t) at two scales, u = (∂ψ/∂y, −∂ψ/∂x), which is
// divergence-free, so the flow swirls without sources or sinks (Curl sets its strength), with drag
// toward the flow, dv/dt = (u − v)/τ, τ = 0.35 s. Particles live 1.5–3 s. Their paths are drawn
// onto a trail layer that fades every frame by Length (trail half-life 0.1–1.6 s), so each particle
// leaves a tendril behind it, added like light over the camera (Glow).
// Pinch: particles are drawn toward the pinch point (an attraction of 2.5 frame heights/s²).
// Open a fist: a burst of 120 particles leaves the palm in a ring.
(function () {
  var TIPS = [4, 8, 12, 16, 20], MAX = 2500, TAU = 0.35;

  function createTendrils() {
    var parts = [], trail = document.createElement('canvas'), tctx = trail.getContext('2d');
    var prev = {}, wasFist = {}, lastT = null, lastIx = null;

    function flow(x, y, t, H, k) {
      var a1 = 4.3 / H, a2 = 9.7 / H;
      var s1 = Math.sin(a1 * x + t * 0.6), c1 = Math.cos(a1 * x + t * 0.6), s2 = Math.sin(a1 * y - t * 0.45), c2 = Math.cos(a1 * y - t * 0.45);
      var s3 = Math.sin(a2 * x - t * 1.1), c3 = Math.cos(a2 * x - t * 1.1), s4 = Math.sin(a2 * y + t * 0.9), c4 = Math.cos(a2 * y + t * 0.9);
      return [k * (s1 * c2 + 0.45 * s3 * c4), -k * (c1 * s2 + 0.45 * c3 * s4)];
    }

    function emit(x, y, vx, vy, H) {
      if (parts.length >= MAX) return;
      parts.push({ x: x, y: y, px: x, py: y, vx: vx, vy: vy, age: 0, life: 1.5 + Math.random() * 1.5, w: 0.6 + Math.random() * 0.9 });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        if (trail.width !== W || trail.height !== H) { trail.width = W; trail.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 120, Math.min(1 / 30, t - lastT));
        lastT = t;
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), newFrame = ix !== lastIx;
        lastIx = ix;

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
              var n = (params.count / 100) * 24 * Math.min(3, sp) * ft * 6, k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
              for (var j = 0; j < k; j++) emit(p[ti].x, p[ti].y, vx * 0.33, vy * 0.33, H);
            });
          }
          // Open a fist: a ring of particles bursts from the palm.
          if (wasFist[hd.id] && !hd.fist && hd.count >= 4) {
            for (var b = 0; b < 120; b++) { var a = b / 120 * Math.PI * 2, s = H * (0.4 + Math.random() * 0.5); emit(hd.center.x, hd.center.y, Math.cos(a) * s, Math.sin(a) * s, H); }
          }
          wasFist[hd.id] = hd.fist;
          if (newFrame || !last) prev[hd.id] = { t: ix.t, p: p.map(function (q) { return { x: q.x, y: q.y }; }) };
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k]) { delete prev[k]; delete wasFist[k]; } });

        // Motion: drag toward the curl-noise flow, plus pinch attraction.
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
          q.px = q.x; q.py = q.y;
          q.x += q.vx * dt; q.y += q.vy * dt;
          return q.x > -W * 0.2 && q.x < W * 1.2 && q.y > -H * 0.2 && q.y < H * 1.2;
        });

        // Trails: fade the layer, then draw this frame's steps.
        var half = 0.1 * Math.pow(16, params.length / 100);
        tctx.globalCompositeOperation = 'destination-out';
        tctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.pow(0.5, dt / half)).toFixed(4) + ')';
        tctx.fillRect(0, 0, W, H);
        tctx.globalCompositeOperation = 'source-over';
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.55, 1, 0.75];
        var rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        tctx.lineCap = 'round';
        [1, 0.6].forEach(function (pass) {
          tctx.lineWidth = Math.max(1, (pass === 1 ? 1.6 : 0.8) * u);
          tctx.strokeStyle = pass === 1 ? 'rgba(' + rgb + ',0.9)' : 'rgba(' + ink.map(function (v) { return Math.round(255 - (255 - v * 255) * 0.35); }).join(',') + ',0.8)';
          tctx.beginPath();
          parts.forEach(function (q) { tctx.moveTo(q.px, q.py); tctx.lineTo(q.x, q.y); });
          tctx.stroke();
        });

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var glow = params.glow / 100;
        if (glow > 0) {
          // Glow: the trail layer added again, offset a little in four directions.
          ctx.globalAlpha = 0.5 * glow;
          ctx.drawImage(trail, -1.5 * u, 0); ctx.drawImage(trail, 1.5 * u, 0);
          ctx.drawImage(trail, 0, -1.5 * u); ctx.drawImage(trail, 0, 1.5 * u);
        }
        // The tendrils themselves are painted over, so they keep their color on bright backgrounds.
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(trail, 0, 0);
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and sweep your fingers.');
      },
      reset: function () { parts = []; prev = {}; wasFist = {}; lastT = null; lastIx = null; tctx.clearRect(0, 0, trail.width, trail.height); }
    };
  }

  Magi.renderers.tendrils = createTendrils;
})();
