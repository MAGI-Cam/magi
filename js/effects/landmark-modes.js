// Landmarks modes beyond the skeleton: Contour, Filaments and Attention. Each is a factory in
// Magi.landmarkModes returning draw(ctx, frame, ix, params); landmarks.js calls the one for the mode.
(function () {
  var LIME = '#c8f03c';
  Magi.landmarkModes = Magi.landmarkModes || {};

  // Contour (after a knitting-hands reference): points on the outlines of your hands and arms,
  // shown three ways (Style; a pinch steps to the next):
  //   Points — lime dots with a readout beside some of them: the edge strength there, 0…1, printed
  //            to seven decimals like a raw sensor value;
  //   Path   — the same points joined by a nearest-neighbor tour (start anywhere, always step to
  //            the closest unvisited point), whose long jumps between hands make wild loops;
  //   Fill   — that path filled by the even–odd rule as one flat, grainy lime shape.
  // Where the points come from: around each hand (its box grown by 60% of the palm length, so it
  // reaches the wrist), the picture's edge strength is measured with the Sobel operator,
  // |G| = √(Gx² + Gy²) with Gx, Gy the 3×3 Sobel kernels, on a 160-px-wide copy; Points of them are
  // drawn with probability proportional to |G| (inverse-transform sampling over the cumulative
  // sum), so they gather on outlines and folds. They're redrawn Rate times a second.
  Magi.landmarkModes.contour = function () {
    var ana = document.createElement('canvas'), actx = ana.getContext('2d', { willReadFrequently: true });
    var grainTile = null, pts = [], lastDraw = -9, wasPinched = false;
    function grain(ctx) {
      if (grainTile) return grainTile;
      var c = document.createElement('canvas'); c.width = c.height = 96;
      var g = c.getContext('2d'), im = g.createImageData(96, 96);
      for (var i = 0; i < im.data.length; i += 4) {
        var v = 170 + Math.random() * 85;
        im.data[i] = 200 * v / 255; im.data[i + 1] = 240 * v / 255; im.data[i + 2] = 60 * v / 255; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      return (grainTile = ctx.createPattern(c, 'repeat'));
    }
    return function (ctx, frame, ix, params) {
      var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
      var pinched = ix.hands.some(function (h) { return h.pinched; });
      if (pinched && !wasPinched) frame.setParam('style', ((Math.round(params.style) || 0) + 1) % 3);
      wasPinched = pinched;
      if (!ix.hands.length) { pts = []; return; }
      if (t - lastDraw >= 1 / Math.max(1, params.rate / 100 * 20)) {
        lastDraw = t;
        var aw = 160, ah = Math.round(160 * H / W), sx = W / aw, sy = H / ah;
        if (ana.width !== aw || ana.height !== ah) { ana.width = aw; ana.height = ah; }
        frame.draw(actx, aw, ah);
        var d = actx.getImageData(0, 0, aw, ah).data, L = new Float32Array(aw * ah), i, x, y;
        for (i = 0; i < aw * ah; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
        // Regions: each hand's box, grown.
        var boxes = ix.hands.map(function (h) {
          var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, g = h.size * 0.6;
          h.points.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
          return [Math.max(1, Math.floor((x0 - g) / sx)), Math.max(1, Math.floor((y0 - g) / sy)), Math.min(aw - 2, Math.ceil((x1 + g) / sx)), Math.min(ah - 2, Math.ceil((y1 + g * 1.5) / sy))];
        });
        var cells = [], cdf = [], sum = 0, seen = {};
        boxes.forEach(function (b) {
          for (y = b[1]; y <= b[3]; y++) for (x = b[0]; x <= b[2]; x++) {
            var k = y * aw + x;
            if (seen[k]) continue;
            seen[k] = 1;
            var gx = L[k - aw + 1] + 2 * L[k + 1] + L[k + aw + 1] - L[k - aw - 1] - 2 * L[k - 1] - L[k + aw - 1];
            var gy = L[k + aw - 1] + 2 * L[k + aw] + L[k + aw + 1] - L[k - aw - 1] - 2 * L[k - aw] - L[k - aw + 1];
            var m = Math.sqrt(gx * gx + gy * gy);
            if (m < 0.04) continue;
            sum += m; cells.push([x, y, m]); cdf.push(sum);
          }
        });
        var n = Math.round(params.points), maxG = 0;
        cells.forEach(function (c) { maxG = Math.max(maxG, c[2]); });
        pts = [];
        for (var s = 0; s < n && cells.length; s++) {
          var r = Math.random() * sum, lo = 0, hi = cdf.length - 1;
          while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
          var c = cells[lo];
          pts.push({ x: (c[0] + Math.random()) * sx, y: (c[1] + Math.random()) * sy, v: c[2] / (maxG || 1) });
        }
      }
      if (!pts.length) return;
      var style = Math.round(params.style) || 0;
      ctx.save();
      if (style >= 1) {
        // Nearest-neighbor tour.
        var left = pts.slice(1), tour = [pts[0]];
        while (left.length) {
          var last = tour[tour.length - 1], bi = 0, bd = Infinity;
          for (var j = 0; j < left.length; j++) { var dd = (left[j].x - last.x) * (left[j].x - last.x) + (left[j].y - last.y) * (left[j].y - last.y); if (dd < bd) { bd = dd; bi = j; } }
          tour.push(left.splice(bi, 1)[0]);
        }
        ctx.beginPath();
        tour.forEach(function (q, k) { k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        if (style === 2) { ctx.closePath(); ctx.fillStyle = grain(ctx); ctx.fill('evenodd'); }
        else { ctx.strokeStyle = LIME; ctx.lineWidth = Math.max(1, 1.4 * u); ctx.lineJoin = 'round'; ctx.stroke(); }
      } else {
        ctx.fillStyle = LIME;
        var rr = Math.max(1.2, 1.6 * u);
        ctx.beginPath();
        pts.forEach(function (q) { ctx.moveTo(q.x + rr, q.y); ctx.arc(q.x, q.y, rr, 0, Math.PI * 2); });
        ctx.fill();
        if (params.labels) {
          hud.save();
          hud.fillStyle = LIME;
          hud.font = '500 ' + Math.round(8 * u) + 'px ' + Magi.fx.MONO;
          hud.textBaseline = 'middle';
          for (var k2 = 0; k2 < pts.length; k2 += 6) hud.fillText(pts[k2].v.toFixed(7), pts[k2].x + 4 * u, pts[k2].y);
          hud.restore();
        }
      }
      ctx.restore();
    };
  };
})();
