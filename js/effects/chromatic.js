// Chromatic: the 949 color names of the xkcd color survey, floating where their colors sit in a
// 3D color space, turned and zoomed by your hand.
//
// Spaces (modes):
//   Lab — CIELAB, the perceptual space: equal distances look roughly equally different to people.
//         sRGB → linear (c ≤ 0.04045 ? c/12.92 : ((c + 0.055)/1.055)^2.4) → XYZ (D65 matrix)
//         → L* = 116·f(Y) − 16, a* = 500·(f(X/Xn) − f(Y)), b* = 200·(f(Y) − f(Z/Zn)),
//         f(t) = t^(1/3) above (6/29)³, else t/(3·(6/29)²) + 4/29. Lightness is height.
//   HSL — a cylinder: hue is the angle, saturation the radius, lightness the height.
//   RGB — the cube, red, green and blue on the three axes.
// Hand: pinch and drag to turn the space like a trackball (it coasts when you let go); point with
// your index finger alone to light up the name under its tip with its hex code; move your hand
// closer to the camera to zoom (the Size slider follows). Tap the tile to change space.
// With no hand the space turns slowly on its own (Spin).
(function () {
  var THUMB_TIP = 4, INDEX_TIP = 8, FOCAL = 3;

  function linear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function f(t) { var d = 6 / 29; return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29; }

  function lab(r, g, b) {
    var R = linear(r), G = linear(g), B = linear(b);
    var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
    var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
    var fy = f(Y);
    return [116 * fy - 16, 500 * (f(X / 0.95047) - fy), 200 * (fy - f(Z / 1.08883))];
  }

  function hsl(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= Math.PI / 3;
    }
    return [h, s, l];
  }

  // Each color's position in each space, in roughly −1…1, with y up.
  var COLORS = (Magi.colorNames || []).map(function (c, i) {
    var r = parseInt(c[1].slice(1, 3), 16) / 255, g = parseInt(c[1].slice(3, 5), 16) / 255, b = parseInt(c[1].slice(5, 7), 16) / 255;
    var L = lab(r, g, b), H = hsl(r, g, b);
    return {
      name: c[0].toUpperCase(), hex: c[1], css: c[1],
      // A fixed pseudo-random rank decides which names are labeled at a given Labels setting.
      rank: ((i * 2654435761) >>> 0) / 4294967296,
      pos: {
        lab: [L[1] / 100, (L[0] - 50) / 50, L[2] / 100],
        hsl: [H[1] * Math.cos(H[0]), (H[2] - 0.5) * 2, H[1] * Math.sin(H[0])],
        rgb: [r * 2 - 1, g * 2 - 1, b * 2 - 1]
      }
    };
  });

  var AXES = {
    lab: [[[0, -1, 0], [0, 1, 0]], [[-1, 0, 0], [1, 0, 0]], [[0, 0, -1], [0, 0, 1]]],
    hsl: [[[0, -1, 0], [0, 1, 0]]],
    rgb: [[[-1, -1, -1], [1, -1, -1]], [[-1, -1, -1], [-1, 1, -1]], [[-1, -1, -1], [-1, -1, 1]],
      [[1, 1, 1], [-1, 1, 1]], [[1, 1, 1], [1, -1, 1]], [[1, 1, 1], [1, 1, -1]],
      [[1, -1, -1], [1, 1, -1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [1, 1, -1]],
      [[-1, 1, -1], [-1, 1, 1]], [[-1, -1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1]]]
  };

  function createChromatic() {
    var view = { yaw: 0.6, pitch: 0.25, zoom: 1 }, last = 0;
    var grab = null, spin = { yaw: 0, pitch: 0 };
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (params.dim) {
          ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100 * 0.85).toFixed(3) + ')';
          ctx.fillRect(0, 0, W, H);
        }
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;

        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), hd = ix.hands[0], hands = ix.hands, tip = null;
        if (hd) {
          var p = hd.points;
          // Grab and turn: while pinched, the space follows the pinch like a trackball (moving
          // across the frame turns it 2π), and when you let go it coasts, its spin halving every
          // 0.6 s.
          var gx = (p[THUMB_TIP].x + p[INDEX_TIP].x) / 2, gy = (p[THUMB_TIP].y + p[INDEX_TIP].y) / 2;
          if (hd.pinched && grab) {
            var dyaw = (gx - grab.x) / W * Math.PI * 2, dpitch = (gy - grab.y) / H * Math.PI;
            view.yaw += dyaw; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + dpitch));
            spin = dt > 0 ? { yaw: dyaw / dt, pitch: dpitch / dt } : spin;
          }
          grab = hd.pinched ? { x: gx, y: gy } : null;
          // Point (index finger only) to read the name under your fingertip.
          if (hd.pointing) tip = p[INDEX_TIP];
          // Zoom: bring your hand closer to the camera to enlarge the space (palm 8% → 25% of the
          // frame height maps to Size 50 → 180), and the Size slider follows.
          if (!hd.pinched) frame.setParam('size', 50 + 130 * Math.min(1, Math.max(0, (hd.size / H - 0.08) / 0.17)));
        } else grab = null;
        if (!grab) {
          var decay = Math.pow(0.5, dt / 0.6);
          spin.yaw *= decay; spin.pitch *= decay;
          view.yaw += spin.yaw * dt + (hd ? 0 : (params.spin / 100) * 0.6 * dt);
          view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + spin.pitch * dt));
        }

        var space = params.mode || 'lab';
        // The RGB cube's corners reach √3 from its center, so it is drawn smaller to fit like the others.
        var fit = space === 'rgb' ? 1 / Math.sqrt(3) : 1;
        var R = Math.min(W, H) * 0.36 * fit * (params.size / 100), cx = W / 2, cy = H / 2;
        var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        function project(v) {
          var x1 = v[0] * cyw + v[2] * syw, z1 = -v[0] * syw + v[2] * cyw;
          var y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp;
          var k = FOCAL / (FOCAL + z2);
          return [cx + x1 * R * k, cy - y2 * R * k, z2, k];
        }

        if (params.axes) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          AXES[space].forEach(function (a) {
            var p0 = project(a[0]), p1 = project(a[1]);
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
          });
          ctx.stroke();
        }

        var pts = COLORS.map(function (c) { var q = project(c.pos[space]); return { c: c, x: q[0], y: q[1], z: q[2], k: q[3] }; });
        pts.sort(function (a, b) { return b.z - a.z; }); // far to near
        var fs = Math.max(6, (params.text / 100) * 16 * u), show = params.labels / 100;
        var box = Math.max(3, 5 * u), near = null, nearD = 28 * u;
        ctx.font = '400 ' + Math.round(fs) + 'px ' + Magi.fx.MONO;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(1, u);
        pts.forEach(function (q) {
          var s = box * q.k;
          ctx.strokeStyle = q.c.css;
          ctx.fillStyle = q.c.css;
          ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, q.k);
          if (params.squares) ctx.strokeRect(q.x - s, q.y - s, s * 2, s * 2);
          if (q.c.rank < show) ctx.fillText(q.c.name, q.x + s * 1.6, q.y);
          if (tip) {
            var d = Math.hypot(q.x - tip.x, q.y - tip.y);
            if (d < nearD) { nearD = d; near = q; }
          }
        });
        ctx.globalAlpha = 1;
        if (near) {
          // The color under your fingertip, named.
          var big = Math.round(fs * 1.7);
          var label = near.c.name + '  ' + near.c.hex.toUpperCase();
          ctx.font = '400 ' + big + 'px ' + Magi.fx.MONO;
          var lw = ctx.measureText(label).width, lx = near.x + box * 3, ly = near.y - big;
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillRect(lx - big * 0.4, ly - big * 0.75, lw + big * 0.8, big * 1.5);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(near.x - box * 2, near.y - box * 2, box * 4, box * 4);
          ctx.fillStyle = near.c.css;
          ctx.fillRect(lx - big * 0.4, ly - big * 0.75, big * 0.25, big * 1.5); // the color itself, as a bar
          ctx.fillText(label, lx, ly);
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Pinch and drag to turn the colors, point to read a name, move your hand closer to zoom.');
      },
      reset: function () { last = 0; grab = null; spin = { yaw: 0, pitch: 0 }; }
    };
  }

  Magi.renderers.chromatic = createChromatic;
})();
