// Helpers shared by effect renderers: tone sampling, ordered-dither thresholds,
// and a glyph renderer used by the character-based effects.
(function () {
  var fx = Magi.fx = {};

  // How much of the new frame each cell takes on per update. Lower is calmer motion.
  var MOTION_EASE = 0.45;
  // Partial linearization so midtones do not wash out when shown as ink density.
  var TONE_GAMMA = 1.5;

  // 8x8 Bayer matrix as thresholds in (0, 1). Ordered dithering keeps the
  // pattern fixed in place, so live video does not shimmer the way error diffusion does.
  fx.BAYER = (function () {
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

  // Samples a frame onto a cols×rows grid. Returns one tone per cell in [0, 1]
  // (0 = black, 1 = white), with contrast from Intensity and gentle easing over time.
  fx.createToneSampler = function () {
    var grid = document.createElement('canvas');
    var gctx = grid.getContext('2d', { willReadFrequently: true });
    var tone = null;

    return {
      sample: function (frame, cols, rows, intensity) {
        if (grid.width !== cols || grid.height !== rows) {
          grid.width = cols;
          grid.height = rows;
          tone = null;
        }
        gctx.imageSmoothingEnabled = true;
        gctx.imageSmoothingQuality = 'high';
        frame.draw(gctx, cols, rows);

        var d = gctx.getImageData(0, 0, cols, rows).data;
        // Intensity is contrast around mid-gray: 0 → 0.25x, 50 → 1x, 100 → 4x.
        var contrast = Math.pow(2, (intensity - 50) / 25);
        var ease = frame.moving && tone ? MOTION_EASE : 1;
        if (!tone) tone = new Float32Array(cols * rows);

        for (var i = 0, n = cols * rows; i < n; i++) {
          var p = i << 2;
          var l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
          l = (l - 0.5) * contrast + 0.5;
          l = l <= 0 ? 0 : l >= 1 ? 1 : Math.pow(l, TONE_GAMMA);
          tone[i] += (l - tone[i]) * ease;
        }
        return tone;
      },
      reset: function () { tone = null; }
    };
  };

  // Builds a renderer that draws one glyph per cell, white on black.
  // options.cellSizes: pixel size per Scale step. options.glyphs: draw(ctx, cell) functions.
  // Glyphs are snapped to pure black and white, measured, and ordered by ink coverage,
  // so brighter cells get denser glyphs and in-between tones dither between neighbors.
  fx.createGlyphRenderer = function (options) {
    var sampler = fx.createToneSampler();
    var atlases = {};

    function buildAtlas(cell) {
      var glyphs = options.glyphs;
      var canvas = document.createElement('canvas');
      canvas.width = cell * glyphs.length;
      canvas.height = cell;
      var g = canvas.getContext('2d', { willReadFrequently: true });
      glyphs.forEach(function (draw, i) {
        g.save();
        g.beginPath();
        g.rect(i * cell, 0, cell, cell);
        g.clip();
        g.translate(i * cell, 0);
        g.fillStyle = g.strokeStyle = '#fff';
        draw(g, cell);
        g.restore();
      });

      var img = g.getImageData(0, 0, canvas.width, cell);
      var d = img.data;
      var ink = new Array(glyphs.length).fill(0);
      for (var y = 0; y < cell; y++) {
        for (var x = 0; x < canvas.width; x++) {
          var p = (y * canvas.width + x) << 2;
          var on = d[p + 3] >= 128;
          d[p] = d[p + 1] = d[p + 2] = 255;
          d[p + 3] = on ? 255 : 0;
          if (on) ink[(x / cell) | 0]++;
        }
      }
      g.putImageData(img, 0, 0);

      // Order by coverage, dropping glyphs that render identically dense at this size.
      var levels = [{ index: -1, cover: 0 }];
      glyphs.map(function (_, i) { return { index: i, cover: ink[i] / (cell * cell) }; })
        .sort(function (a, b) { return a.cover - b.cover; })
        .forEach(function (l) {
          if (l.cover > levels[levels.length - 1].cover) levels.push(l);
        });

      // Lookup table: tone (0–255) → lower level, upper level, and blend between them.
      var max = levels[levels.length - 1].cover;
      var lo = new Int16Array(256), hi = new Int16Array(256), mix = new Float32Array(256);
      for (var t = 0, k = 0; t < 256; t++) {
        var target = (t / 255) * max;
        while (k < levels.length - 2 && levels[k + 1].cover <= target) k++;
        var a = levels[k], b = levels[Math.min(k + 1, levels.length - 1)];
        lo[t] = a.index;
        hi[t] = b.index;
        mix[t] = b.cover > a.cover ? (target - a.cover) / (b.cover - a.cover) : 0;
      }
      return { canvas: canvas, lo: lo, hi: hi, mix: mix };
    }

    return {
      render: function (frame, out, params) {
        var sizes = options.cellSizes;
        var cell = sizes[params.scale - 1] || sizes[(sizes.length / 2) | 0];
        var cols = Math.max(1, Math.round(frame.width / cell));
        var rows = Math.max(1, Math.round(frame.height / cell));
        var tone = sampler.sample(frame, cols, rows, params.intensity);
        var atlas = atlases[cell] || (atlases[cell] = buildAtlas(cell));

        var w = cols * cell, h = rows * cell;
        if (out.width !== w || out.height !== h) {
          out.width = w;
          out.height = h;
        }
        var octx = out.getContext('2d');
        octx.imageSmoothingEnabled = false;
        octx.fillStyle = '#000';
        octx.fillRect(0, 0, w, h);

        for (var y = 0, i = 0; y < rows; y++) {
          var row = (y & 7) << 3;
          for (var x = 0; x < cols; x++, i++) {
            var t = (tone[i] * 255 + 0.5) | 0;
            var glyph = atlas.mix[t] > fx.BAYER[row | (x & 7)] ? atlas.hi[t] : atlas.lo[t];
            if (glyph < 0) continue;
            octx.drawImage(atlas.canvas, glyph * cell, 0, cell, cell, x * cell, y * cell, cell, cell);
          }
        }
      },
      reset: function () { sampler.reset(); }
    };
  };

  // Draws a centered text character sized to the cell.
  fx.textGlyph = function (ch, family) {
    return function (g, cell) {
      g.font = Math.round(cell * 1.05) + 'px ' + family;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, cell / 2, cell * 0.54);
    };
  };

  fx.MONO = 'Menlo, Consolas, "DejaVu Sans Mono", "Courier New", monospace';
})();
