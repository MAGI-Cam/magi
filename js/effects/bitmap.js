// Bitmap: square pixels in pure black and white. Gray is only ever implied by
// how densely black pixels are placed (ordered dithering on a coarse grid).
(function () {
  // Pixel size, in working-frame pixels, for each Scale step (1–9).
  var CELL_SIZES = [2, 3, 4, 5, 6, 8, 10, 13, 16];

  function createBitmap() {
    var sampler = Magi.fx.createToneSampler();
    var pixels = document.createElement('canvas');
    var pctx = pixels.getContext('2d');
    var BAYER = Magi.fx.BAYER;

    return {
      // frame: { width, height, moving, draw(ctx, w, h) }; out: the visible canvas.
      render: function (frame, out, params) {
        var cell = Magi.fx.cellSize(CELL_SIZES, params.scale);
        var cols = Math.max(1, Math.round(frame.width / cell));
        var rows = Math.max(1, Math.round(frame.height / cell));
        var sample = sampler.sample(frame, cols, rows, params.intensity);
        var tone = sample.tone;

        if (pixels.width !== cols || pixels.height !== rows) {
          pixels.width = cols;
          pixels.height = rows;
        }
        var img = pctx.createImageData(cols, rows);
        var d = img.data;
        for (var y = 0, i = 0; y < rows; y++) {
          var row = (y & 7) << 3;
          for (var x = 0; x < cols; x++, i++) {
            var p = i << 2;
            var v = tone[i] > BAYER[row | (x & 7)] ? 255 : 0;
            d[p] = d[p + 1] = d[p + 2] = v;
            d[p + 3] = 255;
          }
        }
        pctx.putImageData(img, 0, 0);

        var w = cols * cell, h = rows * cell;
        if (out.width !== w || out.height !== h) {
          out.width = w;
          out.height = h;
        }
        var octx = out.getContext('2d');
        octx.imageSmoothingEnabled = false;
        octx.drawImage(pixels, 0, 0, w, h);
        Magi.fx.applyInk(out, sample, params);
      },

      reset: function () { sampler.reset(); }
    };
  }

  Magi.renderers.bitmap = createBitmap;
})();
