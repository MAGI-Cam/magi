// Claw: your hand as a 3D rig, built like an armature in a 3D animation tool.
//
// X and Y offset the whole rig from the hand, in palm lengths.
// Every chain starts at one root low in the palm (0.75 of the way from the knuckles' mean to the wrist)
// and runs root → knuckle → joint → joint → fingertip (the thumb: root → base → … → tip). Each
// link is an octahedral bone, the diamond-shaped bone of Blender and Maya: from its head it widens
// to a ring of four points 25% along, then tapers to its tail. Bones are built in 3D from
// MediaPipe's landmark depth (z, in the same units as x, so ×frame width for pixels): the ring
// lies in the plane perpendicular to the bone, turned by the palm's normal n = (p5 − p0) × (p17 − p0),
// and is projected orthographically, so bones turn with the hand.
//
// Each fingertip carries a wireframe cylinder on the last bone's 3D axis â. A circle of radius r
// perpendicular to â projects to an ellipse with radii r and r·|â_z|, so a finger pointing at the
// camera shows its cylinder as overlapping circles. Past each fingertip a talon continues the
// finger (`claw` × the last bone's length), with a crosshair at its point; it retracts as the
// finger curls, by (1 − curl)^1.5, curl from the Interaction Engine. Lines glow: each path is stroked
// wide and faint, then narrower, then crisp, a cheap stand-in for a Gaussian bloom.
(function () {
  var FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  var WRIST = 0, MIDDLE_MCP = 9;
  var GLYPHS_PER_HAND = 9, NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function crossv(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
  function unit(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  // Octahedral bone from 3D point a to b, ring radius wk·|ab|, ring turned by the palm normal.
  function bone(ctx, a, b, wk, normal) {
    var d = sub(b, a), L = len3(d);
    if (L < 1) return;
    var ax = unit(d), v = crossv(normal, ax);
    if (len3(v) < 1e-3) v = crossv([0, 0, 1], ax);
    v = unit(v);
    var w = crossv(ax, v), r = L * wk, c = [a[0] + d[0] * 0.25, a[1] + d[1] * 0.25, a[2] + d[2] * 0.25];
    var ring = [];
    for (var k = 0; k < 4; k++) {
      var t = Math.PI / 4 + k * Math.PI / 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      ring.push([c[0] + v[0] * cs + w[0] * sn, c[1] + v[1] * cs + w[1] * sn]);
    }
    for (var i = 0; i < 4; i++) {
      var p = ring[i], q = ring[(i + 1) % 4];
      ctx.moveTo(a[0], a[1]); ctx.lineTo(p[0], p[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    }
  }

  // Cylinder centered at c (3D) along unit axis ax, length L, radius r: two caps, a middle ring,
  // the silhouette lines and a small inner ring on the front cap.
  function cylinder(ctx, c, ax, L, r) {
    var pl = Math.hypot(ax[0], ax[1]), minor = Math.max(0.12, Math.abs(ax[2])); // cap ellipse ratio
    var ux = pl > 1e-3 ? ax[0] / pl : 1, uy = pl > 1e-3 ? ax[1] / pl : 0;
    var ang = Math.atan2(uy, ux), half = L * pl / 2;
    [-1, 0, 1].forEach(function (s) {
      var x = c[0] + ux * half * s, y = c[1] + uy * half * s;
      ctx.moveTo(x + Math.cos(ang) * r * minor, y + Math.sin(ang) * r * minor);
      ctx.ellipse(x, y, r * minor, r, ang, 0, Math.PI * 2);
    });
    [-1, 1].forEach(function (s) {
      ctx.moveTo(c[0] - ux * half - uy * r * s, c[1] - uy * half + ux * r * s);
      ctx.lineTo(c[0] + ux * half - uy * r * s, c[1] + uy * half + ux * r * s);
    });
    var fx = c[0] + ux * half, fy = c[1] + uy * half;
    ctx.moveTo(fx + Math.cos(ang) * r * minor * 0.35, fy + Math.sin(ang) * r * minor * 0.35);
    ctx.ellipse(fx, fy, r * minor * 0.35, r * 0.35, ang, 0, Math.PI * 2);
  }

  // Strokes the current path with a glow: 7× and 3.5× the line width at low alpha, then the line.
  function glowStroke(ctx, rgb, width, glow) {
    var c = rgb.join(',');
    if (glow > 0) {
      ctx.strokeStyle = 'rgba(' + c + ',' + (0.07 * glow) + ')';
      ctx.lineWidth = width * 7;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + c + ',' + (0.18 * glow) + ')';
      ctx.lineWidth = width * 3.5;
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + c + ',0.96)';
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function cross(ctx, x, y, r) {
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  }

  // A HUD mark: shapes 0–4 are [, ], ⌐, ⊓ and a pair of ticks.
  function bracket(ctx, x, y, s, shape) {
    var h = s, w = s * 0.45;
    if (shape === 0) { ctx.moveTo(x + w, y - h); ctx.lineTo(x, y - h); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); }
    else if (shape === 1) { ctx.moveTo(x - w, y - h); ctx.lineTo(x, y - h); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y + h); }
    else if (shape === 2) { ctx.moveTo(x, y + h); ctx.lineTo(x, y - h); ctx.lineTo(x + w * 1.6, y - h); }
    else if (shape === 3) { ctx.moveTo(x - w, y + h); ctx.lineTo(x - w, y - h); ctx.lineTo(x + w, y - h); ctx.lineTo(x + w, y + h); }
    else { ctx.moveTo(x - w * 0.5, y - h); ctx.lineTo(x - w * 0.5, y - h * 0.3); ctx.moveTo(x + w * 0.5, y - h); ctx.lineTo(x + w * 0.5, y - h * 0.3); }
  }

  function createClaw() {
    var glyphs = [];
    for (var i = 0; i < GLYPHS_PER_HAND * 2; i++) {
      glyphs.push({ a: -0.6 + Math.random() * 3.2, b: (Math.random() - 0.5) * 4.4, shape: i % 5, phase: Math.random() * 10, rate: 0.5 + Math.random() * 1.2 });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), ix = Magi.interaction.read(frame);
        var ink = Magi.fx.inkColor(params.color);
        var accent = ink.map(function (v) { return Math.round(v * 255); }), white = [255, 255, 255];
        var reach = (params.claw / 100) * 4, glow = params.glow / 100;

        hands.forEach(function (p, h) {
          var palm = Math.hypot(p[MIDDLE_MCP].x - p[WRIST].x, p[MIDDLE_MCP].y - p[WRIST].y) || 1;
          // Offset: the whole rig moves away from the hand by X and Y, in palm lengths (±2), so
          // it can float beside the hand instead of on it.
          var ox = params.offsetX / 50 * palm, oy = params.offsetY / 50 * palm;
          var P = p.map(function (q) { return [q.x + ox, q.y + oy, (q.z || 0) * W]; });
          p = p.map(function (q) { return { x: q.x + ox, y: q.y + oy, z: q.z }; });
          var normal = unit(crossv(sub(P[5], P[0]), sub(P[17], P[0])));
          var knuckles = [0, 1, 2].map(function (k) { return (P[5][k] + P[9][k] + P[13][k] + P[17][k]) / 4; });
          // Root three quarters of the way to the wrist, so the first bones lie along the
          // metacarpals, the hand's real bones, instead of sliding over the palm.
          var root = [0, 1, 2].map(function (k) { return knuckles[k] + (P[WRIST][k] - knuckles[k]) * 0.75; });
          var sig = ix.hands[h];
          var tips = [];

          ctx.save();
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';

          // Bones, white with a glow.
          ctx.beginPath();
          FINGERS.forEach(function (f, fi) {
            bone(ctx, root, P[f[0]], 0.12, normal);
            for (var k = 0; k < 3; k++) bone(ctx, P[f[k]], P[f[k + 1]], 0.26, normal);
            var a = P[f[2]], b = P[f[3]], d = sub(b, a);
            // The talon points along the last two bones (middle joint → tip): a longer baseline
            // than the last bone alone, so its direction is steadier. It is as long as the last
            // bone × reach, and retracts as the finger curls.
            var dir = unit(sub(b, P[f[1]])), curl = sig ? sig.fingers[NAMES[fi]].curl : 0;
            var len = len3(d) * reach * Math.pow(1 - curl, 1.5);
            var end = [b[0] + dir[0] * len, b[1] + dir[1] * len, b[2] + dir[2] * len];
            if (len > 1) bone(ctx, b, end, 0.11, normal);
            tips.push({ a: a, b: b, d: d, end: end, out: len > 1 });
          });
          glowStroke(ctx, white, Math.max(1, 1.3 * u), glow);

          // Fingertip cylinders and talon crosshairs in the accent color.
          ctx.beginPath();
          tips.forEach(function (tp) {
            var L = len3(tp.d) || 1, ax = unit(tp.d);
            var c = [tp.b[0] - tp.d[0] * 0.15, tp.b[1] - tp.d[1] * 0.15, tp.b[2] - tp.d[2] * 0.15];
            cylinder(ctx, c, ax, L * 0.75, Math.max(L * 0.42, palm * 0.09));
            if (tp.out) cross(ctx, tp.end[0], tp.end[1], palm * 0.13);
          });
          glowStroke(ctx, accent, Math.max(1, 1.4 * u), glow * 0.8);

          if (params.glyphs) {
            // HUD marks in hand coordinates: along wrist → middle knuckle, and across it.
            var ax0 = p[MIDDLE_MCP].x - p[WRIST].x, ay0 = p[MIDDLE_MCP].y - p[WRIST].y;
            ctx.beginPath();
            glyphs.slice(h * GLYPHS_PER_HAND, (h + 1) * GLYPHS_PER_HAND).forEach(function (g) {
              if (Math.sin(t * g.rate + g.phase) < -0.5) return; // flicker
              var drift = Math.sin(t * 0.6 + g.phase) * 0.1;
              var gx = p[WRIST].x + ax0 * (g.a + drift) - ay0 * g.b * 0.5;
              var gy = p[WRIST].y + ay0 * (g.a + drift) + ax0 * g.b * 0.5;
              bracket(ctx, gx, gy, palm * 0.06, g.shape);
            });
            glowStroke(ctx, white, Math.max(1, 1.2 * u), glow * 0.6);
          }
          ctx.restore();
        });

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand.');
      },
      reset: function () {}
    };
  }

  Magi.renderers.claw = createClaw;
})();
