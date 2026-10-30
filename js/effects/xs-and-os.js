// X's and O's: drawn crosses and rings that grow and thicken in brighter areas.
(function () {
  var CELL_SIZES = [6, 7, 8, 10, 12, 14, 16, 20, 24];

  function cross(size, weight) {
    return function (g, cell) {
      var m = cell / 2, r = (cell * size) / 2;
      g.lineWidth = Math.max(1, cell * weight);
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(m - r, m - r);
      g.lineTo(m + r, m + r);
      g.moveTo(m + r, m - r);
      g.lineTo(m - r, m + r);
      g.stroke();
    };
  }

  function ring(size, weight) {
    return function (g, cell) {
      var w = Math.max(1, cell * weight);
      g.lineWidth = w;
      g.beginPath();
      g.arc(cell / 2, cell / 2, Math.max(0.5, (cell * size - w) / 2), 0, Math.PI * 2);
      g.stroke();
    };
  }

  Magi.renderers['xs-and-os'] = function () {
    return Magi.fx.createGlyphRenderer({
      cellSizes: CELL_SIZES,
      glyphs: [
        cross(0.45, 0.1), ring(0.5, 0.1),
        cross(0.7, 0.12), ring(0.75, 0.12),
        cross(0.9, 0.16), ring(0.95, 0.18),
        cross(1, 0.26), ring(1, 0.3)
      ]
    });
  };
})();
