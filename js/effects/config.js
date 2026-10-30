// Effect definitions: names, order, availability and adjustable parameters.
// Rendering code lives in each effect's own file and registers itself in Magi.renderers.
window.Magi = window.Magi || {};
Magi.renderers = Magi.renderers || {};

Magi.effectConfig = [
  {
    id: 'bitmap',
    name: 'Bitmap',
    ready: true,
    params: [
      { id: 'scale', label: 'Scale', min: 1, max: 9, step: 1, default: 5 },
      { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50 }
    ]
  },
  {
    id: 'ascii',
    name: 'ASCII',
    ready: true,
    params: [
      { id: 'scale', label: 'Scale', min: 1, max: 9, step: 1, default: 5 },
      { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50 }
    ]
  },
  {
    id: 'binary',
    name: 'Binary',
    ready: true,
    params: [
      { id: 'scale', label: 'Scale', min: 1, max: 9, step: 1, default: 5 },
      { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50 }
    ]
  },
  {
    id: 'xs-and-os',
    name: "X's and O's",
    ready: true,
    params: [
      { id: 'scale', label: 'Scale', min: 1, max: 9, step: 1, default: 5 },
      { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50 }
    ]
  }
];

Magi.defaultsFor = function (effect) {
  var values = {};
  effect.params.forEach(function (p) { values[p.id] = p.default; });
  return values;
};
