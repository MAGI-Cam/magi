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
  // Gesture: effects driven by tracking your body. Hand and face tracking nest inside it.
  { id: 'gesture', name: 'Gesture' },
  { id: 'hand', name: 'Hand Tracking', parent: 'gesture' },
  { id: 'face', name: 'Face Tracking', parent: 'gesture' },
  { id: 'body', name: 'Body Tracking', parent: 'gesture' },
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
      { id: 'invert', name: 'Invert' },
      { id: 'print', name: 'Print' },
      { id: 'code', name: 'Code' }
    ],
    // `modes` on a parameter shows it only in those modes.
    params: [
      { id: 'bands', label: 'Bands', min: 1, max: 12, step: 1, default: 3, modes: ['acid', 'thermal'] },
      { id: 'speed', label: 'Speed', min: 0, max: 100, step: 1, default: 30, modes: ['acid', 'thermal'] },
      { id: 'dots', label: 'Dots', min: 1, max: 9, step: 1, default: 4, modes: ['print'] },
      { id: 'grain', label: 'Grain', min: 0, max: 100, step: 1, default: 60, modes: ['print'] },
      { id: 'shift', label: 'Shift', min: 0, max: 100, step: 1, default: 35, modes: ['print'] },
      { id: 'cells', label: 'Cells', min: 1, max: 9, step: 1, default: 3, modes: ['code'] },
      toggle('skeleton', 'Skeleton', true, 'Draw the hand skeleton.')
    ]
  },
  {
    id: 'wisp',
    name: 'Wisp',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'liquid', name: 'Liquid' },
      { id: 'smoke', name: 'Smoke' }
    ],
    params: [
      range('trail', 'Trail', 0, 100, 50),
      range('flow', 'Flow', 0, 100, 60),
      range('swirl', 'Swirl', 0, 100, 35),
      range('drip', 'Drip', 0, 100, 40),
      { id: 'refract', label: 'Refract', min: 0, max: 100, step: 1, default: 50, modes: ['liquid'] },
      toggle('gloss', 'Gloss', true, 'Light the surface: highlights and a bright rim.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue', modes: ['smoke'] }
    ]
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('amount', 'Amount', 0, 100, 60),
      range('size', 'Size', 0, 100, 50),
      range('float', 'Float', 0, 100, 40),
      range('wind', 'Wind', 0, 100, 35),
      toggle('pop', 'Pop', true, 'Touch a bubble with a fingertip to pop it.'),
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
      range('glow', 'Glow', 0, 100, 60),
      toggle('glyphs', 'Glyphs', true, 'Show the drifting HUD brackets around the hand.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 35, track: 'hue' }
    ]
  },

  {
    id: 'fluid-cube',
    name: 'Fluid Cube',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('size', 'Size', 30, 200, 100),
      range('particles', 'Particles', 200, 1500, 700),
      range('gravity', 'Gravity', 0, 100, 60),
      range('viscosity', 'Viscosity', 0, 100, 20),
      range('spin', 'Spin', 0, 100, 15),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 9, track: 'hue' },
      toggle('outline', 'Cube', true, 'Draw the cube’s edges.'),
      toggle('glow', 'Glow', true, 'Particles add light where they overlap.')
    ]
  },
  {
    id: 'accordion',
    name: 'Accordion',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('panels', 'Panels', 0, 100, 50),
      range('waist', 'Waist', 0, 100, 60),
      range('size', 'Size', 10, 100, 50),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 55, track: 'hue' },
      range('spread', 'Spread', 0, 100, 45),
      range('opacity', 'Opacity', 10, 100, 95),
      toggle('wires', 'Wires', true, 'Thin wires tangled through the open middle.'),
      toggle('outline', 'Outline', true, 'Black edges on each panel.'),
      toggle('line', 'Line', true, 'Show the line and distance between your palms.')
    ]
  },

  {
    id: 'tutting',
    name: 'Tutting',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'scatter', name: 'Scatter' },
      { id: 'behind', name: 'Behind' }
    ],
    params: [
      range('tiles', 'Tiles', 100, 1500, 600),
      range('size', 'Size', 0, 100, 40),
      range('fan', 'Fan', 0, 100, 70),
      range('depth', 'Depth', 0, 100, 50),
      range('drift', 'Drift', 0, 100, 30),
      range('dim', 'Dim', 0, 100, 45),
      toggle('edges', 'Edges', false, 'A hairline around each tile.')
    ]
  },
  {
    id: 'chromatic',
    name: 'Chromatic',
    group: 'hand',
    ready: true,
    modes: [
      { id: 'lab', name: 'Lab' },
      { id: 'hsl', name: 'HSL' },
      { id: 'rgb', name: 'RGB' }
    ],
    params: [
      range('size', 'Size', 30, 200, 100),
      range('labels', 'Labels', 0, 100, 35),
      range('text', 'Text', 20, 100, 45),
      range('spin', 'Spin', 0, 100, 25),
      range('dim', 'Dim', 0, 100, 70),
      toggle('squares', 'Squares', true, 'A small square at every color.'),
      toggle('axes', 'Axes', true, 'Draw the color space’s axes.')
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
    id: 'collage',
    name: 'Collage',
    group: 'face',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'eye', name: 'Eye' },
      { id: 'features', name: 'Features' }
    ],
    params: [
      range('rate', 'Rate', 0, 100, 50),
      range('count', 'Count', 8, 80, 45),
      range('size', 'Size', 0, 100, 40),
      toggle('mono', 'Mono', true, 'Gray camera with film grain.')
    ]
  },
  {
    id: 'glitch',
    name: 'Glitch',
    group: 'body',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'split', name: 'Split' },
      { id: 'blocks', name: 'Blocks' },
      { id: 'dissolve', name: 'Dissolve' }
    ],
    params: [
      range('amount', 'Amount', 0, 100, 70),
      range('block', 'Block', 1, 9, 3),
      range('speed', 'Speed', 0, 100, 40),
      toggle('hand', 'Hand', true, 'Raise your hand to glitch harder, swipe fast for a burst. Off: a steady glitch at Amount.')
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
