// Swarm: a flock of mouse cursors that follows your index finger and, let loose, finds the objects
// in the picture and marks them up like a design tool's selection (after a reference of cursors
// swarming a web page).
//
// Each cursor is a point mass steered toward its own target (seek: a ← (target − x)·k² − v·2k, a
// critically damped spring with natural frequency k, so it arrives without overshoot), plus
// separation from cursors closer than 1.2 cursor sizes (a boid rule, Reynolds 1987) and a little
// wander. Cursors respond at different rates (k spread 0.6–1.4×), so a moving target stretches the
// flock into a stream.
//   Point (or any open hand short of a flat palm): every cursor's target is your index fingertip
//     plus its own offset in a loose cloud, 0.6–3 cursor sizes away.
//   Fist: the offsets shrink to zero and the swarm merges into a single cursor at your fingertip
//     (cursors that have arrived fade out, leaving one).
//   Open palm: unleash. The cursors leave your hand for what can be named for certain: people
//     (MediaPipe's Object Detector, Magi.tracking.objects), faces (the face tracker), hands (the
//     hand tracker), and other clear detections as OBJECT 1, 2, 3…. Each points at a spot on an object (a handle, an edge, the
//     center or somewhere inside), dwells 0.5–1.8 s ÷ Speed, then hops to another spot, often on
//     another object, like people pointing things out. Each found object, including a smaller one
//     inside a bigger one, is drawn as a selection: a blue box with handles, guides out to the
//     edges of the frame and a tag with what it is and how sure. With nothing found, the cursors
//     spread out and search.
//   No hand: they drift.
(function () {
  // Where a cursor can point on an object, as fractions of its box: the eight handles, the center,
  // and (null) a random spot inside.
  var SPOTS = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5], null, null, null];
  var BLUE = '#2f6bff', COLORS = ['#ffffff', '#2f6bff', '#ffd23a', '#ff4d5e', '#4be38a', '#ff7ad9', '#7fd0ff'];
  // The classic arrow pointer, in units of its height (tip at 0, 0).
  var ARROW = [[0, 0], [0, 1], [0.27, 0.76], [0.45, 1.12], [0.6, 1.05], [0.43, 0.7], [0.75, 0.7]];

  function drawCursor(ctx, x, y, s, fill, a) {
    ctx.globalAlpha = a;
    ctx.beginPath();
    ARROW.forEach(function (p, i) { var px = x + p[0] * s, py = y + p[1] * s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = fill === '#ffffff' ? '#000' : 'rgba(0,0,0,0.65)'; ctx.stroke();
  }

  function bounds(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  Magi.renderers.swarm = function () {
    var C = [], lastT = null, mode = 'idle', unleash = 0, objNum = {}, objCount = 0;
    function cursor(i, W, H) {
      var a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 2.4;
      return { x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, k: 0.6 + Math.random() * 0.8, ox: Math.cos(a) * r, oy: Math.sin(a) * r, col: COLORS[i % COLORS.length], ph: Math.random() * 6.28, wx: Math.random(), wy: Math.random(), a: 1 };
    }
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, M = Math.min(W, H), u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (params.dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.05, t - lastT)); lastT = t;

        var n = Math.round(params.count), size = Math.max(8, (10 + params.size / 100 * 18) * u), sp = 0.4 + params.speed / 100 * 1.6;
        while (C.length < n) C.push(cursor(C.length, W, H));
        if (C.length > n) C.length = n;

        var ix = Magi.interaction.read(frame), hd = ix.hands[0], tip = hd ? hd.points[8] : null;
        mode = !hd ? 'idle' : hd.fist ? 'merge' : (hd.count >= 5 && !hd.pinched) ? 'unleash' : 'follow';
        unleash += ((mode === 'unleash' ? 1 : 0) - unleash) * (1 - Math.exp(-dt / 0.25));
        // Objects: only looked for once you have opened your palm, so the detector loads on demand.
        // Only what can be named for certain: a PERSON (the detector's person class at 50% or more),
        // a FACE (the face tracker), a HAND (the hand tracker), and anything else the detector is
        // at least 55% sure of as OBJECT 1, 2, 3… (numbered in the order found), not its guessed
        // class. Biggest first, so a smaller object inside a bigger one is drawn over it.
        var objs = [];
        if (mode === 'unleash' || unleash > 0.05) {
          Magi.tracking.objects.detect(frame).forEach(function (o) {
            if (o.label === 'person') { if (o.score >= 0.5) objs.push({ id: 'p' + o.id, x: o.x, y: o.y, w: o.w, h: o.h, label: 'PERSON', score: o.score }); }
            else if (o.score >= 0.55) {
              if (!(o.id in objNum)) objNum[o.id] = ++objCount;
              objs.push({ id: 'o' + o.id, x: o.x, y: o.y, w: o.w, h: o.h, label: 'OBJECT ' + objNum[o.id], score: o.score });
            }
          });
          Magi.tracking.face.detect(frame).forEach(function (pts, k) { var b = bounds(pts); objs.push({ id: 'f' + k, x: b.x, y: b.y, w: b.w, h: b.h, label: 'FACE', score: null }); });
          ix.hands.forEach(function (h) { var b = bounds(h.points), m = b.w * 0.15; objs.push({ id: 'h' + h.id, x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m, label: 'HAND', score: null }); });
          objs.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
        }
        var hold = tip ? { x: tip.x, y: tip.y } : null;

        C.forEach(function (c, i) {
          var tx, ty;
          if (mode === 'merge') { tx = hold.x; ty = hold.y; }
          else if (mode === 'follow') { tx = hold.x + c.ox * size; ty = hold.y + c.oy * size; }
          else if (mode === 'unleash' && objs.length) {
            // Each cursor points at one spot on one object (a handle, an edge, the center or a spot
            // inside), dwells there, then hops to another, often on another object; objects are
            // chosen evenly, so a small object inside a big one gets its share. Spots are kept as
            // fractions of the box, so they follow it as it moves.
            var ob = null;
            objs.forEach(function (o) { if (o.id === c.obj) ob = o; });
            if (!ob || t > c.until) {
              ob = objs[Math.floor(Math.random() * objs.length)];
              var sp2 = SPOTS[Math.floor(Math.random() * SPOTS.length)];
              c.obj = ob.id; c.fx = sp2 ? sp2[0] : 0.15 + 0.7 * Math.random(); c.fy = sp2 ? sp2[1] : 0.15 + 0.7 * Math.random();
              c.until = t + (0.5 + Math.random() * 1.3) / sp;
            }
            tx = ob.x + c.fx * ob.w; ty = ob.y + c.fy * ob.h;
          } else {
            // Searching (or no hand): each drifts over its own slow Lissajous path across the frame.
            var sx = mode === 'unleash' ? 0.45 : 0.35;
            tx = W * (0.5 + sx * Math.sin(t * 0.21 * sp + c.ph + c.wx * 6)); ty = H * (0.5 + sx * Math.sin(t * 0.17 * sp + c.ph * 1.3 + c.wy * 6));
          }
          // Critically damped spring toward the target, natural frequency k·(4…10)/s.
          var w0 = c.k * (4 + 6 * sp) * (mode === 'merge' ? 1.3 : 1);
          var ax = (tx - c.x) * w0 * w0 - c.vx * 2 * w0, ay = (ty - c.y) * w0 * w0 - c.vy * 2 * w0;
          c.ax = ax; c.ay = ay;
        });
        // Separation: push apart cursors closer than 1.2 sizes (not while merging).
        if (mode !== 'merge') {
          var R = size * 1.2, cell = {}, key = function (x, y) { return Math.floor(x / R) + ',' + Math.floor(y / R); };
          C.forEach(function (c, i) { var k = key(c.x, c.y); (cell[k] || (cell[k] = [])).push(i); });
          C.forEach(function (c, i) {
            var gx = Math.floor(c.x / R), gy = Math.floor(c.y / R);
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) (cell[(gx + ox) + ',' + (gy + oy)] || []).forEach(function (j) {
              if (j === i) return;
              var dx = c.x - C[j].x, dy = c.y - C[j].y, d = Math.hypot(dx, dy);
              if (d > 0 && d < R) { var f = (R - d) / R * 900 * u; c.ax += dx / d * f; c.ay += dy / d * f; }
            });
          });
        }
        C.forEach(function (c, i) {
          c.vx += c.ax * dt; c.vy += c.ay * dt; c.x += c.vx * dt; c.y += c.vy * dt;
          // Merging: a cursor that has reached the fingertip fades, so one is left.
          var near = hold ? Math.hypot(c.x - hold.x, c.y - hold.y) : 1e9;
          var want = mode === 'merge' && i > 0 && near < size * 0.6 ? 0 : 1;
          c.a += (want - c.a) * (1 - Math.exp(-dt / 0.12));
        });

        // Selections: a box, corner handles, guides to the frame's edges and a tag.
        if (unleash > 0.02 && objs.length) {
          ctx.save();
          ctx.globalAlpha = unleash;
          objs.forEach(function (ob) {
            if (params.guides) {
              ctx.strokeStyle = 'rgba(47,107,255,0.35)'; ctx.lineWidth = Math.max(1, 0.75 * u);
              ctx.beginPath();
              ctx.moveTo(0, ob.y); ctx.lineTo(W, ob.y); ctx.moveTo(0, ob.y + ob.h); ctx.lineTo(W, ob.y + ob.h);
              ctx.moveTo(ob.x, 0); ctx.lineTo(ob.x, H); ctx.moveTo(ob.x + ob.w, 0); ctx.lineTo(ob.x + ob.w, H);
              ctx.stroke();
            }
            ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.5, 1.5 * u);
            ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
            var hs = 5 * u;
            ctx.fillStyle = '#fff';
            [[ob.x, ob.y], [ob.x + ob.w, ob.y], [ob.x, ob.y + ob.h], [ob.x + ob.w, ob.y + ob.h], [ob.x + ob.w / 2, ob.y], [ob.x + ob.w / 2, ob.y + ob.h]].forEach(function (p) {
              ctx.fillRect(p[0] - hs / 2, p[1] - hs / 2, hs, hs); ctx.strokeRect(p[0] - hs / 2, p[1] - hs / 2, hs, hs);
            });
          });
          ctx.restore();
          if (params.labels) {
            hud.save(); hud.globalAlpha = unleash;
            hud.font = '500 ' + Math.round(9 * u) + 'px ' + Magi.fx.MONO; hud.textBaseline = 'middle';
            objs.forEach(function (ob) {
              var txt = ob.label + (ob.score ? '  ' + Math.round(ob.score * 100) + '%' : ''), tw = hud.measureText(txt).width + 10 * u, th = 14 * u;
              var ty0 = ob.y - th - 4 * u < 0 ? ob.y + 4 * u : ob.y - th - 4 * u;
              hud.fillStyle = BLUE; hud.fillRect(ob.x, ty0, tw, th);
              hud.fillStyle = '#fff'; hud.fillText(txt, ob.x + 5 * u, ty0 + th / 2);
            });
            hud.restore();
          }
        }

        // The cursors, back to front by arrival.
        ctx.save();
        ctx.lineWidth = Math.max(1, 0.9 * u); ctx.lineJoin = 'round';
        C.forEach(function (c, i) { if (c.a > 0.02) drawCursor(ctx, c.x, c.y, size, i === 0 && mode === 'merge' ? '#ffffff' : c.col, c.a); });
        ctx.restore();

        var tracker = Magi.tracking.hands, ot = Magi.tracking.objects;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (mode === 'unleash' && ot.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, ot, 'object');
        else if (mode === 'unleash' && !objs.length) frame.say('Searching… nothing found yet (people, faces, hands and clear objects).');
        else if (!hd) frame.say('Point: the cursors follow your finger. Fist: they merge into one. Open palm: they go and find things.');
      },
      reset: function () { C = []; lastT = null; unleash = 0; objNum = {}; objCount = 0; }
    };
  };
})();
