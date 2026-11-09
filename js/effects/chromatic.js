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
// Hands (the space is untethered: it stays where you leave it and only moves when you act on it):
//   Point and hold (index out, the others in, 0.3 s on the same color): selects the name nearest
//     your fingertip; it stays highlighted with its hex code until you select another. A new
//     nearest name only takes over when it is clearly nearer (30%), so it doesn't flicker.
//   Pinch with one hand: grabs the space. Dragging turns it like a trackball: left–right about the
//     vertical (y) axis, up–down about the horizontal (x) axis, 1.6π and 0.9π across the frame.
//     Let go and it keeps turning, slowing with a 0.8 s time constant (v ← v·e^(−dt/0.8)).
//     Pinching on a name selects it too.
//   Pinch with both hands: zoom like a photo on a phone. The zoom is the distance between the two
//     pinches over its distance when the second pinch closed, zoom = zoom₀·d/d₀ (0.4×–5×). The gap
//     between two hands is large next to tracking noise, so it holds steady.
//   Swipe: left or right flings the space into a spin; up or down switches to the next space.
// With no hand the space turns slowly on its own (Spin). Tapping the tile cycles the spaces too.
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
    var vel = { yaw: 0, pitch: 0 }, grab = null, pinchedAt = {}, zoomRef = null, selected = null, lastSwipe = 0, cand = null, candAt = 0, wantZoom = 1;
    var override = null, switchedAt = -9;
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

        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), hands = ix.hands, now = frame.time / 1000;
        hands.forEach(function (h) { if (!h.pinched) delete pinchedAt[h.id]; else if (!(h.id in pinchedAt)) pinchedAt[h.id] = now; });
        var mid = function (h) { var q = h.points; return { x: (q[THUMB_TIP].x + q[INDEX_TIP].x) / 2, y: (q[THUMB_TIP].y + q[INDEX_TIP].y) / 2 }; };
        var pinchers = hands.filter(function (h) { return h.pinched; });
        // Two pinches: phone-style zoom (no turning meanwhile).
        if (pinchers.length >= 2) {
          var pa = mid(pinchers[0]), pb = mid(pinchers[1]), dd = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
          if (!zoomRef) zoomRef = { d: dd, zoom: wantZoom };
          wantZoom = Math.max(0.4, Math.min(5, zoomRef.zoom * dd / zoomRef.d));
          grab = null; vel.yaw = vel.pitch = 0;
        } else zoomRef = null;
        view.zoom += (wantZoom - view.zoom) * (1 - Math.exp(-dt / 0.1));
        // One pinch: grab and turn.
        var grabber = pinchers.length === 1 ? pinchers[0] : null, startedGrab = false;
        if (grabber) {
          var m = mid(grabber);
          if (grab && grab.id === grabber.id) {
            var dy = (m.x - grab.x) / W * Math.PI * 1.6, dp = (m.y - grab.y) / H * Math.PI * 0.9;
            view.yaw += dy; view.pitch += dp;
            vel.yaw += (dy / Math.max(dt, 1e-3) - vel.yaw) * 0.3; vel.pitch += (dp / Math.max(dt, 1e-3) - vel.pitch) * 0.3;
          } else { startedGrab = true; vel.yaw = vel.pitch = 0; }
          grab = { id: grabber.id, x: m.x, y: m.y };
        } else if (pinchers.length < 2) {
          grab = null;
          var decay = Math.exp(-dt / 0.8);
          view.yaw += vel.yaw * dt; view.pitch += vel.pitch * dt;
          vel.yaw *= decay; vel.pitch *= decay;
          if (!hands.length) view.yaw += (params.spin / 100) * 0.6 * dt;
        }
        view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch));
        ix.events.forEach(function (ev) {
          if (ev.type !== 'swipe' || ev.n === lastSwipe || pinchers.length) return;
          lastSwipe = ev.n;
          if (ev.dir === 'left' || ev.dir === 'right') vel.yaw = (ev.dir === 'right' ? 1 : -1) * 6;
          else { override = SPACES[(SPACES.indexOf(override || params.mode || 'lab') + 1) % 3]; switchedAt = now; }
        });
        // Pointing: index out, middle and ring in, not pinched.
        var pointer = null;
        hands.forEach(function (h) { if (!pointer && !h.pinched && h.fingers.index.extended && !h.fingers.middle.extended && !h.fingers.ring.extended) pointer = h; });
        var tip = pointer ? pointer.points[INDEX_TIP] : startedGrab ? mid(grabber) : null;

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
        // Selecting: at the start of a pinch, at once; pointing, after 0.3 s on the same name, and a
        // new nearest name only replaces the candidate when it is 30% nearer.
        var candD = function () { var cq = project(cand.pos[space]); return Math.hypot(cq[0] - tip.x, cq[1] - tip.y); };
        if (startedGrab && near) selected = near.c;
        else if (pointer && near) {
          if (!cand || (cand !== near.c && nearD < 0.7 * candD())) { cand = near.c; candAt = now; }
          if (cand && now - candAt > 0.3) selected = cand;
        } else if (!pointer) cand = null;
        if (now - switchedAt < 1.2) frame.say(SPACE_NAMES[space]);
        if (selected) {
          // The selected color, highlighted where it sits in the space, named with its hex code.
          var sq = project(selected.pos[space]), big = Math.round(fs * 1.7), sb = box * 2 * sq[3];
          var label = selected.name + '  ' + selected.hex.toUpperCase();
          hud.font = '400 ' + big + 'px ' + Magi.fx.MONO;
          var lw = hud.measureText(label).width, lx = sq[0] + box * 3, ly = sq[1] - big;
          ctx.fillStyle = selected.css;
          ctx.fillRect(sq[0] - sb, sq[1] - sb, sb * 2, sb * 2);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(sq[0] - sb * 1.6, sq[1] - sb * 1.6, sb * 3.2, sb * 3.2);
          hud.fillStyle = 'rgba(0,0,0,0.8)';
          hud.fillRect(lx - big * 0.4, ly - big * 0.75, lw + big * 0.8, big * 1.5);
          hud.fillStyle = selected.css;
          hud.fillRect(lx - big * 0.4, ly - big * 0.75, big * 0.25, big * 1.5); // the color itself, as a bar
          hud.fillText(label, lx, ly);
        }
        if (pointer) {
          var pt0 = pointer.points[INDEX_TIP];
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath(); ctx.arc(pt0.x, pt0.y, 6 * u, 0, Math.PI * 2); ctx.stroke();
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Pinch and drag to turn the colors, point and hold to pick one, pinch with both hands to zoom.');
      },
      reset: function () { last = 0; override = null; grab = null; zoomRef = null; selected = null; vel = { yaw: 0, pitch: 0 }; pinchedAt = {}; }
    };
  }

  Magi.renderers.chromatic = createChromatic;
})();
