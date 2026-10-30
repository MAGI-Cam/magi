// Binary: only 0, 1 and empty space. Tone comes from which digit sits where.
(function () {
  var CELL_SIZES = [6, 7, 8, 10, 12, 14, 16, 20, 24];

  Magi.renderers.binary = function () {
    return Magi.fx.createGlyphRenderer({
      cellSizes: CELL_SIZES,
      glyphs: ['1', '0'].map(function (ch) { return Magi.fx.textGlyph(ch, Magi.fx.MONO); })
    });
  };
})();
