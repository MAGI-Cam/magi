// Accordion: a bellows of colored panels stretched between your hands.
//
// The panels stand upright on the line between your two palms (the mean of the wrist and four
// knuckles), in two stacks, one at each hand, with the middle left open.
// The panel count grows with the distance between your hands, so the bellows unfolds as you
// pull apart and folds down to two panels as you bring your hands together. Within a stack,
// panels shrink toward the middle by 1 − w·k^0.8 (k = 0 at the hand, 1 at the inner end), and
// that waist w deepens the farther apart you pull. Each panel is drawn in oblique projection: vertical sides,
// with its depth slanting up and back at 30°, so the stack reads as 3D without a separate scene.
//
// Hands (Interaction Engine): the color gradient starts at your left hand, whichever side of the
// screen it is on. When one hand is clearly closer to the camera (its palm looks at least 20%
// bigger, switching back below 10%), the bellows stretches in depth toward it: panels scale in
// perspective from the far hand's relative palm size up to full size at the near hand, turn to
// face the camera, and are drawn far to near. Rolling your palms (their mean rotation) tilts the
// panels by 0.6 × that angle. Pinch and hold to drift the color around the hue wheel (both hands: twice as fast).
(function () {
  var WRIST = 0, MIDDLE_TIP = 12;
  var DEPTH = [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)];
  var STACK = 0.36; // share of the span each stack of panels covers

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function createAccordion() {
    var state = null, last = 0, hueAcc = 0;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), pair = ix.pair, hands = ix.hands;

        // Pinch and hold: the color drifts around the hue wheel, 12% of the wheel per second with
        // one hand pinching and twice that with both, and the Color slider follows.
        var pinching = hands.filter(function (h) { return h.pinched; }).length;
        if (pinching) {
          hueAcc += dt * 12 * pinching;
          var step = Math.floor(hueAcc);
          if (step >= 1) {
            hueAcc -= step;
            var c = params.color > 0 ? params.color : 0;
            frame.setParam('color', c + step > 99 ? 1 + (c + step - 100) % 99 : c + step);
          }
        } else hueAcc = 0;

        if (pair) {
          // The gradient starts at your left hand (handedness, not screen side). The closer hand
          // (palm at least 20% bigger, Interaction Engine) pulls the bellows into depth toward it.
          var A = pair.left, B = pair.right, near = pair.closer;
          var size = (Math.hypot(A.points[MIDDLE_TIP].x - A.points[WRIST].x, A.points[MIDDLE_TIP].y - A.points[WRIST].y) +
            Math.hypot(B.points[MIDDLE_TIP].x - B.points[WRIST].x, B.points[MIDDLE_TIP].y - B.points[WRIST].y)) / 2;
          var ratio = Math.min(A.size, B.size) / Math.max(A.size, B.size);
          var roll = (A.rotation + B.rotation) / 2 * Math.PI / 180;
          var want = {
            ax: A.center.x, ay: A.center.y, bx: B.center.x, by: B.center.y, size: size, roll: roll,
            depth: near ? 1 : 0, nearB: near === B ? 1 : 0, ratio: near ? ratio : 1
          };
          if (!state) state = want;
          var e = 1 - Math.exp(-dt / 0.07), ed = 1 - Math.exp(-dt / 0.25);
          Object.keys(want).forEach(function (k) {
            state[k] += (want[k] - state[k]) * (k === 'depth' || k === 'nearB' || k === 'ratio' ? ed : e);
          });
        } else {
          state = null;
        }

        if (state) {
          var dx = state.bx - state.ax, dy = state.by - state.ay, d = Math.hypot(dx, dy), dn = d / W;
          var density = 4 + params.panels * 0.6;
          var count = Math.max(2, Math.min(48, Math.round(2 + dn * density)));
          var waist = (params.waist / 100) * smoothstep(0.08, 0.5, dn);
          var hBase = state.size * (params.size / 50) * 1.15;
          var hue0 = params.color > 0 ? ((params.color - 1) / 98) * 360 : 0;
          var sat = params.color > 0 && params.color < 100 ? 72 : 0, black = params.color >= 100;

          // Two stacks, one at each hand, each covering STACK of the span and shrinking toward the
          // open middle.
          var perSide = Math.max(1, Math.round(count / 2)), panels = [];
          for (var side = 0; side < 2; side++) {
            for (var i = 0; i < perSide; i++) {
              var k = perSide > 1 ? i / (perSide - 1) : 0;             // 0 at the hand, 1 at the inner end
              var t = side === 0 ? k * STACK : 1 - k * STACK;
              var s = 1 - waist * Math.pow(k, 0.8);
              // Depth: perspective scale from the far hand (its palm's relative size) to the near one.
              var toNear = state.nearB * t + (1 - state.nearB) * (1 - t);
              var persp = 1 + (state.ratio + (1 - state.ratio) * toNear - 1) * state.depth;
              panels.push({ x: state.ax + dx * t, y: state.ay + dy * t, h: hBase * s * persp, t: t, near: toNear });
            }
          }
          // Left to right; in depth, far to near so nearer panels cover farther ones.
          panels.sort(function (a, b) { return state.depth > 0.5 ? a.near - b.near : a.t - b.t; });

          ctx.save();
          ctx.lineJoin = 'round';
          // Fill at the chosen opacity; the outline stays at full strength, a crisp black line
          // with mitred corners, so panels read cleanly even when see-through.
          ctx.strokeStyle = '#000';
          ctx.lineJoin = 'miter';
          ctx.lineWidth = Math.max(1, 1.25 * u);
          panels.forEach(function (pn) {
            // In depth the panels turn toward the camera (wider, less slant); roll tilts them.
            var w = pn.h * (0.72 + 0.35 * state.depth), slant = 1 - 0.6 * state.depth;
            var hx = DEPTH[0] * w / 2, hy = DEPTH[1] * w / 2 * slant;
            ctx.save();
            ctx.translate(pn.x, pn.y);
            ctx.rotate(state.roll * 0.6);
            ctx.translate(-pn.x, -pn.y);
            var hue = (hue0 + pn.t * params.spread * 3.6) % 360;
            var light = black ? 6 + 14 * pn.t : sat ? 48 + 10 * Math.sin(pn.t * Math.PI * 3) : 92 - 30 * pn.t;
            ctx.fillStyle = 'hsl(' + hue.toFixed(1) + ',' + sat + '%,' + light.toFixed(1) + '%)';
            ctx.beginPath();
            ctx.moveTo(pn.x - hx, pn.y - pn.h / 2 - hy);
            ctx.lineTo(pn.x + hx, pn.y - pn.h / 2 + hy);
            ctx.lineTo(pn.x + hx, pn.y + pn.h / 2 + hy);
            ctx.lineTo(pn.x - hx, pn.y + pn.h / 2 - hy);
            ctx.closePath();
            ctx.globalAlpha = params.opacity / 100;
            ctx.fill();
            ctx.globalAlpha = 1;
            if (params.outline) ctx.stroke();
            ctx.restore();
          });

          if (params.line) {
            // The measurement itself: a hairline between the palms with the normalized distance.
            ctx.strokeStyle = '#fff';
            ctx.fillStyle = '#fff';
            ctx.lineWidth = Math.max(1, u);
            var lift = hBase * 0.75, p0 = [state.ax, state.ay - lift], p1 = [state.bx, state.by - lift];
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            ctx.stroke();
            [p0, p1].forEach(function (q) {
              ctx.beginPath();
              ctx.arc(q[0], q[1], Math.max(2, 3 * u), 0, Math.PI * 2);
              ctx.fill();
            });
            var hud = frame.hud;
            hud.fillStyle = '#fff';
            hud.font = '400 ' + Math.round(12 * u) + 'px ' + Magi.fx.MONO;
            hud.textAlign = 'left';
            hud.textBaseline = 'bottom';
            hud.fillText('distance ' + dn.toFixed(2), p0[0], p0[1] - 6 * u);
          }
          ctx.restore();
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (hands.length < 2) Magi.tracking.hint(ctx, frame, 'Hold up both hands, palms to the camera. Pull apart to open; bring one hand closer to stretch it in depth.');
      },
      reset: function () { state = null; last = 0; }
    };
  }

  Magi.renderers.accordion = createAccordion;
})();
