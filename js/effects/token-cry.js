// Token Cry: your text pours from your eyes as tears.
//
// Face Landmarker gives 478 points; 145 and 374 are the centers of the two lower eyelids. Each
// eye releases tokens: one grapheme at a time (what a reader sees as one character, so emoji,
// accents and every script stay whole), or the whole phrase per tear.
//
// Tokens leave along the face's own "down" (eyes → mouth), carrying the eye's velocity, so they
// follow when you tilt or move your head; then gravity takes over.
//
// Physics is Verlet integration (Jakobsen, "Advanced Character Physics", 2001): each point keeps
// its current and previous position, velocity is their difference, and constraints are solved by
// moving points directly. A symbol is one circle; a phrase is a straight stick of circles held
// by distance constraints, so it can tip, lean and lie across others. Collisions push circles
// apart, a small restitution gives the tiny bounce, and friction lets the pile settle like
// objects in a jar. Pool off: there is no floor and tokens fall out of the frame.
(function () {
  var LOWER_LID = [145, 374];
  var EYE_CORNERS = [[33, 133], [362, 263]];
  var MOUTH = 13;
  var FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var MAX_POINTS = 900;      // simulation budget; the oldest pooled tokens fade out past it
  var SUBSTEPS = 2, ITERATIONS = 4;
  var RESTITUTION = 0.22, FRICTION = 0.86, DAMPING = 0.998;

  var segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function graphemes(text) {
    if (segmenter) return Array.from(segmenter.segment(text), function (s) { return s.segment; });
    return Array.from(text); // code points: keeps emoji whole, may split combined accents
  }

  function createTokenCry() {
    var bodies = [], pointCount = 0;
    var cursors = [0, 0], clocks = [0, 0], lastLid = [null, null], eyeVel = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    var last = 0, text = null, glyphs = [];
    var measure = document.createElement('canvas').getContext('2d');

    // Verlet keeps velocity as the step from the previous position, so a starting velocity
    // (pixels per second) becomes an offset of one substep.
    function point(x, y, vx, vy, h) { return { x: x, y: y, px: x - vx * h, py: y - vy * h }; }

    // A token: one circle for a symbol, a stick of circles for a phrase.
    function spawn(ch, size, at, vel, angle, dt) {
      measure.font = '400 ' + size + 'px ' + FONT;
      var width = measure.measureText(ch).width, r = size * 0.42;
      var n = Math.max(1, Math.round((width - size * 0.2) / (size * 0.75)) + 1);
      var span = n > 1 ? width - size * 0.5 : 0, pts = [];
      for (var i = 0; i < n; i++) {
        var o = n > 1 ? (i / (n - 1) - 0.5) * span : 0;
        pts.push(point(at.x + Math.cos(angle) * o, at.y + Math.sin(angle) * o, vel.x, vel.y, dt / SUBSTEPS));
      }
      bodies.push({ ch: ch, size: size, r: r, pts: pts, rest: n > 1 ? span / (n - 1) : 0,
        angle: angle, spin: (Math.random() - 0.5) * 2, alpha: 1, fading: false, born: last });
      pointCount += n;
    }

    function stickConstraints(b) {
      var p = b.pts;
      for (var i = 0; i < p.length - 1; i++) {
        for (var j = i + 1; j < Math.min(p.length, i + 3); j++) { // neighbors and next-neighbors keep it straight
          var a = p[i], c = p[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
          var diff = (d - b.rest * (j - i)) / d / 2;
          a.x += dx * diff; a.y += dy * diff;
          c.x -= dx * diff; c.y -= dy * diff;
        }
      }
    }

    function simulate(dt, g, W, H, pool) {
      var h = dt / SUBSTEPS;
      for (var s = 0; s < SUBSTEPS; s++) {
        bodies.forEach(function (b) {
          b.pts.forEach(function (p) {
            var vx = (p.x - p.px) * DAMPING, vy = (p.y - p.py) * DAMPING;
            p.px = p.x; p.py = p.y;
            p.x += vx; p.y += vy + g * h * h;
          });
        });
        for (var it = 0; it < ITERATIONS; it++) {
          bodies.forEach(stickConstraints);
          collide(it === 0);
          bodies.forEach(function (b) {
            b.pts.forEach(function (p) {
              // The jar: side walls always, a floor when pooling.
              if (p.x < b.r) { p.x = b.r; p.px = p.x + (p.x - p.px) * RESTITUTION; }
              if (p.x > W - b.r) { p.x = W - b.r; p.px = p.x + (p.x - p.px) * RESTITUTION; }
              if (pool && p.y > H - b.r) {
                var vy = p.y - p.py;
                p.y = H - b.r;
                p.py = p.y + vy * RESTITUTION;              // tiny bounce
                p.px = p.x - (p.x - p.px) * FRICTION;      // floor friction
              }
            });
          });
        }
      }
    }

    // Circle–circle contacts between different tokens, found with a uniform grid.
    function collide(bounce) {
      var cell = 0, grid = new Map(), all = [];
      bodies.forEach(function (b) { cell = Math.max(cell, b.r * 2); });
      if (!cell) return;
      bodies.forEach(function (b, bi) {
        b.pts.forEach(function (p) {
          var gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), key = gx * 73856093 ^ gy * 19349663;
          var e = { p: p, b: bi, r: b.r, gx: gx, gy: gy };
          all.push(e);
          (grid.get(key) || grid.set(key, []).get(key)).push(e);
        });
      });
      all.forEach(function (e) {
        for (var ox = -1; ox <= 1; ox++) {
          for (var oy = -1; oy <= 1; oy++) {
            var list = grid.get((e.gx + ox) * 73856093 ^ (e.gy + oy) * 19349663);
            if (!list) continue;
            for (var k = 0; k < list.length; k++) {
              var f = list[k];
              if (f.b <= e.b) continue; // each pair once, never within one token
              var a = e.p, c = f.p, dx = c.x - a.x, dy = c.y - a.y, min = e.r + f.r;
              var d2 = dx * dx + dy * dy;
              if (d2 >= min * min || d2 === 0) continue;
              var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (min - d) / 2;
              a.x -= nx * push; a.y -= ny * push;
              c.x += nx * push; c.y += ny * push;
              if (bounce) {
                // Restitution along the contact normal, and a little friction along the tangent.
                var rvx = (c.x - c.px) - (a.x - a.px), rvy = (c.y - c.py) - (a.y - a.py);
                var vn = rvx * nx + rvy * ny;
                if (vn < 0) {
                  var j = -(1 + RESTITUTION) * vn / 2;
                  a.px += nx * j; a.py += ny * j;
                  c.px -= nx * j; c.py -= ny * j;
                }
                var tx = -ny, ty = nx, vt = (rvx * tx + rvy * ty) * (1 - FRICTION) / 2;
                a.px -= tx * vt; a.py -= ty * vt;
                c.px += tx * vt; c.py += ty * vt;
              }
            }
          }
        }
      });
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);

        var dt = last ? Math.min(1 / 30, (frame.time - last) / 1000) : 0;
        last = frame.time;
        if (params.text !== text) { text = params.text; glyphs = graphemes(text); cursors = [0, 0]; }

        var speed = params.speed / 100;
        var g = H * (0.9 + speed * 2.4);                       // gravity, frame pixels per s²
        var rate = 1.5 + speed * 11; // tears per second per eye, the same for symbols and phrases

        var faces = Magi.tracking.face.detect(frame);
        var face = faces[0];
        if (face && dt && text.trim()) {
          var eyes = EYE_CORNERS.map(function (c) {
            return { x: (face[c[0]].x + face[c[1]].x) / 2, y: (face[c[0]].y + face[c[1]].y) / 2, w: Math.hypot(face[c[0]].x - face[c[1]].x, face[c[0]].y - face[c[1]].y) };
          });
          var mid = { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 };
          var down = { x: face[MOUTH].x - mid.x, y: face[MOUTH].y - mid.y };
          var dl = Math.hypot(down.x, down.y) || 1;
          down.x /= dl; down.y /= dl;
          var roll = Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x);
          if (Math.cos(roll) < 0) roll += Math.PI;                    // keep text upright
          // Scale follows how big the eyes are in frame, so tokens grow as you come closer.
          var size = Math.max(8, (eyes[0].w + eyes[1].w) / 2 * (0.25 + (params.scale / 100) * 1.6));
          for (var e = 0; e < 2; e++) {
            var lid = face[LOWER_LID[e]];
            if (lastLid[e]) {
              var vx = (lid.x - lastLid[e].x) / dt, vy = (lid.y - lastLid[e].y) / dt;
              eyeVel[e].x += (vx - eyeVel[e].x) * 0.35;
              eyeVel[e].y += (vy - eyeVel[e].y) * 0.35;
            }
            lastLid[e] = { x: lid.x, y: lid.y };
            clocks[e] += dt * rate;
            while (clocks[e] >= 1) {
              clocks[e] -= 1;
              var ch;
              if (params.phrase) ch = text.trim();
              else { ch = glyphs[cursors[e] % glyphs.length]; cursors[e]++; }
              if (!ch.trim()) continue; // spaces leave a pause
              var out0 = H * (0.12 + speed * 0.25);
              var side = (Math.random() - 0.5) * H * 0.06;
              spawn(ch, size, { x: lid.x + down.x * size * 0.5, y: lid.y + down.y * size * 0.5 }, {
                x: eyeVel[e].x * 0.8 + down.x * out0 - down.y * side,
                y: eyeVel[e].y * 0.8 + down.y * out0 + down.x * side
              }, roll, dt);
            }
          }
        } else {
          lastLid = [null, null];
        }

        if (dt) simulate(dt, g, W, H, params.pool);

        // Retire tokens: out of frame, or the oldest pooled ones once over budget (they fade).
        var over = pointCount - MAX_POINTS;
        for (var i = 0; i < bodies.length && over > 0; i++) {
          if (!bodies[i].fading) { bodies[i].fading = true; over -= bodies[i].pts.length; }
        }
        bodies = bodies.filter(function (b) {
          var gone = b.pts.every(function (p) { return p.y - b.size > H; });
          if (b.fading) b.alpha -= dt * 2.5;
          if (gone || b.alpha <= 0) { pointCount -= b.pts.length; return false; }
          return true;
        });

        ctx.save();
        var ink = Magi.fx.inkColor(params.color);
        ctx.fillStyle = 'rgb(' + ink.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Inverse: tokens invert whatever is beneath them (difference blend), so they read on any
        // background. Otherwise they are solid ink with a soft shadow.
        if (params.inverse) ctx.globalCompositeOperation = 'difference';
        else ctx.shadowColor = 'rgba(0,0,0,0.45)';
        bodies.forEach(function (b) {
          var p = b.pts, a = p[0], z = p[p.length - 1], x, y, angle;
          if (p.length > 1) {
            x = (a.x + z.x) / 2; y = (a.y + z.y) / 2;
            angle = Math.atan2(z.y - a.y, z.x - a.x);
            // A straight stick looks the same end for end, so keep its text reading upright.
            if (Math.cos(angle) < 0) angle += Math.PI;
          } else {
            // A single symbol turns as it rolls: angular step = horizontal travel / radius.
            b.angle += ((a.x - a.px) / b.r) * 0.6 + b.spin * dt;
            b.spin *= 0.97;
            x = a.x; y = a.y; angle = b.angle;
          }
          ctx.globalAlpha = Math.max(0, b.alpha);
          if (!params.inverse) ctx.shadowBlur = b.size * 0.2;
          ctx.font = '400 ' + b.size + 'px ' + FONT;
          ctx.setTransform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), x, y);
          ctx.fillText(b.ch, 0, 0);
        });
        ctx.restore();

        var tracker = Magi.tracking.face;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'face');
        else if (!face) Magi.tracking.hint(ctx, frame, 'Look into the camera.');
      },
      reset: function () { last = 0; bodies = []; pointCount = 0; lastLid = [null, null]; }
    };
  }

  Magi.renderers['token-cry'] = createTokenCry;
})();
