// Claw: your hand as a 3D rig. Every bone of MediaPipe's 21-point hand is drawn as an
// octahedral bone, the diamond-shaped bone of 3D animation tools: from the joint it widens to a
// ring of four points 18% along its length, then tapers to the next joint. The ring is turned a
// little out of the image plane so each bone reads as a solid in wireframe. The last bone of
// each finger extends past the fingertip along the same direction into a claw, `claw` × its own
// length. Fingertips carry wireframe cylinders on the finger axis, the wrist a target ring,
// the knuckles crosshairs, and small HUD brackets drift with the hand in its own coordinates.
(function () {
  var FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  var WRIST = 0, MIDDLE_MCP = 9;
  var GLYPHS_PER_HAND = 10;

  // Octahedral bone from a to b, half-width w·|ab|.
  function bone(ctx, a, b, wk) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1) return;
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux, w = len * wk;
    var hx = a.x + dx * 0.18, hy = a.y + dy * 0.18, ring = [];
    for (var k = 0; k < 4; k++) {
      var ang = k * Math.PI / 2 + 0.55, off = Math.cos(ang) * w, dep = Math.sin(ang) * w * 0.45;
      ring.push([hx + nx * off + ux * dep, hy + ny * off + uy * dep]);
    }
    for (var i = 0; i < 4; i++) {
      var r = ring[i], s = ring[(i + 1) % 4];
      ctx.moveTo(a.x, a.y); ctx.lineTo(r[0], r[1]);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(r[0], r[1]); ctx.lineTo(s[0], s[1]);
    }
  }

  // Wireframe cylinder centered at c along unit axis (ux, uy): two end caps, a middle ring and
  // the two silhouette lines. Caps are ellipses foreshortened along the axis.
  function cylinder(ctx, c, ux, uy, length, radius) {
    var ang = Math.atan2(uy, ux);
    [-0.5, 0, 0.5].forEach(function (t) {
      ctx.moveTo(c.x + ux * length * t + Math.cos(ang) * radius * 0.35, c.y + uy * length * t + Math.sin(ang) * radius * 0.35);
      ctx.ellipse(c.x + ux * length * t, c.y + uy * length * t, radius * 0.35, radius, ang, 0, Math.PI * 2);
    });
    [-1, 1].forEach(function (s) {
      ctx.moveTo(c.x - ux * length / 2 - uy * radius * s, c.y - uy * length / 2 + ux * radius * s);
      ctx.lineTo(c.x + ux * length / 2 - uy * radius * s, c.y + uy * length / 2 + ux * radius * s);
    });
  }

  function cross(ctx, x, y, r) {
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  }

  // A HUD bracket: shapes 0–3 are [, ], ⌐ and ⊓.
  function bracket(ctx, x, y, s, shape) {
    var h = s, w = s * 0.45;
    if (shape === 0) { ctx.moveTo(x + w, y - h); ctx.lineTo(x, y - h); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); }
    else if (shape === 1) { ctx.moveTo(x - w, y - h); ctx.lineTo(x, y - h); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y + h); }
    else if (shape === 2) { ctx.moveTo(x, y + h); ctx.lineTo(x, y - h); ctx.lineTo(x + w * 1.6, y - h); }
    else { ctx.moveTo(x - w, y + h); ctx.lineTo(x - w, y - h); ctx.lineTo(x + w, y - h); ctx.lineTo(x + w, y + h); }
  }

  function createClaw() {
    // Glyph offsets in hand coordinates: along the wrist → middle-knuckle axis, and across it.
    var glyphs = [];
    for (var i = 0; i < GLYPHS_PER_HAND * 2; i++) {
      glyphs.push({ a: -0.2 + Math.random() * 2.6, b: (Math.random() - 0.5) * 3, shape: i % 4, phase: Math.random() * 10, rate: 0.6 + Math.random() * 1.4 });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame);
        var ink = Magi.fx.inkColor(params.color);
        var accent = 'rgb(' + ink.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
        var reach = (params.claw / 100) * 4;

        hands.forEach(function (p, h) {
          var palm = Math.hypot(p[MIDDLE_MCP].x - p[WRIST].x, p[MIDDLE_MCP].y - p[WRIST].y) || 1;
          ctx.save();
          ctx.lineJoin = 'round';

          // Bones: wrist to each finger base, then along each finger, then the claw.
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = Math.max(1, 1.2 * u);
          ctx.beginPath();
          FINGERS.forEach(function (f) {
            bone(ctx, p[WRIST], p[f[0]], 0.09);
            for (var k = 0; k < 3; k++) bone(ctx, p[f[k]], p[f[k + 1]], 0.2);
            if (reach > 0) {
              var a = p[f[2]], b = p[f[3]];
              bone(ctx, b, { x: b.x + (b.x - a.x) * reach, y: b.y + (b.y - a.y) * reach }, 0.09);
            }
          });
          ctx.stroke();

          // Accents: fingertip cylinders, wrist target, knuckle crosshairs.
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(1, 1.5 * u);
          ctx.beginPath();
          FINGERS.forEach(function (f) {
            var a = p[f[2]], b = p[f[3]], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            cylinder(ctx, b, (b.x - a.x) / len, (b.y - a.y) / len, len * 0.9, Math.max(len * 0.42, palm * 0.07));
          });
          var wr = palm * 0.22;
          ctx.moveTo(p[WRIST].x + wr, p[WRIST].y);
          ctx.arc(p[WRIST].x, p[WRIST].y, wr, 0, Math.PI * 2);
          ctx.moveTo(p[WRIST].x + wr * 0.45, p[WRIST].y);
          ctx.ellipse(p[WRIST].x, p[WRIST].y, wr * 0.45, wr * 0.8, 0.3, 0, Math.PI * 2);
          [2, 5, 9, 13, 17].forEach(function (j) { cross(ctx, p[j].x, p[j].y, palm * 0.08); }); // knuckles
          ctx.stroke();

          if (params.glyphs) {
            // Hand frame: axis from wrist to middle knuckle, and its perpendicular.
            var ax = (p[MIDDLE_MCP].x - p[WRIST].x), ay = (p[MIDDLE_MCP].y - p[WRIST].y);
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = Math.max(1, 1.1 * u);
            ctx.beginPath();
            glyphs.slice(h * GLYPHS_PER_HAND, (h + 1) * GLYPHS_PER_HAND).forEach(function (g) {
              if (Math.sin(t * g.rate + g.phase) < -0.55) return; // flicker
              var drift = Math.sin(t * 0.7 + g.phase) * 0.08;
              var gx = p[WRIST].x + ax * (g.a + drift) - ay * g.b * 0.5;
              var gy = p[WRIST].y + ay * (g.a + drift) + ax * g.b * 0.5;
              bracket(ctx, gx, gy, palm * 0.07, g.shape);
            });
            ctx.stroke();
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
