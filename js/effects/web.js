// Web: a digital spiderweb strung between your fingers, built from the same lines Landmarks
// measures: fingertip to fingertip on each hand, matching fingertips across both hands, the palm to
// each fingertip, and the thumb–index pinch line.
//
// Threads are ropes simulated with Verlet integration (Jakobsen, "Advanced Character Physics",
// 2001): each rope is 10 points whose positions carry their own velocity (x − x_prev), pulled down
// by gravity (Sag) and damped, then held to their rest length by distance constraints solved 6
// times a frame. Rope ends are pinned to landmarks, so moving your hands swings and stretches the
// web. Like an orb web, rings connect neighboring radial threads (or neighboring finger-pair threads
// between two hands) at fixed fractions along them (Rings), attached to the ropes' own points so
// they sway together. A pinched hand draws its thumb–index thread taut and bright; letting go of a
// pinch plucks the web (every thread point gets a small random kick). Particles run along every
// thread, a fixed number per thread moving at a steady speed, so the web glows with traffic.
(function () {
  var TIPS = [4, 8, 12, 16, 20], PALM = [0, 5, 9, 13, 17], SEG = 10, ITER = 6;

  function center(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x / 5; y += p[i].y / 5; });
    return { x: x, y: y };
  }

  function createWeb() {
    var ropes = [], topology = '', lastT = null, wasPinched = {}, phases = [];

    // A rope between two anchors. An anchor is a landmark ({ hand, idx }), a palm center
    // ({ hand, center: true }) or a point on another rope ({ rope, k }).
    function rope(a, b, at, bt, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var x = at.x + (bt.x - at.x) * i / n, y = at.y + (bt.y - at.y) * i / n;
        pts.push({ x: x, y: y, px: x, py: y });
      }
      return { a: a, b: b, pts: pts, rest: 0, kind: 'thread' };
    }

    function anchorPos(an, hands, cs) {
      if (an.rope !== undefined) { var q = ropes[an.rope].pts[an.k]; return { x: q.x, y: q.y }; }
      if (an.center) return cs[an.hand];
      return hands[an.hand][an.idx];
    }

    // Builds the web for the hands in view: radials and rings per hand, finger threads, pairs and
    // their rings between two hands, and a pinch thread per hand.
    function build(hands, params) {
      ropes = [];
      var cs = hands.map(center), rings = Math.round(params.rings), fr = [];
      for (var r = 0; r < rings; r++) fr.push(0.3 + 0.6 * (r + 1) / (rings + 1));
      function add(a, b, n, kind) {
        var R = rope(a, b, anchorPos(a, hands, cs), anchorPos(b, hands, cs), n || SEG);
        R.kind = kind || 'thread';
        ropes.push(R);
        return ropes.length - 1;
      }
      hands.forEach(function (p, h) {
        var radial = TIPS.map(function (t) { return add({ hand: h, center: true }, { hand: h, idx: t }, SEG, 'radial'); });
        for (var k = 0; k < 4; k++) add({ hand: h, idx: TIPS[k] }, { hand: h, idx: TIPS[k + 1] }, SEG, 'finger');
        fr.forEach(function (f) {
          var at = Math.round(f * SEG);
          for (var k2 = 0; k2 < 4; k2++) add({ rope: radial[k2], k: at }, { rope: radial[k2 + 1], k: at }, 6, 'ring');
        });
        add({ hand: h, idx: 4 }, { hand: h, idx: 8 }, 6, 'pinch');
      });
      if (hands.length === 2) {
        var pairs = TIPS.map(function (t) { return add({ hand: 0, idx: t }, { hand: 1, idx: t }, SEG + 4, 'pair'); });
        fr.forEach(function (f) {
          var at = Math.round(f * (SEG + 4));
          for (var k3 = 0; k3 < 4; k3++) add({ rope: pairs[k3], k: at }, { rope: pairs[k3 + 1], k: at }, 6, 'ring');
        });
      }
      ropes.forEach(function (R) {
        var a = R.pts[0], b = R.pts[R.pts.length - 1];
        R.rest = Math.hypot(b.x - a.x, b.y - a.y) / (R.pts.length - 1);
      });
      phases = ropes.map(function () {
        var ph = [];
        for (var i = 0; i < 3; i++) ph.push(Math.random());
        return ph;
      });
    }

    function step(hands, params, dt, H, pinched) {
      var cs = hands.map(center), g = (params.sag / 100) * H * 2.2, damp = 0.985;
      ropes.forEach(function (R) {
        // Rest length follows the anchors' distance with 4% slack, so threads hang a little.
        var a0 = anchorPos(R.a, hands, cs), b0 = anchorPos(R.b, hands, cs), n = R.pts.length - 1;
        var taut = R.kind === 'pinch' && pinched[R.a.hand];
        R.rest = Math.hypot(b0.x - a0.x, b0.y - a0.y) / n * (taut ? 1 : 1.04);
        for (var i = 1; i < n; i++) {
          var q = R.pts[i], vx = (q.x - q.px) * damp, vy = (q.y - q.py) * damp;
          q.px = q.x; q.py = q.y;
          q.x += vx; q.y += vy + (taut ? 0 : g * dt * dt);
        }
      });
      for (var it = 0; it < ITER; it++) {
        ropes.forEach(function (R) {
          var n = R.pts.length - 1, a0 = anchorPos(R.a, hands, cs), b0 = anchorPos(R.b, hands, cs);
          R.pts[0].x = a0.x; R.pts[0].y = a0.y; R.pts[n].x = b0.x; R.pts[n].y = b0.y;
          for (var i = 0; i < n; i++) {
            var p = R.pts[i], q = R.pts[i + 1], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-6;
            var diff = (d - R.rest) / d * 0.5, fixA = i === 0, fixB = i + 1 === n;
            if (fixA && fixB) continue;
            var wa = fixA ? 0 : fixB ? 1 : 0.5, wb = fixB ? 0 : fixA ? 1 : 0.5;
            p.x += dx * diff * 2 * wa; p.y += dy * diff * 2 * wa;
            q.x -= dx * diff * 2 * wb; q.y -= dy * diff * 2 * wb;
          }
        });
      }
    }

    // A point at fraction f along a rope's polyline.
    function along(R, f) {
      var n = R.pts.length - 1, x = f * n, i = Math.min(n - 1, Math.floor(x)), k = x - i, a = R.pts[i], b = R.pts[i + 1];
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
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
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame);
        var hands = ix.hands.map(function (h) { return h.points; });
        var key = ix.hands.map(function (h) { return h.id; }).join('|') + ':' + params.rings;
        if (key !== topology) { topology = key; if (hands.length) build(hands, params); else ropes = []; }

        // Letting go of a pinch plucks the web.
        var pinched = {};
        ix.hands.forEach(function (h, i) {
          pinched[i] = h.pinched;
          if (wasPinched[h.id] && !h.pinched) {
            ropes.forEach(function (R) {
              for (var k = 1; k < R.pts.length - 1; k++) { R.pts[k].px -= (Math.random() - 0.5) * H * 0.02; R.pts[k].py -= (Math.random() - 0.5) * H * 0.02; }
            });
          }
          wasPinched[h.id] = h.pinched;
        });
        if (hands.length) step(hands, params, dt, H, pinched);

        var strings = params.mode === 'strings';
        // Strings default to violet; Color picks another hue.
        var ink = strings && !params.color ? [0.62, 0.42, 1] : Magi.fx.inkColor(params.color), rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var glow = params.glow / 100;
        if (strings) {
          // Strings (after "String Spiders"): each thread is a strand of glowing beads, added like
          // light, with soft pulsing hubs at the fingertips and palms where threads meet.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          var gap = Math.max(2, 3 * u), bead = Math.max(1, 1.3 * u);
          ctx.fillStyle = 'rgba(' + rgb + ',0.55)';
          ctx.beginPath();
          ropes.forEach(function (R) {
            if (R.kind === 'pinch' && !pinched[R.a.hand]) return;
            for (var i = 0; i < R.pts.length - 1; i++) {
              var a = R.pts[i], b = R.pts[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.floor(d / gap));
              for (var k = 0; k < m; k++) { var x = a.x + (b.x - a.x) * k / m, y = a.y + (b.y - a.y) * k / m; ctx.moveTo(x + bead, y); ctx.arc(x, y, bead, 0, Math.PI * 2); }
            }
          });
          ctx.fill();
          hands.forEach(function (p) {
            TIPS.concat([0]).forEach(function (ti, j) {
              var q = ti === 0 ? center(p) : p[ti], r = (ti === 0 ? 0.35 : 0.18) * Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y) * (0.85 + 0.15 * Math.sin(t * 3 + j)) * (0.5 + glow);
              var g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
              g.addColorStop(0, 'rgba(255,255,255,0.9)');
              g.addColorStop(0.25, 'rgba(' + rgb + ',0.7)');
              g.addColorStop(1, 'rgba(' + rgb + ',0)');
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
            });
          });
          ctx.restore();
        }
        ctx.save();
        if (strings) ctx.globalAlpha = 0.25;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        // Threads: a faint wide stroke for glow under a fine bright one.
        function trace(filter) {
          ctx.beginPath();
          ropes.forEach(function (R) {
            if (!filter(R)) return;
            R.pts.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
          });
        }
        trace(function (R) { return R.kind !== 'pinch' || pinched[R.a.hand]; });
        if (glow > 0) {
          ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.12 * glow) + ')';
          ctx.lineWidth = Math.max(2, 5 * u);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(' + rgb + ',0.75)';
        ctx.lineWidth = Math.max(1, 0.9 * u);
        ctx.stroke();
        // Pinch threads, taut and bright.
        trace(function (R) { return R.kind === 'pinch' && pinched[R.a.hand]; });
        ctx.strokeStyle = 'rgba(' + rgb + ',1)';
        ctx.lineWidth = Math.max(1, 1.8 * u);
        ctx.stroke();

        // Particles running along the threads.
        var per = Math.round(params.particles / 100 * 3), speed = 0.25 + params.particles / 100 * 0.35, dot = Math.max(1.2, 1.8 * u);
        if (per > 0) {
          ctx.fillStyle = 'rgba(' + rgb + ',1)';
          ctx.shadowColor = 'rgba(' + rgb + ',' + glow + ')';
          ctx.shadowBlur = 6 * u * glow;
          ctx.beginPath();
          ropes.forEach(function (R, ri) {
            if (R.kind === 'pinch' && !pinched[R.a.hand]) return;
            for (var k = 0; k < per; k++) {
              var f = (phases[ri][k] + t * speed * (ri % 2 ? 1 : -1)) % 1;
              if (f < 0) f += 1;
              var q = along(R, f);
              ctx.moveTo(q.x + dot, q.y);
              ctx.arc(q.x, q.y, dot, 0, Math.PI * 2);
            }
          });
          ctx.fill();
        }
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise your hands and spread your fingers.');
      },
      reset: function () { ropes = []; topology = ''; lastT = null; wasPinched = {}; }
    };
  }

  Magi.renderers.web = createWeb;
})();
