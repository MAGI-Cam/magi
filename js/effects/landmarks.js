// Landmarks: the tracking itself, drawn over the camera, with the measurements effects can use.
// Hands: MediaPipe's 21-point skeleton per hand (green bones, red joints), handedness and score,
// pinch (thumb tip to index tip, divided by palm length so it doesn't change with distance),
// rotation (wrist → middle knuckle, 0° = pointing up) and the distance between two hands.
// Modes: Skeleton (the readouts below), Controller (each hand as a control surface: thumb–index
// circle and value, ruler, ring stacks, fingertip constellation, value bars) and Link (index-to-index line,
// h1/h2 tags, a radial scope of fingertip angles and distances); Contour, Filaments and Attention
// live in js/effects/landmark-modes.js.
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
    var extra = {}, lastEvent = {}, trails = [[], []], joints = [null, null], values = [[], []], radius = [0, 0], holdAt = 0, lastT = null, box = null, lastIx = null;

    // Controller (after the VCV Rack reference): each hand read as a control surface. A circle
    // spans the thumb and index fingertips (its diameter is their distance, so it grows as they
    // open) and carries its value, x as a share of the frame width, printed at full precision on
    // a leader line; a ruler along the bottom takes a drop line from it like a slider's handle.
    // The circle is a thin outline while the hand is open and fills as the pinch closes:
    // fill alpha = Opacity × pinch (the Interaction Engine's 0 open … 1 touching). Only the index
    // up (thumb tucked): it shrinks to a solid pointer dot on the fingertip and keeps sliding.
    // A second hand gets its own controller (on screen, the left hand is 1, the right hand 2),
    // with its leader and ring stack on the right. Ring stacks swell with each hand's openness,
    // a traveling wave like a level meter.
    // Node map (right): the hand redrawn small, its 21 joints and bones, with each fingertip's
    // last 1.5 s of positions (every camera frame) trailing behind as a smooth Catmull-Rom curve.
    // The map's frame follows the points' bounding box with easing (time constant 0.4 s), so it
    // drifts instead of jumping.
    // Graph (top right): the value as a sample-and-hold signal, like an oscilloscope on its side:
    // held every 0.25 s, each hold a step whose width is the value, scrolling down from the top
    // past a vertical axis with ticks, so the steps form one solid staircase. Hand 2 grows to the
    // left of the axis.
    var HOLD = 0.25, TRAIL = 45;
    function catmull(ctx, pts) {
      // Catmull-Rom through the points, as cubic Béziers: c1 = p1 + (p2 − p0)/6, c2 = p2 − (p3 − p1)/6.
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
    }
    function controller(ctx, frame, ix, u, params) {
      var W = frame.width, H = frame.height, t = frame.time / 1000, hud = frame.hud;
      var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      var hs = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands.slice(0, 1);
      var lw = Math.max(1, u), fs = Math.round(11 * u), ry = H * 0.9, fresh = ix !== lastIx, hold = t - holdAt >= HOLD;
      if (hold) holdAt = t;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = lw;
      // Ruler.
      ctx.beginPath();
      ctx.moveTo(0, ry); ctx.lineTo(W, ry);
      for (var k = 0; k <= 16; k++) { var tx = W * k / 16; ctx.moveTo(tx, ry); ctx.lineTo(tx, ry - 10 * u); }
      ctx.stroke();
      hud.font = '600 ' + fs + 'px ' + Magi.fx.MONO;
      hud.fillStyle = '#fff';
      hud.textBaseline = 'bottom';
      var open = [0, 0], live = [null, null];
      hs.forEach(function (hd, slot) {
        var p = hd.points, ti = p[THUMB_TIP], ii = p[INDEX_TIP], right = slot === 1;
        var pointer = hd.pointing && !hd.fingers.thumb.extended;
        var bx = pointer ? ii.x : (ti.x + ii.x) / 2, by = pointer ? ii.y : (ti.y + ii.y) / 2;
        var target = pointer ? 3.5 * u : Math.max(3.5 * u, dist(ti, ii) / 2);
        radius[slot] = radius[slot] ? radius[slot] + (target - radius[slot]) * 0.35 : target;
        var br = radius[slot], value = bx / W;
        live[slot] = value;
        open[slot] = pointer ? 0 : Math.min(1, hd.pinchWith.index.distance / 1.2);
        // Drop line and ruler marker, leader line from the side, value.
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.moveTo(bx, by + br); ctx.lineTo(bx, ry); ctx.stroke();
        ctx.fillRect(bx - 3 * u, ry - 3 * u, 6 * u, 6 * u);
        var lx = right ? W * 0.92 : W * 0.08;
        ctx.beginPath(); ctx.moveTo(lx, by); ctx.lineTo(right ? bx + br : bx - br, by); ctx.stroke();
        // The circle: outline always, fill growing with the pinch up to Opacity.
        var fill = (params.opacity / 100) * (pointer ? 1 : hd.pinch);
        ctx.fillStyle = 'rgba(255,255,255,' + fill.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        hud.textAlign = right ? 'right' : 'left';
        hud.fillText(String(value), lx, by - 4 * u);
        if (fresh) {
          [4, 8, 12, 16, 20].forEach(function (tp, j) {
            var tr = trails[slot][j] || (trails[slot][j] = []);
            tr.push([p[tp].x, p[tp].y]);
            if (tr.length > TRAIL) tr.shift();
          });
          joints[slot] = p.map(function (q) { return [q.x, q.y]; });
        }
        if (hold) { values[slot].push(value); if (values[slot].length > 16) values[slot].shift(); }
      });
      if (hs.length < 2) { trails[1] = []; values[1] = []; radius[1] = 0; joints[1] = null; }
      if (!hs.length) { radius[0] = 0; }
      lastIx = ix;
      // Ring stacks: 26 ellipses down the edge, widths a traveling wave scaled by openness.
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      [0, 1].forEach(function (slot) {
        if (slot === 1 && hs.length < 2) return;
        var cx = slot ? W * 0.94 : W * 0.06, n = 26;
        for (var i = 0; i < n; i++) {
          var yy = H * 0.12 + (H * 0.7) * i / (n - 1);
          var r = W * 0.035 * (0.15 + (0.25 + open[slot]) * Math.abs(Math.sin(i * 0.45 - t * 3)));
          ctx.moveTo(cx + r, yy);
          ctx.ellipse(cx, yy, r, r * 0.32, 0, 0, Math.PI * 2);
        }
      });
      ctx.stroke();
      // Node map: eased frame around every trail point and joint.
      var all = [];
      trails.forEach(function (ts) { ts.forEach(function (tr) { all = all.concat(tr); }); });
      joints.forEach(function (js) { if (js) all = all.concat(js); });
      if (all.length > 1) {
        var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
        var e = box ? 1 - Math.exp(-dt / 0.4) : 1;
        box = box || { x0: x0, x1: x1, y0: y0, y1: y1 };
        box.x0 += (x0 - box.x0) * e; box.x1 += (x1 - box.x1) * e; box.y0 += (y0 - box.y0) * e; box.y1 += (y1 - box.y1) * e;
        var bw = W * 0.18, bh = H * 0.42, ox = W * 0.73, oy = H * 0.3;
        var sc = Math.min(bw / Math.max(1, box.x1 - box.x0), bh / Math.max(1, box.y1 - box.y0));
        var map = function (q) { return [ox + (q[0] - box.x0) * sc, oy + (q[1] - box.y0) * sc]; };
        var dot = Math.max(1.5, 2.2 * u), C = (Magi.tracking.connections || {}).hand || [];
        [0, 1].forEach(function (slot) {
          var alpha = slot ? 0.55 : 0.9;
          ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
          ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
          // Fingertip trails as smooth curves, with a dot every third sample.
          ctx.beginPath();
          trails[slot].forEach(function (tr) { if (tr.length > 2) catmull(ctx, tr.map(map)); });
          ctx.stroke();
          ctx.beginPath();
          trails[slot].forEach(function (tr) {
            for (var j = tr.length - 1; j >= 0; j -= 3) { var q = map(tr[j]); ctx.moveTo(q[0] + dot * 0.7, q[1]); ctx.arc(q[0], q[1], dot * 0.7, 0, Math.PI * 2); }
          });
          ctx.fill();
          // The hand itself: bones and joints.
          var js = joints[slot];
          if (!js) return;
          var m = js.map(map);
          ctx.beginPath();
          C.forEach(function (c) { ctx.moveTo(m[c.start][0], m[c.start][1]); ctx.lineTo(m[c.end][0], m[c.end][1]); });
          ctx.stroke();
          ctx.beginPath();
          m.forEach(function (q) { ctx.moveTo(q[0] + dot, q[1]); ctx.arc(q[0], q[1], dot, 0, Math.PI * 2); });
          ctx.fill();
        });
      } else box = null;
      // Graph: sample-and-hold staircase scrolling down past a vertical axis.
      var px0 = W * 0.73, py0 = H * 0.04, pw = W * 0.22, ph = H * 0.2, axis = px0 + pw * 0.5, rows = 8, rowH = ph / rows;
      var f = Math.min(1, (t - holdAt) / HOLD);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(px0, py0, pw, ph);
      ctx.save();
      ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();
      values.forEach(function (vs, slot) {
        ctx.fillStyle = slot ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.95)';
        var dir = slot ? -1 : 1, steps = live[slot] === null ? vs.slice() : vs.concat([live[slot]]);
        // Newest at the top: the live value fills the top band as it grows; held steps below.
        for (var i = 0; i < steps.length; i++) {
          var v = steps[steps.length - 1 - i], top = i === 0 ? py0 : py0 + (i - 1 + f) * rowH, bot = py0 + (i + f) * rowH;
          if (top > py0 + ph) break;
          var wv = v * pw * 0.48;
          ctx.fillRect(dir > 0 ? axis : axis - wv, top, wv, bot - top + 0.5);
        }
      });
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(axis, py0 + 2 * u); ctx.lineTo(axis, py0 + ph - 2 * u);
      for (var tk = 0; tk <= rows; tk++) { var tyk = py0 + tk * rowH; ctx.moveTo(axis - 3 * u, tyk); ctx.lineTo(axis + 3 * u, tyk); }
      ctx.stroke();
      ctx.restore();
    }

    // Link (after the reference): a line between the two index fingertips with a node at its
    // middle, h1/h2 tags, and a radial scope: each fingertip plotted at its angle around the palm
    // center and its distance in palm lengths, inside four rings with a dotted outer ring.
    function link(ctx, frame, ix, u) {
      var W = frame.width, H = frame.height, hud = frame.hud, hs = ix.pair ? [ix.pair.left, ix.pair.right] : ix.hands;
      var lw = Math.max(1, u), fs = Math.round(11 * u);
      ctx.save();
      ctx.lineWidth = lw;
      hud.font = '500 ' + fs + 'px ' + Magi.fx.MONO;
      hud.fillStyle = '#fff';
      hud.textAlign = 'left';
      hud.textBaseline = 'bottom';
      hs.forEach(function (h, i) { var q = h.points[INDEX_TIP]; hud.fillText('h' + (i + 1), q.x + 6 * u, q.y - 6 * u); });
      if (hs.length === 2) {
        var a = hs[0].points[INDEX_TIP], b = hs[1].points[INDEX_TIP], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = 'rgb(70,230,110)';
        ctx.beginPath(); ctx.arc(mx, my, Math.max(3, 5 * u), 0, Math.PI * 2); ctx.fill();
        hud.fillText((Math.hypot(b.x - a.x, b.y - a.y) / W).toFixed(3), mx + 8 * u, my - 6 * u);
      }
      // Radial scope, top right.
      var R = H * 0.14, cx = W - R - 16 * u, cy = R + 16 * u;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      for (var k = 1; k <= 4; k++) { ctx.moveTo(cx + R * k / 4, cy); ctx.arc(cx, cy, R * k / 4, 0, Math.PI * 2); }
      for (var a2 = 0; a2 < 12; a2++) { var an = a2 / 12 * Math.PI * 2; ctx.moveTo(cx + Math.cos(an) * R * 0.92, cy + Math.sin(an) * R * 0.92); ctx.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(70,230,110,0.9)';
      for (var d = 0; d < 48; d++) { var ad = d / 48 * Math.PI * 2; ctx.fillRect(cx + Math.cos(ad) * R * 1.05 - u, cy + Math.sin(ad) * R * 1.05 - u, 2 * u, 2 * u); }
      hs.forEach(function (h, i) {
        ctx.strokeStyle = i ? 'rgba(70,230,110,0.95)' : 'rgba(255,255,255,0.95)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        [4, 8, 12, 16, 20].forEach(function (tp) {
          var q = h.points[tp], an = Math.atan2(q.y - h.center.y, q.x - h.center.x), rr = Math.min(1, Math.hypot(q.x - h.center.x, q.y - h.center.y) / h.size / 2.2) * R;
          ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr);
          ctx.fillRect(cx + Math.cos(an) * rr - 2 * u, cy + Math.sin(an) * rr - 2 * u, 4 * u, 4 * u);
        });
        ctx.stroke();
      });
      ctx.restore();
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var w = frame.width, h = frame.height, u = frame.pxPerCss;
        if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, w, h);
        var tracker = Magi.tracking.hands;
        var hands = tracker.detect(frame), info = tracker.details(), C = Magi.tracking.connections;
        var ix = Magi.interaction.read(frame), basic = !params.mode || params.mode === 'skeleton';
        if (params.signals) ix.events.forEach(function (e) { lastEvent[e.hand] = e; });

        // Contour, Filaments, Attention: modes with their own look (js/effects/landmark-modes.js);
        // no skeleton.
        if (Magi.landmarkModes && Magi.landmarkModes[params.mode]) {
          (extra[params.mode] || (extra[params.mode] = Magi.landmarkModes[params.mode]()))(ctx, frame, ix, params);
          if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
          else if (!hands.length && params.mode !== 'attention' && params.mode !== 'rabinovich') Magi.tracking.hint(ctx, frame, 'Raise your hands.');
          return;
        }
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
          if (params.pinch && basic) {
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
          if (!basic) return;
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
        if (basic && (params.fingers || (params.pairs && hands.length === 2))) {
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

        if (params.mode === 'controller') controller(ctx, frame, ix, u, params);
        else if (params.mode === 'link') link(ctx, frame, ix, u);

        if (basic && params.distance && hands.length === 2) {
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
