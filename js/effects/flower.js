// Flower: flower heads made of digit particles, with red markers at their tips, joined by red
// stems, planted with a pinch (after a reference of digit blossoms on black).
//
// A head is a dome of fronds. Frond k points at azimuth φ = k·137.508° (Vogel's phyllotaxis, the
// golden angle, so no two fronds line up) and tilts out of the view axis by 45°–90°, so the head
// reads as a starburst with depth. Each frond is a short branching chain from an L-system,
// F → F[+F][−F], two levels: a main stem with two side branches at 45% and 70% of its length,
// turned ±28° and 40% as long. Particles (Density per frond) sit along the chain, each a digit
// 0–9; a red + marks every tip. The core glows white.
// Every head is a damped spring toward its home (1.2 Hz) and leans away from a hand that comes
// near (a push falling to zero at 3 palm lengths). Its openness (bloom) is another spring: open
// palm near it, 1.25 × Bloom; fist near it, nearly shut (fronds folded into the core); let go and
// it bursts open, overshooting (ζ = 0.35). Each head turns slowly about its own axis.
// Stems are Verlet ropes (Jakobsen 2001), 9 points, pinned at both heads, with a little gravity
// and 6% slack, so they sag and sway as heads move; drawn as one smooth red curve.
// Gestures:
//   Pinch: plants a new head at the pinch, joined by a stem to the nearest head (up to Heads; the
//     oldest falls away).
//   Open palm near a head: it blooms. Fist near a head: it closes; open again: it bursts open.
//   Move your hand through them: heads lean away and the stems swing.
//   Flick: the nearest head's digits blow away as seeds on a swirling wind and fade, and the head
//     regrows (Seeds on).
//   Two hands: a head rides each palm, joined by a stem; pull them apart and new heads sprout along
//     it (one each time the gap grows by a fifth of the picture's width).
//   No hand: one head sways and slowly sprouts others (up to three).
(function () {
  var GOLDEN = 137.508 * Math.PI / 180;

  // One head's particles in its own unit space: [x, y, z, digit, isTip].
  function headShape(fronds, density) {
    var P = [];
    for (var k = 0; k < fronds; k++) {
      var phi = k * GOLDEN, tilt = (45 + 45 * ((k * 0.618) % 1)) * Math.PI / 180, len = 0.7 + 0.3 * ((k * 0.37) % 1);
      var dir = [Math.sin(tilt) * Math.cos(phi), Math.sin(tilt) * Math.sin(phi), Math.cos(tilt)];
      // A perpendicular in the frond's plane, for its side branches.
      var side = [-Math.sin(phi), Math.cos(phi), 0];
      var seg = function (o, d, L, cnt) {
        for (var i = 1; i <= cnt; i++) { var f = i / cnt; P.push([o[0] + d[0] * L * f, o[1] + d[1] * L * f, o[2] + d[2] * L * f, Math.floor(Math.random() * 10), i === cnt]); }
      };
      seg([0, 0, 0], dir, len, density);
      [[0.45, 1], [0.7, -1]].forEach(function (b) {
        var o = [dir[0] * len * b[0], dir[1] * len * b[0], dir[2] * len * b[0]], a = 28 * Math.PI / 180 * b[1];
        var d = [dir[0] * Math.cos(a) + side[0] * Math.sin(a), dir[1] * Math.cos(a) + side[1] * Math.sin(a), dir[2] * Math.cos(a) + side[2] * Math.sin(a)];
        seg(o, d, len * 0.4, Math.max(2, Math.round(density * 0.4)));
      });
    }
    return P;
  }

  function createFlower() {
    var heads = [], stems = [], shapeKey = '', shape = [], lastT = null, seen = 0, seeds = [], wasPinched = {}, lastSprout = 0, handHeads = null, gap0 = 0, atlas = null, atlasPx = 0, nextId = 1;
    function sprites(px) {
      if (atlas && atlasPx === px) return atlas;
      atlasPx = px; atlas = [];
      for (var d = 0; d < 10; d++) {
        var c = document.createElement('canvas'); c.width = Math.ceil(px * 0.7); c.height = Math.ceil(px * 1.1);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '400 ' + px + 'px ' + Magi.fx.MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(d), c.width / 2, c.height / 2); atlas.push(c);
      }
      return atlas;
    }
    function addHead(x, y, from, max) {
      var h = { id: nextId++, x: x, y: y, hx: x, hy: y, vx: 0, vy: 0, b: 0, bv: 0, spin: Math.random() * 6.28, born: lastT || 0 };
      heads.push(h);
      if (from) {
        var pts = [];
        for (var i = 0; i <= 8; i++) { var f = i / 8, px = from.x + (x - from.x) * f, py = from.y + (y - from.y) * f; pts.push({ x: px, y: py, px: px, py: py }); }
        stems.push({ a: from, b: h, pts: pts });
      }
      while (heads.length > max) {
        var old = heads.shift();
        stems = stems.filter(function (s) { return s.a !== old && s.b !== old; });
      }
      return h;
    }
    function nearest(x, y, list) { var best = null, bd = 1e9; (list || heads).forEach(function (h) { var d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }); return best; }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 240, Math.min(1 / 30, t - lastT));
        lastT = t;
        var key = params.petals + ':' + params.density;
        if (key !== shapeKey) { shapeKey = key; shape = headShape(Math.round(params.petals), Math.round(params.density)); }
        var maxHeads = Math.round(params.heads);
        if (!heads.length) addHead(W / 2, H / 2, null, maxHeads);

        var ix = Magi.interaction.read(frame), hands = ix.hands, R = Math.min(W, H) * 0.16 * (0.4 + params.size / 100 * 1.2);
        // Pinch: plant a head.
        hands.forEach(function (h) {
          if (h.pinched && !wasPinched[h.id]) {
            var pm = { x: (h.points[4].x + h.points[8].x) / 2, y: (h.points[4].y + h.points[8].y) / 2 };
            addHead(pm.x, pm.y, nearest(pm.x, pm.y), maxHeads);
          }
          wasPinched[h.id] = h.pinched;
        });
        // Two hands: heads on both palms, joined, sprouting along the stem as they part.
        if (hands.length >= 2) {
          if (!handHeads) {
            var a = addHead(hands[0].center.x, hands[0].center.y, null, maxHeads + 2), b = addHead(hands[1].center.x, hands[1].center.y, a, maxHeads + 2);
            handHeads = [a, b]; gap0 = Math.hypot(a.x - b.x, a.y - b.y);
          }
          handHeads[0].hx = hands[0].center.x; handHeads[0].hy = hands[0].center.y;
          handHeads[1].hx = hands[1].center.x; handHeads[1].hy = hands[1].center.y;
          var gap = Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y);
          if (gap - gap0 > W * 0.2) { gap0 = gap; addHead((hands[0].center.x + hands[1].center.x) / 2, (hands[0].center.y + hands[1].center.y) / 2 - H * 0.08, handHeads[0], maxHeads + 2); }
          if (gap < gap0) gap0 = gap;
        } else if (handHeads) {
          // The palm heads stay where they were left.
          handHeads = null;
        }
        // Idle: sprout up to three heads.
        if (!hands.length && heads.length < 3 && t - lastSprout > 6) {
          lastSprout = t;
          var from = heads[heads.length - 1], ang = Math.random() * Math.PI * 2;
          addHead(Math.max(R, Math.min(W - R, from.x + Math.cos(ang) * R * 2.2)), Math.max(R, Math.min(H - R, from.y + Math.sin(ang) * R * 2.2)), from, maxHeads);
        }
        if (hands.length) lastSprout = t;
        // Flick: seeds.
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type !== 'flick' || !params.seeds) return;
          var fh = hands.filter(function (h) { return h.id === e.hand; })[0] || hands[0];
          if (!fh) return;
          var hh = nearest(fh.center.x, fh.center.y);
          if (!hh) return;
          shape.forEach(function (q, i) {
            if (i % 2) return;
            var c = Math.cos(hh.spin), s = Math.sin(hh.spin), x = q[0] * c - q[1] * s, y = q[0] * s + q[1] * c, rr = R * hh.b;
            seeds.push({ x: hh.x + x * rr, y: hh.y + y * rr, vx: fh.velocity.x * 0.3 + (Math.random() - 0.5) * H * 0.2, vy: fh.velocity.y * 0.3 - H * 0.1 - Math.random() * H * 0.1, d: q[3], born: t });
          });
          hh.b = 0; hh.bv = 0;
          if (seeds.length > 3000) seeds.splice(0, seeds.length - 3000);
        });

        // Heads: springs home, lean from hands, bloom.
        var sway = params.sway / 100, bloomMax = 0.4 + params.bloom / 100 * 0.85;
        heads.forEach(function (h) {
          var w = 2 * Math.PI * 1.2, ax = w * w * (h.hx - h.x) - 2 * 0.6 * w * h.vx, ay = w * w * (h.hy - h.y) - 2 * 0.6 * w * h.vy;
          var want = bloomMax, near = null, nd = 1e9;
          hands.forEach(function (hd) {
            var dx = h.x - hd.center.x, dy = h.y - hd.center.y, d = Math.hypot(dx, dy) || 1, R0 = hd.size * 3;
            if (handHeads && (h === handHeads[0] || h === handHeads[1])) return;
            if (d < R0) { var f = (1 - d / R0) * H * 30 * sway; ax += dx / d * f; ay += dy / d * f; }
            if (d < nd) { nd = d; near = hd; }
          });
          if (near && nd < near.size * 3.5) { if (near.fist) want = 0.08; else if (near.count >= 5) want = bloomMax * 1.25; }
          h.vx += ax * dt; h.vy += ay * dt; h.x += h.vx * dt; h.y += h.vy * dt;
          var wb = 2 * Math.PI * 1.1; h.bv += (-wb * wb * (h.b - want) - 2 * 0.35 * wb * h.bv) * dt; h.b += h.bv * dt;
          h.spin += dt * 0.15;
          // Idle sway.
          if (!hands.length) { h.x += Math.sin(t * 0.7 + h.id) * 0.15 * sway * u; h.y += Math.cos(t * 0.5 + h.id) * 0.1 * sway * u; }
        });
        // Stems: Verlet ropes pinned to their heads.
        stems.forEach(function (s) {
          var n = s.pts.length - 1, span = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), rest = span * 1.06 / n, g = H * 0.4;
          s.pts.forEach(function (q, i) {
            if (i === 0 || i === n) return;
            var vx = (q.x - q.px) * 0.98, vy = (q.y - q.py) * 0.98; q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + g * dt * dt;
          });
          for (var it = 0; it < 6; it++) {
            s.pts[0].x = s.a.x; s.pts[0].y = s.a.y; s.pts[n].x = s.b.x; s.pts[n].y = s.b.y;
            for (var i = 0; i < n; i++) {
              var p = s.pts[i], q = s.pts[i + 1], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-6, diff = (d - rest) / d;
              var wa = i === 0 ? 0 : (i + 1 === n ? 1 : 0.5), wb2 = i + 1 === n ? 0 : (i === 0 ? 1 : 0.5);
              p.x += dx * diff * wa; p.y += dy * diff * wa; q.x -= dx * diff * wb2; q.y -= dy * diff * wb2;
            }
          }
        });

        var red = params.color ? Magi.fx.inkColor(params.color).map(function (v) { return Math.round(v * 255); }).join(',') : '255,59,47';
        // Stems.
        ctx.save();
        ctx.strokeStyle = 'rgba(' + red + ',0.85)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.lineJoin = 'round';
        ctx.beginPath();
        stems.forEach(function (s) {
          var P = s.pts, n = P.length - 1;
          ctx.moveTo(P[0].x, P[0].y);
          for (var i = 1; i < n; i++) ctx.quadraticCurveTo(P[i].x, P[i].y, (P[i].x + P[i + 1].x) / 2, (P[i].y + P[i + 1].y) / 2);
          ctx.lineTo(P[n].x, P[n].y);
        });
        ctx.stroke();
        ctx.restore();
        // Heads: digits on the HUD (sharp), tips as red +, cores glowing.
        var px = Math.max(6, Math.round(7 * u * (0.6 + params.size / 100 * 0.8))), spr = sprites(px), F = 3, tips = [];
        hud.save();
        heads.forEach(function (h) {
          var c = Math.cos(h.spin), s = Math.sin(h.spin), rr = R * Math.max(0, h.b);
          shape.forEach(function (q) {
            var x = q[0] * c - q[1] * s, y = q[0] * s + q[1] * c, k = F / (F - q[2] * 0.8), X = h.x + x * rr * k, Y = h.y + y * rr * k;
            if (q[4]) { tips.push(X, Y); return; }
            var sp = spr[q[3]], w2 = sp.width * 0.8, h2 = sp.height * 0.8;
            hud.globalAlpha = 0.55 + 0.45 * q[2];
            hud.drawImage(sp, X - w2 / 2, Y - h2 / 2, w2, h2);
          });
        });
        // Seeds drifting on a swirling wind (curl of ψ = sin(kx + t)·cos(ky − t)), fading over 3 s.
        var kk = 2 * Math.PI / (H * 0.6);
        seeds = seeds.filter(function (sd) {
          var age = t - sd.born; if (age > 3) return false;
          var vx = -Math.sin(kk * sd.x + t) * Math.sin(kk * sd.y - t) * H * 0.15, vy = -Math.cos(kk * sd.x + t) * Math.cos(kk * sd.y - t) * H * 0.15;
          sd.vx += (vx - sd.vx) * dt * 1.5; sd.vy += (vy - H * 0.05 - sd.vy) * dt * 1.5;
          sd.x += sd.vx * dt; sd.y += sd.vy * dt;
          var sp = spr[sd.d]; hud.globalAlpha = 1 - age / 3; hud.drawImage(sp, sd.x - sp.width * 0.4, sd.y - sp.height * 0.4, sp.width * 0.8, sp.height * 0.8);
          return true;
        });
        hud.globalAlpha = 1;
        hud.restore();
        ctx.save();
        ctx.strokeStyle = 'rgb(' + red + ')'; ctx.lineWidth = Math.max(1, 1.1 * u);
        var pl = 3 * u;
        ctx.beginPath();
        for (var i = 0; i < tips.length; i += 2) { ctx.moveTo(tips[i] - pl, tips[i + 1]); ctx.lineTo(tips[i] + pl, tips[i + 1]); ctx.moveTo(tips[i], tips[i + 1] - pl); ctx.lineTo(tips[i], tips[i + 1] + pl); }
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        heads.forEach(function (h) {
          var cr = R * 0.18 * (0.5 + 0.5 * Math.max(0, h.b)), g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, cr);
          g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,235,230,0.45)'); g.addColorStop(1, 'rgba(255,200,190,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, cr, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Pinch to plant a flower. Open your hand near one to bloom it, a fist to close it, flick to blow its seeds.');
      },
      reset: function () { heads = []; stems = []; seeds = []; lastT = null; wasPinched = {}; handHeads = null; }
    };
  }

  Magi.renderers.flower = createFlower;
})();
