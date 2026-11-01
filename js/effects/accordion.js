// Accordion: a bellows of colored panels stretched between your hands.
//
// The panels stand upright on the line between your two palms (the mean of the wrist and four
// knuckles), in two stacks, one at each hand, with the middle left open for a tangle of wires.
// The panel count grows with the distance between your hands, so the bellows unfolds as you
// pull apart and folds down to two panels as you bring your hands together. Within a stack,
// panels shrink toward the middle by 1 − w·k^0.8 (k = 0 at the hand, 1 at the inner end), and
// that waist w deepens the farther apart you pull. Each panel is drawn in oblique projection: vertical sides,
// with its depth slanting up and back at 30°, so the stack reads as 3D without a separate scene.
(function () {
  var PALM = [0, 5, 9, 13, 17], WRIST = 0, MIDDLE_TIP = 12;
  var DEPTH = [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)];
  var STACK = 0.36; // share of the span each stack of panels covers

  function palmCenter(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x; y += p[i].y; });
    return { x: x / PALM.length, y: y / PALM.length };
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function createAccordion() {
    var state = null, last = 0;
    // Wire shapes in the open middle: fixed random phases, animated by time.
    var wires = [];
    for (var i = 0; i < 7; i++) wires.push({ a: Math.random() * 6.28, b: Math.random() * 6.28, k: 0.6 + Math.random() * 0.9, y0: Math.random() - 0.5, y1: Math.random() - 0.5 });

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, time = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame);

        if (hands.length >= 2) {
          var A = palmCenter(hands[0]), B = palmCenter(hands[1]);
          var size = (Math.hypot(hands[0][MIDDLE_TIP].x - hands[0][WRIST].x, hands[0][MIDDLE_TIP].y - hands[0][WRIST].y) +
            Math.hypot(hands[1][MIDDLE_TIP].x - hands[1][WRIST].x, hands[1][MIDDLE_TIP].y - hands[1][WRIST].y)) / 2;
          if (A.x > B.x) { var t0 = A; A = B; B = t0; }
          var want = { ax: A.x, ay: A.y, bx: B.x, by: B.y, size: size };
          if (!state) state = want;
          var e = 1 - Math.exp(-dt / 0.07);
          Object.keys(want).forEach(function (k) { state[k] += (want[k] - state[k]) * e; });
        } else {
          state = null;
        }

        if (state) {
          var dx = state.bx - state.ax, dy = state.by - state.ay, d = Math.hypot(dx, dy), dn = d / W;
          var density = 4 + params.panels * 0.6;
          var count = Math.max(2, Math.min(48, Math.round(2 + dn * density)));
          var waist = (params.waist / 100) * smoothstep(0.08, 0.5, dn);
          var hBase = state.size * (params.size / 50) * 1.15;
          var hue0 = params.color > 0 ? ((params.color - 1) / 99) * 360 : 0;
          var sat = params.color > 0 ? 72 : 0;

          // Two stacks, one at each hand, each covering STACK of the span and shrinking toward the
          // open middle; the gap between them is where the wires tangle.
          var perSide = Math.max(1, Math.round(count / 2)), panels = [];
          for (var side = 0; side < 2; side++) {
            for (var i = 0; i < perSide; i++) {
              var k = perSide > 1 ? i / (perSide - 1) : 0;             // 0 at the hand, 1 at the inner end
              var t = side === 0 ? k * STACK : 1 - k * STACK;
              var s = 1 - waist * Math.pow(k, 0.8);
              panels.push({ x: state.ax + dx * t, y: state.ay + dy * t, h: hBase * s, t: t });
            }
          }
          panels.sort(function (a, b) { return a.t - b.t; }); // draw left to right
          var innerL = panels[perSide - 1], innerR = panels[perSide];

          ctx.save();
          ctx.lineJoin = 'round';
          if (params.wires && perSide > 1) {
            // Thin wires tangled through the open middle, between the two innermost panels.
            var L = innerL, R = innerR;
            var amp = Math.max(L.h, R.h) * 0.6;
            ctx.strokeStyle = 'rgba(0,0,0,0.9)';
            ctx.lineWidth = Math.max(1, 1.3 * u);
            ctx.beginPath();
            wires.forEach(function (wv) {
              var y0 = L.y + wv.y0 * L.h * 0.5, y1 = R.y + wv.y1 * R.h * 0.5;
              ctx.moveTo(L.x, y0);
              ctx.bezierCurveTo(
                L.x + (R.x - L.x) * 0.33, y0 + Math.sin(time * wv.k + wv.a) * amp,
                L.x + (R.x - L.x) * 0.66, y1 + Math.cos(time * wv.k + wv.b) * amp,
                R.x, y1);
            });
            ctx.stroke();
          }
          ctx.globalAlpha = params.opacity / 100;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = Math.max(1, 1.1 * u);
          panels.forEach(function (pn) {
            var w = pn.h * 0.72, hx = DEPTH[0] * w / 2, hy = DEPTH[1] * w / 2;
            var hue = (hue0 + pn.t * params.spread * 3.6) % 360;
            var light = sat ? 48 + 10 * Math.sin(pn.t * Math.PI * 3) : 92 - 30 * pn.t;
            ctx.fillStyle = 'hsl(' + hue.toFixed(1) + ',' + sat + '%,' + light.toFixed(1) + '%)';
            ctx.beginPath();
            ctx.moveTo(pn.x - hx, pn.y - pn.h / 2 - hy);
            ctx.lineTo(pn.x + hx, pn.y - pn.h / 2 + hy);
            ctx.lineTo(pn.x + hx, pn.y + pn.h / 2 + hy);
            ctx.lineTo(pn.x - hx, pn.y + pn.h / 2 - hy);
            ctx.closePath();
            ctx.fill();
            if (params.outline) ctx.stroke();
          });
          ctx.globalAlpha = 1;

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
            ctx.font = '400 ' + Math.round(12 * u) + 'px ' + Magi.fx.MONO;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('distance ' + dn.toFixed(2), p0[0], p0[1] - 6 * u);
          }
          ctx.restore();
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (hands.length < 2) Magi.tracking.hint(ctx, frame, 'Hold up both hands, palms to the camera. Pull apart to open.');
      },
      reset: function () { state = null; last = 0; }
    };
  }

  Magi.renderers.accordion = createAccordion;
})();
