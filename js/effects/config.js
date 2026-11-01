// Effect definitions: names, order, grouping, modes and adjustable parameters.
// Rendering code lives in each effect's file and registers itself in Magi.renderers.
//
// Parameter types: range (default; min, max, step), toggle (on/off, `hint` explains it),
// text (free text from any keyboard). track: 'hue' draws a range as a color spectrum.
window.Magi = window.Magi || {};
Magi.renderers = Magi.renderers || {};

function range(id, label, min, max, def) {
  return { id: id, label: label, min: min, max: max, step: 1, default: def };
}
function toggle(id, label, def, hint) {
  return { id: id, label: label, type: 'toggle', default: def, hint: hint };
}
var COLOR = { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' };

function halftoneParams() {
  return [
    range('scale', 'Scale', 1, 9, 5),
    range('intensity', 'Intensity', 0, 100, 50),
    range('saturation', 'Saturation', 0, 100, 0),
    COLOR
  ];
}

function facadeParams(shadeDefault) {
  return [
    range('scale', 'Scale', 1, 9, 5),
    range('response', 'Response', 0, 100, 50),
    range('speed', 'Speed', 0, 100, 50),
    toggle('shade', 'Shade', shadeDefault, 'On: modules close against bright light. Off: they open toward it.')
  ];
}

function ifsParams(maxDepth, def) {
  return [
    range('depth', 'Depth', 0, maxDepth, def),
    range('size', 'Size', 10, 100, 85),
    range('spin', 'Spin', 0, 100, 0),
    toggle('recursive', 'Recursive', true, 'On: every piece holds the whole image. Off: the shape is a window onto the camera.'),
    toggle('notation', 'Notation', true, 'Show the formula in the corner.')
  ];
}

function circleParams() {
  return [
    range('size', 'Size', 10, 100, 80),
    range('spin', 'Spin', 0, 100, 0),
    range('weight', 'Weight', 1, 9, 3),
    toggle('parity', 'Parity', true, 'Invert the image where an odd number of circles overlap.'),
    toggle('notation', 'Notation', true, 'Show the construction in the corner.')
  ];
}

// Groups nest with `parent`. The tray's top level shows ungrouped effects and top-level groups.
Magi.effectGroups = [
  // Halftone: effects that rebuild the image from a grid of marks (pixels, characters, symbols)
  // and fake every shade of gray with how densely those marks sit.
  { id: 'halftone', name: 'Halftone' },
  { id: 'hand', name: 'Hand Tracking' },
  { id: 'face', name: 'Face Tracking' },
  { id: 'geometry', name: 'Geometry' },
  { id: 'facade', name: 'Facade', parent: 'geometry' },
  { id: 'fractal', name: 'Fractal', parent: 'geometry' }
];

Magi.effectConfig = [
  // Normal has no renderer: the camera or media is shown as is. Photographic effects save
  // JPEG (photoType); the rest keep PNG for exact edges.
  { id: 'normal', name: 'Normal', ready: true, params: [], photoType: 'image/jpeg' },

  { id: 'bitmap', name: 'Bitmap', group: 'halftone', ready: true, params: halftoneParams() },
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
    params: halftoneParams()
  },
  {
    id: 'binary',
    name: 'Binary',
    group: 'halftone',
    ready: true,
    modes: [
      { id: 'system', name: 'System' },
      { id: 'plex', name: 'Plex Mono' },
      { id: 'space', name: 'Space Mono' },
      { id: 'vt323', name: 'VT323' },
      { id: 'silkscreen', name: 'Silkscreen' }
    ],
    params: halftoneParams()
  },
  {
    id: 'xs-and-os',
    name: "X's and O's",
    group: 'halftone',
    ready: true,
    modes: [
      { id: 'drawn', name: 'Drawn' },
      { id: 'bodoni', name: 'Bodoni' },
      { id: 'plex', name: 'Plex Mono' },
      { id: 'space', name: 'Space Mono' },
      { id: 'silkscreen', name: 'Silkscreen' }
    ],
    params: halftoneParams()
  },

  {
    id: 'mosh',
    name: 'Mosh',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('block', 'Block', 1, 9, 5),
      range('hold', 'Hold', 0, 100, 40),
      range('reach', 'Reach', 0, 100, 50)
    ]
  },

  {
    id: 'text-cry',
    name: 'Text Cry',
    group: 'face',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      { id: 'text', label: 'Text', type: 'text', default: 'i’m fine ', placeholder: 'Type your tears', maxLength: 280 },
      range('speed', 'Speed', 1, 100, 40),
      range('size', 'Size', 1, 100, 35),
      toggle('pool', 'Pool', true, 'On: letters pool at the bottom of the frame. Off: they fall through.'),
      COLOR
    ]
  },

  { id: 'facade-interactive', name: 'Interactive', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-active', name: 'Active', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-biomimetic', name: 'Biomimetic', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-smart', name: 'Smart', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-bending', name: 'Bending', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-translation', name: 'Translation', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-scaling', name: 'Scaling', group: 'facade', ready: true, params: facadeParams(true) },
  { id: 'facade-rolling', name: 'Rolling', group: 'facade', ready: true, params: facadeParams(true) },
  // Pixel glazing displays the image, so by default its pixels spread where the image is bright.
  { id: 'facade-electrokinetic', name: 'Electrokinetic', group: 'facade', ready: true, params: facadeParams(false) },

  { id: 'fractal-vicsek', name: 'Vicsek', group: 'fractal', ready: true, params: ifsParams(5, 3) },
  { id: 'fractal-sierpinski', name: 'Sierpiński', group: 'fractal', ready: true, params: ifsParams(8, 5) },
  {
    id: 'fractal-anti-snowflake',
    name: 'Anti-snowflake',
    group: 'fractal',
    ready: true,
    params: [
      range('depth', 'Depth', 0, 6, 4),
      range('size', 'Size', 10, 100, 85),
      range('spin', 'Spin', 0, 100, 0),
      toggle('notation', 'Notation', true, 'Show the formula in the corner.')
    ]
  },
  { id: 'fractal-metatron', name: 'Metatron’s Cube', group: 'fractal', ready: true, params: circleParams() },
  { id: 'fractal-vesica', name: 'Vesica Piscis', group: 'fractal', ready: true, params: circleParams() },
  { id: 'fractal-egg', name: 'Egg of Life', group: 'fractal', ready: true, params: circleParams() }
];

Magi.defaultsFor = function (effect) {
  var values = {};
  effect.params.forEach(function (p) { values[p.id] = p.default; });
  if (effect.modes) values.mode = effect.modes[0].id;
  return values;
};
