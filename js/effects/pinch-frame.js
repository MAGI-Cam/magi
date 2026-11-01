// Pinch Frame: make an L with thumb and index finger on both hands; the four fingertips span a
// window, and inside it the camera is shown in false color.
//
// The window is the quadrilateral through both thumb tips (landmark 4) and both index tips (8),
// with its corners ordered by angle around their centroid so it never self-intersects as the
// hands cross. False color maps each pixel's luma Y = 0.2126R + 0.7152G + 0.0722B through a
// palette, precomputed as a 256-entry lookup table per frame:
//   Acid    — hue = frac(bands·Y + t·speed): brightness becomes hue bands that cycle in time.
//   Thermal — a heat ramp (black → indigo → magenta → orange → pale yellow), repeated `bands`
//             times across the range and drifting with time.
//   Invert  — each channel c becomes 255 − c.
(function () {
  var THUMB_TIP = 4, INDEX_TIP = 8;
  var THERMAL = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];

  function hsv(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  }

  function thermal(x) {
    var f = x * (THERMAL.length - 1), i = Math.min(THERMAL.length - 2, Math.floor(f)), k = f - i;
    var a = THERMAL[i], b = THERMAL[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function createPinchFrame() {
    var work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
    var tint = document.createElement('canvas'), tctx = tint.getContext('2d');
    var lut = new Uint8ClampedArray(256 * 3);

    function buildLut(mode, bands, t) {
      for (var y = 0; y < 256; y++) {
        var x = y / 255, c;
        if (mode === 'thermal') {
          var u = (x * bands + t * 0.25) % 1;
          // Mirror alternate repeats so the ramp has no hard seam between bands.
          c = thermal(Math.floor(x * bands + t * 0.25) % 2 ? 1 - u : u);
        } else {
          var rgb = hsv((x * bands + t) % 1, 1, 0.55 + 0.45 * x);
          c = [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255];
        }
        lut[y * 3] = c[0];
        lut[y * 3 + 1] = c[1];
        lut[y * 3 + 2] = c[2];
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var tracker = Magi.tracking.hands, hands = tracker.detect(frame);

        if (hands.length >= 2) {
          var pts = [hands[0][THUMB_TIP], hands[0][INDEX_TIP], hands[1][INDEX_TIP], hands[1][THUMB_TIP]];
          var cx = 0, cy = 0;
          pts.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
          pts.sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
          var x0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.x; }))));
          var y0 = Math.max(0, Math.floor(Math.min.apply(null, pts.map(function (p) { return p.y; }))));
          var x1 = Math.min(W, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.x; }))));
          var y1 = Math.min(H, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; }))));
          var bw = x1 - x0, bh = y1 - y0;
          if (bw > 2 && bh > 2) {
            if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
            frame.draw(wctx, W, H);
            var img = wctx.getImageData(x0, y0, bw, bh), d = img.data;
            var mode = params.mode || 'acid';
            if (mode === 'invert') {
              for (var i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
            } else {
              buildLut(mode, params.bands, (frame.time / 1000) * (params.speed / 100));
              for (var j = 0; j < d.length; j += 4) {
                var Y = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) | 0;
                d[j] = lut[Y * 3]; d[j + 1] = lut[Y * 3 + 1]; d[j + 2] = lut[Y * 3 + 2];
              }
            }
            if (tint.width !== bw || tint.height !== bh) { tint.width = bw; tint.height = bh; }
            tctx.putImageData(img, 0, 0);
            ctx.save();
            ctx.beginPath();
            pts.forEach(function (p, k) { k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(tint, x0, y0);
            ctx.restore();
          }
        }

        var C = Magi.tracking.connections;
        if (params.skeleton && C) {
          hands.forEach(function (p) {
            ctx.strokeStyle = 'rgb(255,40,40)';
            ctx.lineWidth = Math.max(1, 2.5 * u);
            ctx.beginPath();
            C.hand.forEach(function (c) { ctx.moveTo(p[c.start].x, p[c.start].y); ctx.lineTo(p[c.end].x, p[c.end].y); });
            ctx.stroke();
            ctx.fillStyle = 'rgb(48,255,48)';
            p.forEach(function (q) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, 3.5 * u), 0, Math.PI * 2); ctx.fill(); });
          });
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (hands.length < 2) Magi.tracking.hint(ctx, frame, 'Make an L with thumb and index finger on both hands.');
      },
      reset: function () {}
    };
  }

  Magi.renderers['pinch-frame'] = createPinchFrame;
})();
