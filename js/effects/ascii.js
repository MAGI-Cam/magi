// ASCII: one monospace character per cell. Brighter areas get denser characters.
(function () {
  var CELL_SIZES = [6, 7, 8, 10, 12, 14, 16, 20, 24];
  var RAMP = ".,:;-~=+*ox%#&@";

  Magi.renderers.ascii = function () {
    return Magi.fx.createGlyphRenderer({
      cellSizes: CELL_SIZES,
      glyphs: RAMP.split('').map(function (ch) { return Magi.fx.textGlyph(ch, Magi.fx.MONO); })
    });
  };
})();
