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

function facadeParams(shadeDefault, scaleMax, scaleDefault) {
  return [
    range('scale', 'Scale', 1, scaleMax || 9, scaleDefault || 5),
    range('response', 'Response', 0, 100, 50),
    range('speed', 'Speed', 0, 100, 50),
    toggle('shade', 'Shade', shadeDefault, 'On: modules close against bright light. Off: they open toward it.')
  ];
}

function tintParams(saturationDefault) {
  return [range('saturation', 'Saturation', 0, 100, saturationDefault), COLOR];
}

// Groups nest with `parent`. The tray's top level shows ungrouped effects and top-level groups.
Magi.effectGroups = [
  // Halftone: effects that rebuild the image from a grid of marks (pixels, characters, symbols)
  // and fake every shade of gray with how densely those marks sit.
  { id: 'halftone', name: 'Halftone' },
  { id: 'hand', name: 'Hand Tracking' },
  { id: 'face', name: 'Face Tracking' },
  { id: 'facade', name: 'Facade' }
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
      { id: 'vt323', name: 'VT323' },
      { id: 'silkscreen', name: 'Silkscreen' }
    ],
    params: halftoneParams()
  },
  {
    id: 'xs-and-os',
    name: 'XO',
    group: 'halftone',
    ready: true,
    modes: [
      { id: 'bodoni', name: 'Bodoni' },
      { id: 'silkscreen', name: 'Silkscreen' }
    ],
    params: halftoneParams()
  },

  {
    id: 'hand-landmarks',
    name: 'Landmarks',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      toggle('readouts', 'Readouts', true, 'Show which hand it is, the tracking score and rotation.'),
      toggle('pinch', 'Pinch', true, 'Show the thumb–index line and pinch value.'),
      toggle('distance', 'Distance', true, 'Show the line and distance between two hands.')
    ]
  },
  {
    id: 'mosh',
    name: 'Mosh',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('scale', 'Scale', 0, 100, 50),
      range('block', 'Block', 1, 9, 5),
      range('hold', 'Hold', 0, 100, 40),
      range('reach', 'Reach', 0, 100, 50)
    ]
  },

  {
    id: 'pinch-frame',
    name: 'Pinch Frame',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'acid', name: 'Acid' },
      { id: 'thermal', name: 'Thermal' },
      { id: 'invert', name: 'Invert' }
    ],
    params: [
      range('bands', 'Bands', 1, 12, 3),
      range('speed', 'Speed', 0, 100, 30),
      toggle('skeleton', 'Skeleton', true, 'Draw the hand skeleton.')
    ]
  },
  {
    id: 'claw',
    name: 'Claw',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('claw', 'Claw', 0, 100, 35),
      toggle('glyphs', 'Glyphs', true, 'Show the drifting HUD brackets around the hand.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 35, track: 'hue' }
    ]
  },

  {
    id: 'face-landmarks',
    name: 'Landmarks',
    group: 'face',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      toggle('mesh', 'Mesh', true, 'Draw all 478 points as a triangle mesh.'),
      toggle('readouts', 'Readouts', true, 'Show head pose and the strongest expressions.')
    ]
  },
  {
    id: 'token-cry',
    name: 'Token Cry',
    group: 'face',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      { id: 'text', label: 'Text', type: 'text', default: 'i’m fine ', placeholder: 'Type your tears', maxLength: 280 },
      range('speed', 'Speed', 1, 100, 40),
      range('scale', 'Scale', 1, 100, 30),
      toggle('phrase', 'Phrase', false, 'On: each tear is the whole phrase. Off: one symbol at a time.'),
      toggle('pool', 'Pool', true, 'On: tokens pile up at the bottom of the frame. Off: they fall through.'),
      toggle('inverse', 'Inverse', false, 'Tokens invert the colors beneath them.'),
      COLOR
    ]
  },

  {
    id: 'facade-interactive',
    name: 'Interactive',
    group: 'facade',
    ready: true,
    params: facadeParams(true, 13, 9).concat(tintParams(0))
  },
  {
    id: 'facade-electrokinetic',
    name: 'Electrokinetic',
    group: 'facade',
    ready: true,
    modes: [
      { id: 'circle', name: 'Circle' },
      { id: 'square', name: 'Square' },
      { id: 'hexagon', name: 'Hexagon' },
      { id: 'triangle', name: 'Triangle' },
      { id: 'diamond', name: 'Diamond' }
    ],
    // Pixel glazing displays the image: by default pixels spread where it is bright, in its own
    // colors. Here Saturation scales the colors' saturation and Color rotates their hues.
    params: facadeParams(false, 12, 6).concat(tintParams(100))
  }
];

Magi.defaultsFor = function (effect) {
  var values = {};
  effect.params.forEach(function (p) { values[p.id] = p.default; });
  if (effect.modes) values.mode = effect.modes[0].id;
  return values;
};
