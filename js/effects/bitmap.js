// Bitmap: square pixels in pure black and white. Gray is only ever implied by
// how densely black pixels are placed (ordered dithering on a coarse grid).
(function () {
  // Pixel size, in working-frame pixels, for each Scale step (1–9).
  var CELL_SIZES = [2, 3, 4, 5, 6, 8, 10, 13, 16];
  // How much of the new frame each cell takes on per update. Lower is calmer motion.
  var MOTION_EASE = 0.45;
  // Partial linearization so midtones do not wash out when shown as pixel density.
  var TONE_GAMMA = 1.5;

  // 8x8 Bayer matrix as thresholds in (0, 1). Ordered dithering keeps the
  // pattern fixed in place, so live video does not shimmer the way error diffusion does.
  var BAYER = (function () {
    var m = [[0]];
    while (m.length < 8) {
      var s = m.length, next = [];
      for (var y = 0; y < s * 2; y++) {
        next[y] = [];
        for (var x = 0; x < s * 2; x++) {
          var q = [[0, 2], [3, 1]][(y / s) | 0][(x / s) | 0];
          next[y][x] = 4 * m[y % s][x % s] + q;
        }
      }
      m = next;
    }
    var flat = new Float32Array(64);
    for (var i = 0; i < 64; i++) flat[i] = (m[i >> 3][i & 7] + 0.5) / 64;
    return flat;
  })();

  function createBitmap() {
    var grid = document.createElement('canvas');
    var gctx = grid.getContext('2d', { willReadFrequently: true });
    var tone = null;

    return {
      // frame: { width, height, moving, draw(ctx, w, h) }; out: the visible canvas.
      render: function (frame, out, params) {
        var cell = CELL_SIZES[params.scale - 1] || CELL_SIZES[4];
        var cols = Math.max(1, Math.round(frame.width / cell));
        var rows = Math.max(1, Math.round(frame.height / cell));

        if (grid.width !== cols || grid.height !== rows) {
          grid.width = cols;
          grid.height = rows;
          tone = null;
        }

        gctx.imageSmoothingEnabled = true;
        gctx.imageSmoothingQuality = 'high';
        frame.draw(gctx, cols, rows);

        var img = gctx.getImageData(0, 0, cols, rows);
        var d = img.data;
        // Intensity is contrast around mid-gray: 0 → 0.25x, 50 → 1x, 100 → 4x.
        var contrast = Math.pow(2, (params.intensity - 50) / 25);
        var ease = frame.moving && tone ? MOTION_EASE : 1;
        if (!tone) tone = new Float32Array(cols * rows);

        for (var y = 0, i = 0; y < rows; y++) {
          var row = (y & 7) << 3;
          for (var x = 0; x < cols; x++, i++) {
            var p = i << 2;
            var l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
            l = (l - 0.5) * contrast + 0.5;
            l = l <= 0 ? 0 : l >= 1 ? 1 : Math.pow(l, TONE_GAMMA);
            var t = tone[i] += (l - tone[i]) * ease;
            var v = t > BAYER[row | (x & 7)] ? 255 : 0;
            d[p] = d[p + 1] = d[p + 2] = v;
            d[p + 3] = 255;
          }
        }
        gctx.putImageData(img, 0, 0);

        var w = cols * cell, h = rows * cell;
        if (out.width !== w || out.height !== h) {
          out.width = w;
          out.height = h;
        }
        var octx = out.getContext('2d');
        octx.imageSmoothingEnabled = false;
        octx.drawImage(grid, 0, 0, w, h);
      },

      reset: function () { tone = null; }
    };
  }

  Magi.renderers.bitmap = createBitmap;
})();
