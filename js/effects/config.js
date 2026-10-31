// Effect definitions: names, order, availability, modes and adjustable parameters.
// Rendering code lives in each effect's own file and registers itself in Magi.renderers.
window.Magi = window.Magi || {};
Magi.renderers = Magi.renderers || {};

// Controls every current effect shares. track: 'hue' draws the slider as a color spectrum.
function sharedParams() {
  return [
    { id: 'scale', label: 'Scale', min: 1, max: 9, step: 1, default: 5 },
    { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 50 },
    { id: 'saturation', label: 'Saturation', min: 0, max: 100, step: 1, default: 0 },
    { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' }
  ];
}

// Halftone: effects that rebuild the image from a grid of marks (pixels, characters, symbols)
// and fake every shade of gray with how densely those marks sit.
Magi.effectGroups = [
  { id: 'halftone', name: 'Halftone' }
];

Magi.effectConfig = [
  // Normal has no renderer: the camera or media is shown as is. Its photos save as JPEG,
  // which suits continuous-tone images; halftone effects keep exact edges as PNG.
  { id: 'normal', name: 'Normal', ready: true, params: [], photoType: 'image/jpeg' },
  { id: 'bitmap', name: 'Bitmap', group: 'halftone', ready: true, params: sharedParams() },
  {
    id: 'ascii',
    name: 'ASCII',
    group: 'halftone',
    ready: true,
    // Tapping the active tile steps through these in order.
    modes: [
      { id: 'classic', name: 'Classic' },
      { id: 'detailed', name: 'Detailed' },
      { id: 'blocks', name: 'Blocks' },
      { id: 'braille', name: 'Braille' },
      { id: 'edges', name: 'Edges' }
    ],
    params: sharedParams()
  },
  { id: 'binary', name: 'Binary', group: 'halftone', ready: true, params: sharedParams() },
  { id: 'xs-and-os', name: "X's and O's", group: 'halftone', ready: true, params: sharedParams() }
];

Magi.defaultsFor = function (effect) {
  var values = {};
  effect.params.forEach(function (p) { values[p.id] = p.default; });
  if (effect.modes) values.mode = effect.modes[0].id;
  return values;
};
