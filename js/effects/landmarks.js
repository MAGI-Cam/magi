// Landmarks: the tracking itself, drawn over the camera, with the measurements effects can use.
// Hands: MediaPipe's 21-point skeleton per hand (green bones, red joints), handedness and score,
// pinch (thumb tip to index tip, divided by palm length so it doesn't change with distance),
// rotation (wrist → middle knuckle, 0° = pointing up) and the distance between two hands.
// Fingers: the gap between each pair of neighboring fingertips, in palm lengths. Pairs: lines
// between matching fingertips of the left and right hands, as a share of the frame width.
// Signals: what the Interaction Engine (js/interaction.js) reads from each hand: finger count and
// which fingers are extended, curl, spread, pointing or fist, pinches to each finger, size,
// speed and the latest swipe, flick or shake.
// Face: the 478-point mesh, MediaPipe's eye, iris, brow, lip and oval contours, head pose
// (yaw, pitch, roll from the face transform) and the strongest of the 52 blendshapes.
(function () {
  var WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_MCP = 9, PALM = [0, 5, 9, 13, 17], TIPS = [4, 8, 12, 16, 20];

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Readout boxes go on the HUD layer, so their text is sharp at the screen's resolution.
  function label(ctx, frame, lines, x, y) {
    ctx = frame.hud;
    var s = Math.round(11 * frame.pxPerCss), pad = Math.round(s * 0.5), lh = Math.round(s * 1.35);
    ctx.save();
    ctx.font = '400 ' + s + 'px ' + Magi.fx.MONO;
    ctx.textBaseline = 'top';
    var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + pad * 2;
    var h = lines.length * lh + pad * 2 - (lh - s);
    x = Math.min(frame.width - w - pad, Math.max(pad, x));
    y = Math.min(frame.height - h - pad, Math.max(pad, y));
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    lines.forEach(function (l, i) { ctx.fillText(l, x + pad, y + pad + i * lh); });
    ctx.restore();
  }

  function connect(ctx, pts, pairs) {
    ctx.beginPath();
    pairs.forEach(function (c) {
      var a = pts[c.start], b = pts[c.end];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();
  }

  function palmCenter(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x; y += p[i].y; });
    return { x: x / PALM.length, y: y / PALM.length };
  }

  function createHands() {
    var lastEvent = {};
    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height, u = frame.pxPerCss;
        if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, w, h);
        var tracker = Magi.tracking.hands;
        var hands = tracker.detect(frame), info = tracker.details(), C = Magi.tracking.connections;
        var ix = Magi.interaction.read(frame);
        if (params.signals) ix.events.forEach(function (e) { lastEvent[e.hand] = e; });

        hands.forEach(function (p, i) {
          if (C) {
            ctx.strokeStyle = 'rgb(48,255,48)';
            ctx.lineWidth = Math.max(1, 2.5 * u);
            connect(ctx, p, C.hand);
          }
          ctx.fillStyle = 'rgb(255,40,40)';
          p.forEach(function (q) {
            ctx.beginPath();
            ctx.arc(q.x, q.y, Math.max(1.5, 3.5 * u), 0, Math.PI * 2);
            ctx.fill();
          });
          var sig = ix.hands[i];
          var pinch = sig ? sig.pinchWith.index.distance : dist(p[THUMB_TIP], p[INDEX_TIP]) / (dist(p[WRIST], p[MIDDLE_MCP]) || 1);
          var rot = sig ? sig.rotation : 0;
          if (params.pinch) {
            // Pinch line between thumb and index tips.
            ctx.save();
            ctx.setLineDash([4 * u, 4 * u]);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = Math.max(1, u);
            ctx.beginPath();
            ctx.moveTo(p[THUMB_TIP].x, p[THUMB_TIP].y);
            ctx.lineTo(p[INDEX_TIP].x, p[INDEX_TIP].y);
            ctx.stroke();
            ctx.restore();
          }
          var d = info[i] || { label: 'Hand', score: 0 }, lines = [];
          if (params.readouts) lines.push(d.label + '  ' + d.score.toFixed(2));
          if (params.pinch) lines.push('pinch    ' + pinch.toFixed(2) + (sig && sig.pinched ? '  closed' : ''));
          if (params.readouts) lines.push('rotation ' + (rot >= 0 ? ' ' : '') + rot.toFixed(0) + '°');
          if (params.signals && sig) {
            // What the Interaction Engine reads from this hand.
            var f = sig.fingers;
            lines.push('fingers  ' + sig.count + '  ' + ['thumb', 'index', 'middle', 'ring', 'pinky'].map(function (n) {
              return f[n].extended ? n.charAt(0).toUpperCase() : '·';
            }).join(' '));
            lines.push('curl     ' + ['thumb', 'index', 'middle', 'ring', 'pinky'].map(function (n) { return f[n].curl.toFixed(1); }).join(' '));
            lines.push('spread   ' + sig.spread.toFixed(2) + (sig.pointing ? '  pointing' : sig.fist ? '  fist' : ''));
            lines.push('pinch to ' + ['middle', 'ring', 'pinky'].map(function (n) { return n.charAt(0) + (sig.pinchWith[n].on ? '●' : '○'); }).join(' '));
            lines.push('size     ' + Math.round(sig.size) + ' px' + (ix.pair && ix.pair.closer === sig ? '  closer' : ''));
            lines.push('speed    ' + (sig.speed / frame.height).toFixed(1) + ' h/s');
            var e = lastEvent[sig.id];
            if (e && frame.time / 1000 - e.t < 1.5) lines.push('motion   ' + e.type + (e.dir ? ' ' + e.dir : ''));
          }
          if (lines.length) label(ctx, frame, lines, p[WRIST].x + 14 * u, p[WRIST].y + 10 * u);
        });

        // Fingers: the gaps between neighboring fingertips on each hand, in palm lengths.
        // Pairs: matching fingertips of the left and right hands, as a share of the frame width.
        if (params.fingers || (params.pairs && hands.length === 2)) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = Math.max(1, u);
          ctx.setLineDash([3 * u, 3 * u]);
          var marks = [];
          if (params.fingers) hands.forEach(function (p) {
            var palm = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
            for (var k = 0; k < TIPS.length - 1; k++) marks.push([p[TIPS[k]], p[TIPS[k + 1]], (dist(p[TIPS[k]], p[TIPS[k + 1]]) / palm).toFixed(2)]);
          });
          if (params.pairs && hands.length === 2) {
            var sides = ix.pair ? [ix.pair.left.points, ix.pair.right.points] : hands;
            TIPS.forEach(function (t) { marks.push([sides[0][t], sides[1][t], (dist(sides[0][t], sides[1][t]) / w).toFixed(2)]); });
          }
          ctx.beginPath();
          marks.forEach(function (m) { ctx.moveTo(m[0].x, m[0].y); ctx.lineTo(m[1].x, m[1].y); });
          ctx.stroke();
          ctx.setLineDash([]);
          var fsz = Math.round(9 * u), hud = frame.hud;
          hud.font = '400 ' + fsz + 'px ' + Magi.fx.MONO;
          hud.textAlign = 'center';
          hud.textBaseline = 'middle';
          marks.forEach(function (m) {
            var mx = (m[0].x + m[1].x) / 2, my = (m[0].y + m[1].y) / 2, tw = hud.measureText(m[2]).width + fsz * 0.6;
            hud.fillStyle = 'rgba(0,0,0,0.62)';
            hud.fillRect(mx - tw / 2, my - fsz * 0.7, tw, fsz * 1.4);
            hud.fillStyle = '#fff';
            hud.fillText(m[2], mx, my);
          });
          ctx.restore();
        }

        if (params.distance && hands.length === 2) {
          var a = palmCenter(hands[0]), b = palmCenter(hands[1]);
          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
          label(ctx, frame, ['distance ' + (dist(a, b) / w).toFixed(2)], (a.x + b.x) / 2 - 40 * u, (a.y + b.y) / 2 - 24 * u);
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!hands.length) Magi.tracking.hint(ctx, frame, 'Raise a hand.');
      },
      reset: function () {}
    };
  }

  // Head pose from the 4×4 column-major face transform, as R = Ry(yaw)·Rx(pitch)·Rz(roll).
  function pose(m, mirror) {
    var yaw = Math.atan2(m[8], m[10]), pitch = Math.asin(Math.max(-1, Math.min(1, -m[9])));
    var roll = Math.atan2(m[1], m[5]), k = 180 / Math.PI, s = mirror ? -1 : 1;
    return { yaw: s * yaw * k, pitch: pitch * k, roll: s * roll * k };
  }

  function signed(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(0) + '°'; }

  function createFace() {
    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height, u = frame.pxPerCss;
        if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, w, h);
        var tracker = Magi.tracking.face;
        var faces = tracker.detect(frame), info = tracker.details(), C = Magi.tracking.connections;

        faces.forEach(function (p, i) {
          if (C) {
            if (params.mesh) {
              ctx.strokeStyle = 'rgba(210,210,210,0.55)';
              ctx.lineWidth = Math.max(0.5, 0.75 * u);
              connect(ctx, p, C.tesselation);
            }
            ctx.lineWidth = Math.max(1, 1.6 * u);
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            connect(ctx, p, C.faceOval);
            connect(ctx, p, C.lips);
            connect(ctx, p, C.leftEyebrow);
            connect(ctx, p, C.rightEyebrow);
            ctx.strokeStyle = 'rgb(255,48,48)';
            connect(ctx, p, C.rightEye);
            connect(ctx, p, C.rightIris);
            ctx.strokeStyle = 'rgb(48,255,48)';
            connect(ctx, p, C.leftEye);
            connect(ctx, p, C.leftIris);
          }
          var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          p.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1, u);
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
          if (!params.readouts) return;
          var d = info[i] || {};
          var lines = ['Face  ' + p.length + ' points'];
          if (d.matrix) {
            var a = pose(d.matrix, frame.mirror);
            lines.push('yaw ' + signed(a.yaw) + '  pitch ' + signed(a.pitch) + '  roll ' + signed(a.roll));
          }
          (d.blendshapes || []).filter(function (c) { return c.categoryName !== '_neutral'; })
            .sort(function (a, b) { return b.score - a.score; }).slice(0, 5)
            .forEach(function (c) {
              var bar = '';
              for (var k = 0; k < 10; k++) bar += k < Math.round(c.score * 10) ? '█' : '·';
              lines.push(bar + ' ' + c.score.toFixed(2) + ' ' + c.categoryName);
            });
          label(ctx, frame, lines, x1 + 12 * u, y0);
        });

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'face');
        else if (!faces.length) Magi.tracking.hint(ctx, frame, 'Look into the camera.');
      },
      reset: function () {}
    };
  }

  Magi.renderers['hand-landmarks'] = createHands;
  Magi.renderers['face-landmarks'] = createFace;
})();
