// Bubbles: moving fingers blow soap bubbles that drift off on the air.
//
// Each fingertip releases bubbles in proportion to its speed (Amount), launched with 35% of the
// finger's velocity. A bubble is light enough to follow the air: its velocity relaxes toward the
// local air velocity with Stokes drag, dv/dt = (u_air − v)/τ, τ = 0.5 s, plus a slow rise (Float).
// The air is curl noise (the curl of a stream function ψ, so it is divergence-free and swirls
// without sources or sinks, Wind), and moving hands drag the air near them. A bubble inflates over
// its first 0.2 s, lives 2–5 s and pops; with Pop on, touching one with a fingertip pops it.
(function () {
  var TIPS = [4, 8, 12, 16, 20], WRIST = 0, MIDDLE_MCP = 9, MAX = 700, TAU = 0.5;

  function createBubbles() {
    var bubbles = [], pops = [], prev = {}, lastT = null;

    function air(x, y, t, H, wind) {
      // ψ = sin(kx·x + ωt)·cos(ky·y − ω′t); u = (∂ψ/∂y, −∂ψ/∂x).
      var k1 = 5.1 / H, k2 = 2.3 / H, a = wind * H * 0.35;
      var s1 = Math.sin(k1 * x + t * 0.7), c1 = Math.cos(k1 * x + t * 0.7), s2 = Math.sin(k1 * y - t * 0.5), c2 = Math.cos(k1 * y - t * 0.5);
      var s3 = Math.sin(k2 * x - t * 0.3), c3 = Math.cos(k2 * x - t * 0.3), s4 = Math.sin(k2 * y + t * 0.4), c4 = Math.cos(k2 * y + t * 0.4);
      return [a * (-s1 * s2 - 0.8 * s3 * s4), -a * (c1 * c2 + 0.8 * c3 * c4)];
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var t = frame.time / 1000;
        var dt = lastT === null ? 1 / 30 : Math.max(1 / 120, Math.min(0.1, t - lastT));
        lastT = t;
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), details = tracker.details();
        var amount = params.amount / 100, size = (0.4 + params.size / 100 * 1.6) * H / 90;
        var wind = params.wind / 100, rise = params.float / 100 * H * 0.12;

        // Fingertip velocities; moving hands drag the air within a palm length of each tip.
        var movers = [], seen = {};
        hands.forEach(function (p, h) {
          var key = (details[h] && details[h].key) || 'hand' + h, last = prev[key];
          seen[key] = true;
          var palm = Math.hypot(p[MIDDLE_MCP].x - p[WRIST].x, p[MIDDLE_MCP].y - p[WRIST].y) || 1;
          TIPS.forEach(function (i) {
            var q = p[i], vx = 0, vy = 0;
            if (last) { vx = (q.x - last[i].x) / dt; vy = (q.y - last[i].y) / dt; }
            var cap = H * 4, sp = Math.hypot(vx, vy);
            if (sp > cap) { vx *= cap / sp; vy *= cap / sp; sp = cap; }
            movers.push({ x: q.x, y: q.y, vx: vx, vy: vy, r: palm * 0.6 });
            // Release ∝ speed in frame heights per second.
            var n = amount * 14 * (sp / H) * dt * 4, k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
            for (var j = 0; j < k && bubbles.length < MAX; j++) {
              bubbles.push({
                x: q.x + (Math.random() - 0.5) * palm * 0.2, y: q.y + (Math.random() - 0.5) * palm * 0.2,
                vx: vx * 0.35 + (Math.random() - 0.5) * H * 0.1, vy: vy * 0.35 + (Math.random() - 0.5) * H * 0.1,
                r: size * (0.35 + Math.pow(Math.random(), 2) * 1.3), age: 0, life: 2 + Math.random() * 3,
                phase: Math.random() * 6.28
              });
            }
          });
          prev[key] = p.map(function (q) { return { x: q.x, y: q.y }; });
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k]) delete prev[k]; });

        var drag = 1 - Math.exp(-dt / TAU), keep = [];
        bubbles.forEach(function (b) {
          b.age += dt;
          var a = air(b.x, b.y, t, H, wind), ax = a[0], ay = a[1] - rise;
          for (var m = 0; m < movers.length; m++) {
            var mv = movers[m], dx = b.x - mv.x, dy = b.y - mv.y, d2 = dx * dx + dy * dy, R2 = mv.r * mv.r;
            if (d2 < R2) {
              var f = 1 - d2 / R2;
              ax += (mv.vx - ax) * f * 0.6; ay += (mv.vy - ay) * f * 0.6;
              if (params.pop && b.age > 0.4 && d2 < b.r * b.r) b.age = b.life; // a fingertip touches it
            }
          }
          b.vx += (ax - b.vx) * drag;
          b.vy += (ay - b.vy) * drag;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          var off = b.x < -b.r * 3 || b.x > W + b.r * 3 || b.y < -b.r * 3 || b.y > H + b.r * 3;
          if (b.age >= b.life) pops.push({ x: b.x, y: b.y, r: b.r, age: 0 });
          else if (!off) keep.push(b);
        });
        bubbles = keep;

        // Bubbles: a thin rim and a highlight on the upper left; they inflate over 0.2 s.
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = Math.max(1, 1.2 * u);
        ctx.beginPath();
        bubbles.forEach(function (b) {
          var r = b.r * Math.min(1, b.age / 0.2) * (1 + 0.04 * Math.sin(t * 6 + b.phase));
          if (r < 0.5) return;
          ctx.moveTo(b.x + r, b.y);
          ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        });
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        bubbles.forEach(function (b) {
          var r = b.r * Math.min(1, b.age / 0.2) * 0.62;
          if (r < 2) return;
          ctx.moveTo(b.x + Math.cos(3.6) * r, b.y + Math.sin(3.6) * r);
          ctx.arc(b.x, b.y, r, 3.6, 4.5);
        });
        ctx.stroke();

        // Pops: a ring of short dashes flying out for 0.15 s.
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        pops = pops.filter(function (p) {
          p.age += dt;
          if (p.age > 0.15) return false;
          var k = p.age / 0.15, r0 = p.r * (1 + k * 0.6), r1 = r0 + p.r * 0.35 * (1 - k);
          for (var i = 0; i < 7; i++) {
            var a = i / 7 * Math.PI * 2;
            ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
            ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
          }
          return true;
        });
        ctx.stroke();

        var C = Magi.tracking.connections;
        if (params.skeleton && C) {
          hands.forEach(function (p) {
            ctx.strokeStyle = 'rgb(80,230,90)';
            ctx.lineWidth = Math.max(1, 2 * u);
            ctx.beginPath();
            C.hand.forEach(function (c) { ctx.moveTo(p[c.start].x, p[c.start].y); ctx.lineTo(p[c.end].x, p[c.end].y); });
            ctx.stroke();
            ctx.fillStyle = 'rgb(240,60,40)';
            p.forEach(function (q) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, 3 * u), 0, Math.PI * 2); ctx.fill(); });
          });
        }
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and wave your fingers.');
      },
      reset: function () { bubbles = []; pops = []; prev = {}; lastT = null; }
    };
  }

  Magi.renderers.bubbles = createBubbles;
})();
