// Line Art: one continuous line drawn around your hands, redrawn as you move (after Contour's Path).
//
// Points: Magi.contourSampler — around each hand the picture's Sobel edge strength is measured and
// Points of them are drawn with probability proportional to it, so they gather on the outlines of
// your hands and arms; they're redrawn Rate times a second (1–20). The line is a nearest-neighbor
// tour through them (from any point, always to the closest unvisited one), one stroke whose long
// jumps between fingers make loops, like a continuous-line drawing.
// Spikiness, from smooth to sharp:
//   0–50   the tour as a cardinal spline: Catmull–Rom tangents (pᵢ₊₁ − pᵢ₋₁)/2 scaled by
//          k = 1 − Spikiness/50, so 0 is fully rounded and 50 is a straight polyline;
//   50–100 the polyline with spikes: every point pushed out along the line's normal, alternately
//          left and right, by up to 6% of the frame height × a random factor per point.
// Thickness: 0.5–8 px (screen). Texture: a highlighter / marker stroke, fixed to the line (nothing in
// it is random per frame, so it never crawls along the path). A marker's felt chisel tip lays down
// translucent ink, a little heavier along both edges where the felt meets the paper first, with fine
// streaks parallel to the stroke from the felt's fibres. So: a translucent body (opacity falling
// from 1 to 0.55 as Texture rises), two darker edge lines at ±0.42 of the width, and two faint
// streaks at ±0.15, each offset across the stroke along the chisel's angle (45°), so the stroke
// looks broader on diagonals, like a real chisel tip; the ends are cut square. 0 is one clean line.
// Color: far left lime; then the hue wheel. Dim: darkens the camera behind the drawing.
// Size scales the drawing about each hand's palm center (×0.5–×2); closing your palm shrinks it
// and opening it expands it (×0.45–×1.6 more). Connect: one tour through both
// hands plus strands between matching fingertips (sagging when Spikiness is low); off: one tour per
// hand.
// Pinch: freezes the drawing until you let go.
(function () {
  function createLineArt() {
    var sample = Magi.contourSampler(), frozen = null, seeds = [], lastPts = null, palmK = 1;
    function rnd(i, k) { var h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (params.dim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
        var ix = Magi.interaction.read(frame), tracker = Magi.tracking.hands;
        var pinched = ix.hands.some(function (h) { return h.pinched; });
        var pts = pinched && frozen ? frozen : sample(frame, ix, Math.round(params.points), 1 + params.rate / 100 * 19);
        if (!pinched) frozen = pts.length ? pts : frozen;
        if (pts !== lastPts) { lastPts = pts; seeds = pts.map(function () { return Math.random(); }); }
        // Size: each point is scaled about the palm center of the hand it's nearest to. Connect on:
        // one line through both hands, plus strands joining matching fingertips; off: one line per hand.
        // Palm: closing your hand shrinks the drawing (to ×0.45), opening it expands it (to ×1.6),
        // from the fingers' mean curl, eased over 0.15 s; on top of Size.
        var hs = ix.hands, groups = [];
        if (hs.length) {
          var open = 0;
          hs.forEach(function (hd) { var f = hd.fingers; open += 1 - (f.index.curl + f.middle.curl + f.ring.curl + f.pinky.curl) / 4; });
          open = Math.max(0, Math.min(1, open / hs.length));
          palmK += (0.45 + 1.15 * open - palmK) * (1 - Math.exp(-(1 / 60) / 0.15));
        }
        var scale = Math.pow(2, (params.size - 50) / 50) * palmK;
        if (pts.length > 2) {
          var placed = pts.map(function (q) {
            if (!hs.length) return { x: q.x, y: q.y, h: 0 };
            var bi = 0, bd = Infinity;
            hs.forEach(function (hd, i) { var d = Math.hypot(q.x - hd.center.x, q.y - hd.center.y); if (d < bd) { bd = d; bi = i; } });
            var c = hs[bi].center;
            return { x: c.x + (q.x - c.x) * scale, y: c.y + (q.y - c.y) * scale, h: bi };
          });
          if (params.connect || hs.length < 2) groups = [placed];
          else hs.forEach(function (_, i) { var g = placed.filter(function (q) { return q.h === i; }); if (g.length > 2) groups.push(g); });
        }
        var links = [];
        if (params.connect && hs.length >= 2) {
          [4, 8, 12, 16, 20].forEach(function (k) {
            var a = hs[0].points[k], b = hs[1].points[k], ca = hs[0].center, cb = hs[1].center;
            links.push([{ x: ca.x + (a.x - ca.x) * scale, y: ca.y + (a.y - ca.y) * scale }, { x: cb.x + (b.x - cb.x) * scale, y: cb.y + (b.y - cb.y) * scale }]);
          });
        }
        var path = new Path2D(), s = params.spikiness / 100;
        groups.forEach(function (group) {
          var tour = Magi.nearestTour(group), n = tour.length;
          if (s <= 0.5) {
            // Cardinal spline: Catmull–Rom tangents scaled by k.
            var k = 1 - s / 0.5;
            path.moveTo(tour[0].x, tour[0].y);
            for (var i = 0; i < n - 1; i++) {
              var p0 = tour[Math.max(0, i - 1)], p1 = tour[i], p2 = tour[i + 1], p3 = tour[Math.min(n - 1, i + 2)];
              path.bezierCurveTo(p1.x + k * (p2.x - p0.x) / 6, p1.y + k * (p2.y - p0.y) / 6, p2.x - k * (p3.x - p1.x) / 6, p2.y - k * (p3.y - p1.y) / 6, p2.x, p2.y);
            }
          } else {
            // Spikes: alternate points pushed out along the normal.
            var amp = (s - 0.5) * 2 * 0.06 * H;
            for (var j = 0; j < n; j++) {
              var a = tour[Math.max(0, j - 1)], b = tour[Math.min(n - 1, j + 1)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
              var off = (j % 2 ? 1 : -1) * amp * (0.3 + 0.7 * (seeds[j] || 0.5));
              var x = tour[j].x - dy / l * off, y = tour[j].y + dx / l * off;
              j ? path.lineTo(x, y) : path.moveTo(x, y);
            }
          }
        });
        // Strands between the hands: straight, or sagging into a curve when Spikiness is low.
        links.forEach(function (l) {
          var mx = (l[0].x + l[1].x) / 2, my = (l[0].y + l[1].y) / 2 + Math.max(0, 0.5 - s) * 0.15 * H;
          path.moveTo(l[0].x, l[0].y);
          path.quadraticCurveTo(mx, my, l[1].x, l[1].y);
        });
        if (groups.length || links.length) {
          var n = groups.reduce(function (a, g) { return a + g.length; }, 0) + links.length;
          var ink = params.color ? Magi.fx.inkColor(params.color) : [0.78, 0.94, 0.24];
          var rgb = ink.map(function (v) { return Math.round(v * 255); }).join(',');
          var w = (0.5 + params.thickness / 100 * 7.5) * u, tex = params.texture / 100;
          ctx.save();
          ctx.lineJoin = s > 0.5 ? 'miter' : 'round';
          ctx.lineCap = 'round';
          if (tex <= 0) {
            ctx.strokeStyle = 'rgb(' + rgb + ')';
            ctx.lineWidth = w;
            ctx.stroke(path);
          } else {
            // Marker: body, edge lines and streaks, each the whole path shifted across the chisel.
            var cx45 = Math.SQRT1_2, wide = w * (1 + 0.35 * tex);
            ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
            var pass = function (off, width, alpha) {
              ctx.save();
              ctx.translate(off * wide * cx45, -off * wide * cx45);
              ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
              ctx.lineWidth = width;
              ctx.stroke(path);
              ctx.restore();
            };
            pass(0, wide, 1 - 0.45 * tex);
            [-0.42, 0.42].forEach(function (o) { pass(o, Math.max(1, wide * 0.16), 0.35 * tex); });
            [-0.15, 0.15].forEach(function (o) { pass(o, Math.max(0.6, wide * 0.06), 0.18 * tex); });
          }
          ctx.restore();
        }
        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length) Magi.tracking.hint(ctx, frame, 'Raise your hands: the line draws around them.');
      },
      reset: function () { frozen = null; lastPts = null; }
    };
  }

  Magi.renderers['line-art'] = createLineArt;
})();
