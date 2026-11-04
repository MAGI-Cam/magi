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
// Hand: your index fingertip turns the space (left–right spins it, up–down tips it), and the
// thumb–index spread zooms. The name nearest your fingertip lights up with its hex code.
// With no hand the space turns slowly on its own. Hold up 1, 2 or 3 fingers, still, for 0.7 s to
// switch to Lab, HSL or RGB (tapping the tile still cycles them). Pinch to grab the name under
// your fingertip and pull it out of the space; open to let it go.
// Two hands: hold one pinched and pinch with the other; moving that pinch spins the space (left–
// right spins, up–down tips, 1.6π and 0.7π across the frame, like the fingertip), and letting go
// keeps it spinning, slowing with a 0.8 s time constant. The fingertip then steers from where the
// spin left it.
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
    var offset = { yaw: 0, pitch: 0 }, vel = { yaw: 0, pitch: 0 }, spin = null, pinchedAt = {};
    var override = null, cand = null, candSince = 0, grabbed = null, switchedAt = -9;
    var SPACES = ['lab', 'hsl', 'rgb'], SPACE_NAMES = { lab: 'Lab', hsl: 'HSL', rgb: 'RGB' };
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
        var e = 1 - Math.exp(-dt / 0.12), now = frame.time / 1000;
        hands.forEach(function (h) { if (!h.pinched) delete pinchedAt[h.id]; else if (!(h.id in pinchedAt)) pinchedAt[h.id] = now; });
        // Two pinched hands: the one that pinched last spins the space by its movement.
        var both = ix.pair && ix.pair.left.pinched && ix.pair.right.pinched;
        if (both) {
          var mover = pinchedAt[ix.pair.left.id] > pinchedAt[ix.pair.right.id] ? ix.pair.left : ix.pair.right, mp = mover.points;
          var m = { x: (mp[THUMB_TIP].x + mp[INDEX_TIP].x) / 2, y: (mp[THUMB_TIP].y + mp[INDEX_TIP].y) / 2 };
          if (spin && spin.id === mover.id) {
            var dy = (m.x - spin.x) / W * Math.PI * 1.6, dp = (m.y - spin.y) / H * Math.PI * 0.7;
            view.yaw += dy; view.pitch += dp;
            vel.yaw += (dy / Math.max(dt, 1e-3) - vel.yaw) * 0.3; vel.pitch += (dp / Math.max(dt, 1e-3) - vel.pitch) * 0.3;
          }
          spin = { id: mover.id, x: m.x, y: m.y };
          grabbed = null;
        } else {
          spin = null;
          // Momentum after a spin, slowing down.
          var decay = Math.exp(-dt / 0.8);
          offset.yaw += vel.yaw * dt; offset.pitch += vel.pitch * dt;
          vel.yaw *= decay; vel.pitch *= decay;
        }
        if (hd) {
          var p = hd.points;
          tip = p[INDEX_TIP];
          var aimYaw = (tip.x / W - 0.5) * Math.PI * 1.6, aimPitch = (tip.y / H - 0.5) * Math.PI * 0.7;
          if (both) { offset.yaw = view.yaw - aimYaw; offset.pitch = view.pitch - aimPitch; }
          else {
            view.yaw += (aimYaw + offset.yaw - view.yaw) * e;
            view.pitch += (aimPitch + offset.pitch - view.pitch) * e;
          }
          // Zoom holds while pinching, so grabbing a name doesn't zoom out.
          if (!hd.pinched) view.zoom += (Math.min(1.8, Math.max(0.5, 0.55 + hd.pinchWith.index.distance * 0.7)) - view.zoom) * e;
          // 1, 2 or 3 fingers held still for 0.7 s: Lab, HSL or RGB.
          if (hd.count >= 1 && hd.count <= 3 && hd.speed < 0.3 * H && !hd.pinched) {
            if (cand !== hd.count) { cand = hd.count; candSince = now; }
            else if (now - candSince > 0.7 && (override || params.mode || 'lab') !== SPACES[cand - 1]) { override = SPACES[cand - 1]; switchedAt = now; }
          } else cand = null;
          if (!hd.pinched) grabbed = null;
        } else {
          view.yaw += (params.spin / 100) * 0.6 * dt + vel.yaw * dt;
          view.pitch += vel.pitch * dt;
          grabbed = null;
        }

        var space = override || params.mode || 'lab';
        // The RGB cube's corners reach √3 from its center, so it is drawn smaller to fit like the others.
        var fit = space === 'rgb' ? 1 / Math.sqrt(3) : 1;
        var R = Math.min(W, H) * 0.36 * fit * (params.size / 100) * view.zoom, cx = W / 2, cy = H / 2;
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
        // Names are text, so they go on the HUD layer, sharp at the screen's resolution.
        var hud = frame.hud;
        hud.font = '400 ' + Math.round(fs) + 'px ' + Magi.fx.MONO;
        hud.textBaseline = 'middle';
        ctx.lineWidth = Math.max(1, u);
        pts.forEach(function (q) {
          var s = box * q.k;
          ctx.strokeStyle = q.c.css;
          ctx.globalAlpha = hud.globalAlpha = 0.45 + 0.55 * Math.min(1, q.k);
          if (params.squares) ctx.strokeRect(q.x - s, q.y - s, s * 2, s * 2);
          if (q.c.rank < show) { hud.fillStyle = q.c.css; hud.fillText(q.c.name, q.x + s * 1.6, q.y); }
          if (tip) {
            var d = Math.hypot(q.x - tip.x, q.y - tip.y);
            if (d < nearD) { nearD = d; near = q; }
          }
        });
        ctx.globalAlpha = hud.globalAlpha = 1;
        if (hd && hd.pinched && !grabbed && near && !both) grabbed = near.c;
        if (grabbed) {
          // A grabbed name follows the pinch, tied to its place in the space by a thin line.
          var gp = hd.points, gx = (gp[THUMB_TIP].x + gp[INDEX_TIP].x) / 2, gy = (gp[THUMB_TIP].y + gp[INDEX_TIP].y) / 2;
          var home = project(grabbed.pos[space]), gb = Math.round(fs * 2.2), gl = grabbed.name + '  ' + grabbed.hex.toUpperCase();
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath(); ctx.moveTo(home[0], home[1]); ctx.lineTo(gx, gy); ctx.stroke();
          hud.font = '400 ' + gb + 'px ' + Magi.fx.MONO;
          var gw = hud.measureText(gl).width;
          hud.fillStyle = grabbed.css;
          hud.fillRect(gx - gb * 0.5, gy - gb * 1.9, gw + gb, gb * 1.5);
          var luma = parseInt(grabbed.hex.slice(1, 3), 16) * 0.299 + parseInt(grabbed.hex.slice(3, 5), 16) * 0.587 + parseInt(grabbed.hex.slice(5, 7), 16) * 0.114;
          hud.fillStyle = luma > 140 ? '#000' : '#fff'; // readable text on the color
          hud.fillText(gl, gx, gy - gb * 1.15);
          near = null;
        }
        if (now - switchedAt < 1.2) frame.say(SPACE_NAMES[space]);
        if (near) {
          // The color under your fingertip, named.
          var big = Math.round(fs * 1.7);
          var label = near.c.name + '  ' + near.c.hex.toUpperCase();
          hud.font = '400 ' + big + 'px ' + Magi.fx.MONO;
          var lw = hud.measureText(label).width, lx = near.x + box * 3, ly = near.y - big;
          hud.fillStyle = 'rgba(0,0,0,0.8)';
          hud.fillRect(lx - big * 0.4, ly - big * 0.75, lw + big * 0.8, big * 1.5);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(near.x - box * 2, near.y - box * 2, box * 4, box * 4);
          hud.fillStyle = near.c.css;
          hud.fillRect(lx - big * 0.4, ly - big * 0.75, big * 0.25, big * 1.5); // the color itself, as a bar
          hud.fillText(label, lx, ly);
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Point to turn the colors, spread to zoom, pinch to grab a name, hold up 1–3 fingers to change space.');
      },
      reset: function () { last = 0; override = null; cand = null; grabbed = null; spin = null; offset = { yaw: 0, pitch: 0 }; vel = { yaw: 0, pitch: 0 }; pinchedAt = {}; }
    };
  }

  Magi.renderers.chromatic = createChromatic;
})();
