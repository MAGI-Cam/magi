// ASCII: one character per cell, in several modes. Tapping the active tile cycles modes.
// Classic   — the short 10-step ramp most ASCII art uses.
// Detailed  — Paul Bourke's 70-character ramp: finer tonal steps, busier texture.
// Blocks    — the DOS-era shade characters ░ ▒ ▓ █ drawn as pixel patterns.
// Braille   — each cell is a 2×4 grid of dots, so detail is 8× finer than one glyph per cell.
// Edges     — outlines drawn with - | / \ along the image's edges, Classic ramp elsewhere.
(function () {
  var fx = Magi.fx;
  var CELL_SIZES = [6, 7, 8, 10, 12, 14, 16, 20, 24];
  var CLASSIC = '.:-=+*#%@';
  var DETAILED = ".'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

  // Shade blocks drawn as pixel patterns so they fill the square cell exactly.
  // level: 1 = ░ (1 in 4 lit), 2 = ▒ (checker), 3 = ▓ (3 in 4 lit), 4 = █ (solid).
  function shade(level) {
    return function (g, cell) {
      var p = Math.max(1, Math.round(cell / 6));
      for (var y = 0, j = 0; y < cell; y += p, j++) {
        for (var x = 0, i = 0; x < cell; x += p, i++) {
          var lit = level === 4 ||
            (level === 3 && !(i % 2 && j % 2)) ||
            (level === 2 && (i + j) % 2 === 0) ||
            (level === 1 && i % 2 === 0 && j % 2 === 0);
          if (lit) g.fillRect(x, y, p, p);
        }
      }
    };
  }

  // A braille-style cell: bit (col * 4 + row) lights the dot at that column and row.
  function dots(bits) {
    return function (g, cell) {
      var d = Math.max(1, Math.round(cell * 0.2));
      for (var c = 0; c < 2; c++) {
        for (var r = 0; r < 4; r++) {
          if (bits & (1 << (c * 4 + r))) {
            var x = Math.round(cell * (0.3 + 0.4 * c) - d / 2);
            var y = Math.round(cell * (0.125 + 0.25 * r) - d / 2);
            g.fillRect(x, y, d, d);
          }
        }
      }
    };
  }

  function createBraille() {
    var sampler = fx.createToneSampler();
    var atlases = {};
    var glyphs = [];
    for (var b = 0; b < 256; b++) glyphs.push(dots(b));

    return {
      render: function (frame, out, params) {
        var cell = fx.cellSize(CELL_SIZES, params.scale);
        var cols = Math.max(1, Math.round(frame.width / cell));
        var rows = Math.max(1, Math.round(frame.height / cell));
        var sw = cols * 2;
        // Each dot gets its own sample: 2 across and 4 down per cell.
        var sample = sampler.sample(frame, sw, rows * 4, params.intensity);
        var tone = sample.tone;
        var atlas = atlases[cell] || (atlases[cell] = fx.buildAtlas(glyphs, cell));
        var octx = fx.prepareOut(out, cols * cell, rows * cell);

        for (var y = 0; y < rows; y++) {
          for (var x = 0; x < cols; x++) {
            var bits = 0;
            for (var c = 0; c < 2; c++) {
              for (var r = 0; r < 4; r++) {
                var sx = x * 2 + c, sy = y * 4 + r;
                if (tone[sy * sw + sx] > fx.BAYER[((sy & 7) << 3) | (sx & 7)]) bits |= 1 << (c * 4 + r);
              }
            }
            if (bits) octx.drawImage(atlas.canvas, bits * cell, 0, cell, cell, x * cell, y * cell, cell, cell);
          }
        }
        fx.applyInk(out, sample, params);
      },
      reset: function () { sampler.reset(); }
    };
  }

  var MODES = {
    classic: function () {
      return fx.createGlyphRenderer({ cellSizes: CELL_SIZES, glyphs: fx.textGlyphs(CLASSIC) });
    },
    detailed: function () {
      return fx.createGlyphRenderer({ cellSizes: CELL_SIZES, glyphs: fx.textGlyphs(DETAILED) });
    },
    blocks: function () {
      return fx.createGlyphRenderer({ cellSizes: CELL_SIZES, glyphs: [shade(1), shade(2), shade(3), shade(4)] });
    },
    braille: createBraille,
    edges: function () {
      return fx.createGlyphRenderer({
        cellSizes: CELL_SIZES,
        glyphs: fx.textGlyphs(CLASSIC),
        edges: fx.textGlyphs('-|/\\')
      });
    }
  };

  Magi.renderers.ascii = function () {
    var made = {};
    function mode(id) {
      if (!MODES[id]) id = 'classic';
      return made[id] || (made[id] = MODES[id]());
    }
    return {
      render: function (frame, out, params) { mode(params.mode).render(frame, out, params); },
      reset: function () { Object.keys(made).forEach(function (id) { made[id].reset(); }); }
    };
  };
})();
