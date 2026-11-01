// X's and O's: lower- and upper-case x and o set in a typeface, ordered by ink so brighter
// areas get heavier letters. Modes switch the typeface.
(function () {
  // Cell size in screen pixels for each Scale step (1–9).
  var CELL_SIZES = [6, 7, 8, 9, 11, 13, 16, 19, 24];

  function typed(font) {
    return function () {
      return Magi.fx.createGlyphRenderer({
        cellSizes: CELL_SIZES,
        font: font.family,
        threshold: font.threshold,
        glyphs: ['x', 'o', 'X', 'O'].map(function (ch) { return Magi.fx.textGlyph(ch, font.stack); })
      });
    };
  }

  Magi.renderers['xs-and-os'] = function () {
    var F = Magi.fx.FONTS;
    return Magi.fx.createModeRenderer({
      bodoni: typed(F.bodoni),
      silkscreen: typed(F.silkscreen)
    }, 'bodoni');
  };
})();
