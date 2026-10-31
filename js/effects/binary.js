// Binary: only 0, 1 and empty space. Tone comes from which digit sits where.
(function () {
  // Cell size in screen pixels for each Scale step (1–9).
  var CELL_SIZES = [6, 7, 8, 9, 11, 13, 16, 19, 24];

  Magi.renderers.binary = function () {
    return Magi.fx.createGlyphRenderer({
      cellSizes: CELL_SIZES,
      glyphs: ['1', '0'].map(function (ch) { return Magi.fx.textGlyph(ch, Magi.fx.MONO); })
    });
  };
})();
