// Zero: a sphere of digits that twists, curls and collapses into a zero, with a wireframe cube
// inside (after a reference of a numbered sphere on blue). Over the camera.
//
// Points: a Fibonacci sphere (y = 1 − 2(k + ½)/N, φ = k·137.5°). Each point's digit is its latitude
// ring, counted from the top pole, mod 10 (ring = round(arccos(y)/π · 20)), so the digits count
// down the sphere in bands; a swipe shifts every ring's count.
// Shape operators (Barr 1984, "Global and local deformations of solid primitives"), applied in
// order to each point before it is turned and projected:
//   Twist about y:  θ = τ·y,  (x, z) ← (x cos θ − z sin θ, x sin θ + z cos θ).
//   Bend along y in the x–y plane, curvature κ, center line at x = 1/κ:
//     x ← 1/κ − (1/κ − x)·cos(κy),  y ← (1/κ − x)·sin(κy)   (κ → 0 is no bend).
//   Collapse onto the equator (the zero): p ← mix(p, (x/ρ, 0.04y, z/ρ), c), ρ = √(x² + z²).
// τ, κ and c each follow their targets through a damped spring (c underdamped, ζ = 0.45, so the
// sphere overshoots as it blooms back out of the ring).
// Inside: a wireframe cube (half-size 0.5) and four lines that wander along the cube's grid out to
// the shell, re-rolled every 6 s or with a swipe up or down. They turn and deform with the sphere.
// View: perspective with focal length 3; the sphere is untethered (it stays where you leave it).
// Hands:
//   Pinch and drag: turns it (trackball: 1.6π across the frame about y, 0.9π about x), with momentum.
//   Hand up, not pinched: the thumb–index spread sets the twist (wider: more, up to Twist); roll
//     your hand left past 20° to twist the other way.
//   Fist: collapses into a flat ring of digits, a zero. Open palm (five fingers): blooms back out.
//   Two hands: the closer they are, the tighter the shell curls (up to Curl).
//   Swipe left or right: shuffles the digits. Up or down: new lines inside the cube.
//   No hand: a slow twist-and-curl loop.
(function () {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5)), RINGS = 20;

  function createZero() {
    var pts = [], nKey = 0, offset = 0, lines = [], linesAt = -99, seen = 0, lastT = null, atlas = null, atlasKey = '';
    var view = { yaw: 0.4, pitch: 0.3 }, vel = { yaw: 0, pitch: 0 }, grab = null;
    var tw = { v: 0, d: 0 }, bd = { v: 0, d: 0 }, cl = { v: 0, d: 0 }, target = { tw: 0, bd: 0, cl: 0 };
    function spring(s, goal, hz, zeta, dt) { var w = 2 * Math.PI * hz; s.d += (-w * w * (s.v - goal) - 2 * zeta * w * s.d) * dt; s.v += s.d * dt; }
    function build(n) {
      pts = [];
      for (var k = 0; k < n; k++) {
        var y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = k * GOLDEN;
        pts.push({ p: [r * Math.cos(phi), y, r * Math.sin(phi)], ring: Math.round(Math.acos(y) / Math.PI * RINGS) });
      }
    }
    // Four lines that step along the cube's grid (0.5 steps on one axis at a time) out to the shell.
    function rollLines() {
      lines = [];
      for (var i = 0; i < 4; i++) {
        var c = [Math.random() < 0.5 ? -0.5 : 0.5, Math.random() < 0.5 ? -0.5 : 0.5, Math.random() < 0.5 ? -0.5 : 0.5], path = [c.slice()];
        for (var s = 0; s < 5; s++) {
          var ax = Math.floor(Math.random() * 3), step = (Math.random() < 0.5 ? -1 : 1) * 0.5, nx = c.slice();
          nx[ax] = Math.max(-1, Math.min(1, nx[ax] + step));
          if (Math.hypot(nx[0], nx[1], nx[2]) > 0.98) break;
          c = nx; path.push(c.slice());
        }
        lines.push(path);
      }
    }
    // White digit sprites, drawn once per size.
    function sprites(px) {
      var key = px + '';
      if (atlas && atlasKey === key) return atlas;
      atlasKey = key; atlas = [];
      for (var d = 0; d < 10; d++) {
        var c = document.createElement('canvas'); c.width = Math.ceil(px * 0.7); c.height = Math.ceil(px * 1.1);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '400 ' + px + 'px ' + Magi.fx.MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(d), c.width / 2, c.height / 2);
        atlas.push(c);
      }
      return atlas;
    }

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
        var n = Math.round(params.count);
        if (n !== nKey) { nKey = n; build(n); }
        if (t - linesAt > 6) { rollLines(); linesAt = t; }

        // Hands.
        var ix = Magi.interaction.read(frame), hands = ix.hands, hd = hands[0];
        var maxT = params.twist / 100 * 6, maxK = params.curl / 100 * 2.6;
        ix.events.forEach(function (e) {
          if (e.n <= seen) return; seen = e.n;
          if (e.type !== 'swipe') return;
          if (e.dir === 'left' || e.dir === 'right') offset = (offset + 1 + Math.floor(Math.random() * 9)) % 10;
          else { rollLines(); linesAt = t; }
        });
        var pincher = hands.filter(function (h) { return h.pinched; })[0];
        if (pincher) {
          var m = { x: (pincher.points[4].x + pincher.points[8].x) / 2, y: (pincher.points[4].y + pincher.points[8].y) / 2 };
          if (grab && grab.id === pincher.id) {
            var dy = (m.x - grab.x) / W * Math.PI * 1.6, dp = (m.y - grab.y) / H * Math.PI * 0.9;
            view.yaw += dy; view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dp));
            vel.yaw += (dy / Math.max(dt, 1e-3) - vel.yaw) * 0.3; vel.pitch += (dp / Math.max(dt, 1e-3) - vel.pitch) * 0.3;
          } else vel.yaw = vel.pitch = 0;
          grab = { id: pincher.id, x: m.x, y: m.y };
        } else {
          grab = null;
          var decay = Math.exp(-dt / 0.8);
          view.yaw += vel.yaw * dt + (hands.length ? 0 : params.spin / 100 * 0.5 * dt); view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + vel.pitch * dt));
          vel.yaw *= decay; vel.pitch *= decay;
        }
        if (hd) {
          if (hd.fist) target.cl = 1;
          else if (hd.count >= 5) target.cl = 0;
          if (!hd.pinched && !hd.fist) {
            var spread = Math.max(0, Math.min(1, (hd.pinchWith.index.distance - 0.3) / 1.0));
            target.tw = maxT * spread * (hd.rotation < -20 ? -1 : 1);
          }
          target.bd = hands.length >= 2 ? maxK * Math.max(0, Math.min(1, 1 - (Math.hypot(hands[0].center.x - hands[1].center.x, hands[0].center.y - hands[1].center.y) / H - 0.25) / 0.75)) : 0;
        } else {
          target.tw = maxT * 0.6 * Math.sin(t * 0.5);
          target.bd = maxK * 0.5 * (0.5 + 0.5 * Math.sin(t * 0.23));
          target.cl = 0;
        }
        spring(tw, target.tw, 1.2, 0.8, dt); spring(bd, target.bd, 1.0, 0.8, dt); spring(cl, target.cl, 1.4, 0.45, dt);

        // Deform, turn, project.
        var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        var R = Math.min(W, H) * 0.34 * (0.4 + params.size / 100 * 1.2), cx = W / 2, cy = H / 2, F = 3, tau = tw.v, kap = bd.v, col = Math.max(0, Math.min(1.15, cl.v));
        function deform(q) {
          var x = q[0], y = q[1], z = q[2];
          var th = tau * y, ct = Math.cos(th), st = Math.sin(th), x1 = x * ct - z * st, z1 = x * st + z * ct; x = x1; z = z1;
          if (Math.abs(kap) > 1e-3) { var r0 = 1 / kap, a = kap * y; var xb = r0 - (r0 - x) * Math.cos(a), yb = (r0 - x) * Math.sin(a); x = xb; y = yb; }
          if (col > 0) { var rho = Math.hypot(x, z) || 1e-3; x += (x / rho - x) * col; y += (0.04 * y - y) * col; z += (z / rho - z) * col; }
          return [x, y, z];
        }
        function project(v) {
          var x1 = v[0] * cyw + v[2] * syw, z1 = -v[0] * syw + v[2] * cyw;
          var y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp, k = F / (F + z2);
          return [cx + x1 * R * k, cy - y2 * R * k, z2, k];
        }

        // The cube and its lines.
        var ink = params.color ? Magi.fx.inkColor(params.color) : [1, 1, 1], rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
        if (params.cube) {
          ctx.save();
          ctx.strokeStyle = 'rgba(' + rgb + ',0.85)'; ctx.lineWidth = Math.max(1, 1.1 * u);
          ctx.beginPath();
          var V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(function (c) { return project(deform([c[0] * 0.5, c[1] * 0.5, c[2] * 0.5])); });
          [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) { ctx.moveTo(V[e[0]][0], V[e[0]][1]); ctx.lineTo(V[e[1]][0], V[e[1]][1]); });
          lines.forEach(function (path) { path.forEach(function (c, i) { var q = project(deform(c)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); });
          ctx.stroke();
          ctx.restore();
        }

        // The digits, far to near, faded with depth.
        var px = Math.max(6, Math.round((5 + params.text / 100 * 12) * u)), spr = sprites(px), list = [];
        pts.forEach(function (q) { var v = project(deform(q.p)); list.push([v[0], v[1], v[2], v[3], (q.ring + offset) % 10]); });
        list.sort(function (a, b) { return b[2] - a[2]; });
        hud.save();
        if (params.color) { hud.globalCompositeOperation = 'source-over'; }
        list.forEach(function (v) {
          var s = spr[v[4]], k = v[3], w = s.width * k, h = s.height * k;
          hud.globalAlpha = Math.max(0.25, Math.min(1, 0.55 + 0.45 * (1 - v[2])));
          hud.drawImage(s, v[0] - w / 2, v[1] - h / 2, w, h);
        });
        hud.globalAlpha = 1;
        if (params.color) {
          // Tint the digits: multiply the white sprites by the ink color on the HUD.
          hud.globalCompositeOperation = 'source-atop';
          hud.fillStyle = 'rgb(' + rgb + ')';
          hud.fillRect(0, 0, W, H);
        }
        hud.restore();
        var tracker = Magi.tracking.hands;
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) frame.say('Pinch and drag to turn it. Spread thumb and index to twist; fist makes a zero; two hands curl it.');
      },
      reset: function () { lastT = null; grab = null; vel = { yaw: 0, pitch: 0 }; }
    };
  }

  Magi.renderers.zero = createZero;
})();
