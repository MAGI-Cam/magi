// Binary: only 0, 1 and empty space. Tone comes from which digit sits where.
// Modes switch the typeface; the digits' own shapes change the texture.
(function () {
  var fx = Magi.fx;
  // Cell size in screen pixels for each Scale step (1–9).
  var CELL_SIZES = [6, 7, 8, 9, 11, 13, 16, 19, 24];

  function digits(font) {
    return function () {
      return fx.createGlyphRenderer({
        cellSizes: CELL_SIZES,
        font: font.family,
        threshold: font.threshold,
        glyphs: ['1', '0'].map(function (ch) { return fx.textGlyph(ch, font.stack); })
      });
    };
  }

  Magi.renderers.binary = function () {
    return fx.createModeRenderer({
      system: digits(fx.FONTS.system),
      plex: digits(fx.FONTS.plex),
      space: digits(fx.FONTS.space),
      vt323: digits(fx.FONTS.vt323),
      silkscreen: digits(fx.FONTS.silkscreen)
    }, 'system');
  };
})();
