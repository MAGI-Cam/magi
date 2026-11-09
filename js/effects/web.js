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
// pinch plucks the web (every thread point gets a small random kick).
// Flick: the web lets go of your fingers. Its pins are released, it is thrown along the flick and
// floats up (buoyancy, with air drag), keeping its shape through the same constraints, and fades
// over 4 s while a new web forms on your hands.
// Throw (thwip): make the web-shooter sign (index and pinky out, middle and ring folded onto the
// palm) and flick or thrust the hand: a web line shoots from your palm the way your index finger
// points, sticks where it meets the edge of the frame with a small splat web, and holds between
// your hand and that point (see newShot). Up to five lines; a sixth snaps the oldest back.
// Particles flow along every thread in one direction (outward from the palm, along the fingers,
// left hand to right) at a steady speed measured along the curve, so they don't speed up on long
// threads, spaced by the thread's length, fading in and out at the ends.
(function () {
  var TIPS = [4, 8, 12, 16, 20], PALM = [0, 5, 9, 13, 17], SEG = 10, ITER = 6, FLY_LIFE = 4, MAX_FLYING = 4, MAX_SHOTS = 5;

  function center(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x / 5; y += p[i].y / 5; });
    return { x: x, y: y };
  }

  // Integrate and constrain a set of ropes. pos(anchor) gives a pinned end's position, or null
  // for a free end. g: gravity in px/s² (negative floats up); damp: velocity kept per step.
  function simulate(set, pos, g, damp, dt, tautOf) {
    set.forEach(function (R) {
      var n = R.pts.length - 1, a0 = pos(R.a), b0 = pos(R.b), taut = tautOf && tautOf(R);
      if (a0 && b0 && !R.fixedRest) R.rest = Math.hypot(b0.x - a0.x, b0.y - a0.y) / n * (taut ? 1 : 1.04);
      for (var i = 0; i <= n; i++) {
        if ((i === 0 && a0) || (i === n && b0)) continue;
        var q = R.pts[i], vx = (q.x - q.px) * damp, vy = (q.y - q.py) * damp;
        q.px = q.x; q.py = q.y;
        q.x += vx; q.y += vy + (taut ? 0 : g * dt * dt);
      }
    });
    for (var it = 0; it < ITER; it++) {
      set.forEach(function (R) {
        var n = R.pts.length - 1, a0 = pos(R.a), b0 = pos(R.b);
        if (a0) { R.pts[0].x = a0.x; R.pts[0].y = a0.y; }
        if (b0) { R.pts[n].x = b0.x; R.pts[n].y = b0.y; }
        for (var i = 0; i < n; i++) {
          var p = R.pts[i], q = R.pts[i + 1], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-6;
          var diff = (d - R.rest) / d, fixA = i === 0 && !!a0, fixB = i + 1 === n && !!b0;
          if (fixA && fixB) continue;
          var wa = fixA ? 0 : fixB ? 1 : 0.5, wb = fixB ? 0 : fixA ? 1 : 0.5;
          p.x += dx * diff * wa; p.y += dy * diff * wa;
          q.x -= dx * diff * wb; q.y -= dy * diff * wb;
        }
      });
    }
  }

  // A smooth curve through a rope's points: quadratic segments between midpoints.
  function curve(ctx, pts) {
    var n = pts.length - 1;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < n; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    ctx.lineTo(pts[n].x, pts[n].y);
  }

  function createWeb() {
    var ropes = [], topology = '', lastT = null, wasPinched = {}, flows = [], flying = [], seen = 0, bornAt = 0, shots = [], lastThrow = {};

    // A web line: a 16-point rope from the palm to a projectile. The projectile flies with a little
    // gravity (0.6 frame heights/s²); the rope is pinned at both ends and kept at its length. At the
    // frame's edge it sticks: the rope's rest length is set to 92% of the span, so it pulls taut and
    // twangs as your hand moves. Pulled past 1.7× that span it snaps: the far end lets go and the
    // line whips back to your palm (its rest length shrinking to nothing in 0.25 s). If your hand
    // leaves for over a second, the near end lets go and the line hangs from where it stuck,
    // swinging, then fades after 3 s.
    var SEG_SHOT = 16;
    function newShot(hand, c, vx, vy, t) {
      var pts = [];
      for (var i = 0; i <= SEG_SHOT; i++) pts.push({ x: c.x, y: c.y, px: c.x, py: c.y });
      return { hand: hand, state: 'flying', p: { x: c.x, y: c.y, vx: vx, vy: vy }, born: t, anchor: null, span: 0, lost: 0, alpha: 1, splat: 0, inward: 0,
        rope: { a: { end: 'hand' }, b: { end: 'tip' }, pts: pts, rest: 1, fixedRest: true, kind: 'shot' } };
    }
    function stepShot(S, palm, dt, t, W, H) {
      var R = S.rope, n = SEG_SHOT;
      if (palm) S.lastPalm = palm; else S.lost += dt;
      var hp = palm || S.lastPalm;
      if (S.state === 'flying') {
        S.p.vy += H * 0.6 * dt; S.p.x += S.p.vx * dt; S.p.y += S.p.vy * dt;
        var out = S.p.x < 0 || S.p.x > W || S.p.y < 0 || S.p.y > H;
        if (out || t - S.born > 1.2) {
          S.anchor = { x: Math.max(0, Math.min(W, S.p.x)), y: Math.max(0, Math.min(H, S.p.y)) };
          S.inward = Math.atan2(hp.y - S.anchor.y, hp.x - S.anchor.x);
          S.span = Math.hypot(S.anchor.x - hp.x, S.anchor.y - hp.y); S.state = 'stuck'; S.stuckAt = t;
        }
        R.rest = Math.hypot(S.p.x - hp.x, S.p.y - hp.y) / n;
      }
      if (S.state === 'stuck') {
        S.splat = Math.min(1, (t - S.stuckAt) / 0.12);
        R.rest = S.span * 0.92 / n;
        if (Math.hypot(S.anchor.x - hp.x, S.anchor.y - hp.y) > S.span * 1.7) { S.state = 'snap'; S.snapAt = t; }
        else if (S.lost > 1) { S.state = 'hang'; S.hangAt = t; }
      }
      if (S.state === 'snap') {
        if (!S.snapAt) S.snapAt = t;
        var k = Math.max(0, 1 - (t - S.snapAt) / 0.25);
        R.rest = Math.max(0.5, R.rest * k);
        S.alpha = k; S.splat = k;
        if (k <= 0) return false;
      }
      if (S.state === 'hang') { S.alpha = Math.max(0, 1 - (t - S.hangAt) / 3); if (S.alpha <= 0) return false; }
      var pos = function (an) {
        if (an.end === 'hand') return S.state === 'hang' ? null : hp;
        if (S.state === 'flying') return S.p;
        if (S.state === 'snap') return null;
        return S.anchor;
      };
      simulate([R], pos, H * 1.2, 0.97, dt);
      return true;
    }

    function rope(a, b, at, bt, n, kind) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var x = at.x + (bt.x - at.x) * i / n, y = at.y + (bt.y - at.y) * i / n;
        pts.push({ x: x, y: y, px: x, py: y });
      }
      return { a: a, b: b, pts: pts, rest: 0, kind: kind };
    }

    // An anchor is a landmark ({ hand, idx }), a palm center ({ hand, center: true }) or a point on
    // another rope of the same web ({ rope, k }).
    function anchorOn(set, hands, cs) {
      return function (an) {
        if (an.rope !== undefined) { var q = set[an.rope].pts[an.k]; return { x: q.x, y: q.y }; }
        if (!hands) return null;
        if (an.center) return cs[an.hand];
        return hands[an.hand][an.idx];
      };
    }

    function build(hands, params) {
      ropes = []; flows = [];
      var cs = hands.map(center), rings = Math.round(params.rings), fr = [], pos = anchorOn(ropes, hands, cs);
      for (var r = 0; r < rings; r++) fr.push(0.3 + 0.6 * (r + 1) / (rings + 1));
      function add(a, b, n, kind) { ropes.push(rope(a, b, pos(a), pos(b), n, kind)); return ropes.length - 1; }
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
        flows.push([]);
      });
    }

    // Cumulative lengths along a rope, for placing particles by distance along the curve.
    function lengths(R) {
      var c = [0];
      for (var i = 1; i < R.pts.length; i++) c.push(c[i - 1] + Math.hypot(R.pts[i].x - R.pts[i - 1].x, R.pts[i].y - R.pts[i - 1].y));
      return c;
    }
    function at(R, c, s) {
      var i = 1;
      while (i < c.length - 1 && c[i] < s) i++;
      var seg = c[i] - c[i - 1] || 1, k = Math.max(0, Math.min(1, (s - c[i - 1]) / seg)), a = R.pts[i - 1], b = R.pts[i];
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
        var hands = ix.hands.map(function (h) { return h.points; }), cs = hands.map(center);

        // Thwip sign: index and pinky out, middle and ring folded. A flick (or a fast thrust) while
        // making it throws a web line along the index finger (knuckle → tip) at 3 frame heights a
        // second.
        var thwip = function (hd) { var f = hd.fingers; return f.index.extended && f.pinky.extended && !f.middle.extended && !f.ring.extended && !hd.pinched; };
        var shoot = function (hd, hi) {
          if (t - (lastThrow[hd.id] || -9) < 0.45) return;
          lastThrow[hd.id] = t;
          var q = hd.points, dx = q[8].x - q[5].x, dy = q[8].y - q[5].y, dl = Math.hypot(dx, dy) || 1, sp = H * 3;
          shots.push(newShot(hd.id, cs[hi], dx / dl * sp, dy / dl * sp, t));
          if (shots.length > MAX_SHOTS) shots[0].state = 'snap';
        };
        ix.hands.forEach(function (hd, hi) { if (thwip(hd) && hd.speed > H * 1.2) shoot(hd, hi); });
        // Flick: the whole web lets go and floats away; a new one forms (with the thwip sign, a
        // flick throws a line instead).
        ix.events.forEach(function (e) {
          if (e.n <= seen) return;
          seen = e.n;
          if (e.type !== 'flick') return;
          var fh = ix.hands.filter(function (h) { return h.id === e.hand; })[0];
          if (fh && thwip(fh)) { shoot(fh, ix.hands.indexOf(fh)); return; }
          if (!ropes.length) return;
          var d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[e.dir] || [0, -1];
          var vx = d[0] * H * 0.25, vy = d[1] * H * 0.25 - H * 0.05;
          ropes.forEach(function (R) { R.pts.forEach(function (q) { q.px = q.x - vx * dt; q.py = q.y - vy * dt; }); });
          flying.push({ ropes: ropes, born: t });
          if (flying.length > MAX_FLYING) flying.shift();
          ropes = []; topology = '';
        });

        var key = ix.hands.map(function (h) { return h.id; }).join('|') + ':' + params.rings;
        if (key !== topology) {
          topology = key;
          if (hands.length) { build(hands, params); bornAt = t; } else ropes = [];
        }

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
        if (hands.length && ropes.length) {
          simulate(ropes, anchorOn(ropes, hands, cs), (params.sag / 100) * H * 2.2, 0.985, dt, function (R) { return R.kind === 'pinch' && pinched[R.a.hand]; });
        }
        // Released webs: free ends, thrown gently along the flick, then buoyant (a slow rise against
        // air drag), fading out.
        flying = flying.filter(function (F) {
          if (t - F.born > FLY_LIFE) return false;
          simulate(F.ropes, anchorOn(F.ropes, null), -H * 0.06, 0.98, dt);
          return true;
        });

        // Web lines (see newShot): flying, stuck, snapping back, or hanging.
        var byId = {};
        ix.hands.forEach(function (hd, hi) { byId[hd.id] = cs[hi]; });
        shots = shots.filter(function (S) { return stepShot(S, byId[S.hand], dt, t, W, H); });

        var ink = Magi.fx.inkColor(params.color), rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        var glow = params.glow / 100, form = Math.min(1, (t - bornAt) / 0.4);
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        // Threads: a faint wide stroke for glow under one fine, steady line.
        function strokeSet(set, alpha, filter) {
          ctx.beginPath();
          set.forEach(function (R) { if (!filter || filter(R)) curve(ctx, R.pts); });
          if (glow > 0) {
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.1 * glow * alpha).toFixed(3) + ')';
            ctx.lineWidth = Math.max(2, 4 * u);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.8 * alpha).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1, 0.8 * u);
          ctx.stroke();
        }
        flying.forEach(function (F) { var a = 1 - (t - F.born) / FLY_LIFE; strokeSet(F.ropes, a * a); });
        // Web lines: the rope, a taut bright core, and a splat web where each one stuck.
        shots.forEach(function (S) {
          strokeSet([S.rope], S.alpha);
          if (S.anchor && S.state !== 'gone') {
            var A = S.anchor, r = H * 0.045 * S.splat;
            ctx.beginPath();
            for (var k = 0; k < 7; k++) { var a = S.inward + (k - 3) * 0.45; ctx.moveTo(A.x, A.y); ctx.lineTo(A.x + Math.cos(a) * r, A.y + Math.sin(a) * r); }
            [0.45, 0.8].forEach(function (f) {
              for (var k2 = 0; k2 < 6; k2++) {
                var a1 = S.inward + (k2 - 3) * 0.45, a2 = a1 + 0.45;
                k2 ? ctx.lineTo(A.x + Math.cos(a2) * r * f, A.y + Math.sin(a2) * r * f) : (ctx.moveTo(A.x + Math.cos(a1) * r * f, A.y + Math.sin(a1) * r * f), ctx.lineTo(A.x + Math.cos(a2) * r * f, A.y + Math.sin(a2) * r * f));
              }
            });
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.85 * S.alpha).toFixed(3) + ')';
            ctx.lineWidth = Math.max(1, 0.9 * u);
            ctx.stroke();
          }
        });
        strokeSet(ropes, form, function (R) { return R.kind !== 'pinch' || pinched[R.a.hand]; });
        // Pinch threads, taut and bright.
        ctx.beginPath();
        ropes.forEach(function (R) { if (R.kind === 'pinch' && pinched[R.a.hand]) curve(ctx, R.pts); });
        ctx.strokeStyle = 'rgba(' + rgb + ',' + form + ')';
        ctx.lineWidth = Math.max(1, 1.6 * u);
        ctx.stroke();

        // Particles: about one per 9% of the frame height of thread at full Particles, moving at
        // 22% of the frame height per second along the curve, faded in and out at the ends.
        var spacing = H * 0.09 / Math.max(0.01, params.particles / 100), speed = H * 0.22, dot = Math.max(1, 1.3 * u);
        var bins = [[], [], [], []];
        if (params.particles > 0) {
          ropes.forEach(function (R, ri) {
            if (R.kind === 'pinch' && !pinched[R.a.hand]) return;
            var c = lengths(R), L = c[c.length - 1], want = Math.min(8, Math.round(L / spacing)), fl = flows[ri];
            while (fl.length < want) fl.push(Math.random());
            if (fl.length > want) fl.length = want;
            for (var k = 0; k < fl.length; k++) {
              fl[k] = (fl[k] + speed * dt / Math.max(L, 1)) % 1;
              var q = at(R, c, fl[k] * L), a = Math.sin(Math.PI * fl[k]);
              bins[Math.min(3, Math.floor(a * 4))].push(q);
            }
          });
        }
        bins.forEach(function (bin, bi) {
          if (!bin.length) return;
          var a = (bi + 1) / 4 * form;
          if (glow > 0) {
            ctx.fillStyle = 'rgba(' + rgb + ',' + (0.18 * glow * a).toFixed(3) + ')';
            ctx.beginPath();
            bin.forEach(function (q) { ctx.moveTo(q.x + dot * 3, q.y); ctx.arc(q.x, q.y, dot * 3, 0, Math.PI * 2); });
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
          ctx.beginPath();
          bin.forEach(function (q) { ctx.moveTo(q.x + dot, q.y); ctx.arc(q.x, q.y, dot, 0, Math.PI * 2); });
          ctx.fill();
        });
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length && !flying.length && !shots.length) Magi.tracking.hint(ctx, frame, 'Raise your hands and spread your fingers. Flick to let the web go; make the web-shooter sign and flick to throw a line.');
      },
      reset: function () { ropes = []; topology = ''; lastT = null; wasPinched = {}; flying = []; flows = []; shots = []; lastThrow = {}; }
    };
  }

  Magi.renderers.web = createWeb;
})();
