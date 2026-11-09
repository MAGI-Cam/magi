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
  // Spacenet: words strung through space (on your body, or free in the room).
  { id: 'spacenet', name: 'Spacenet', parent: 'gesture' },
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
    modes: [
      { id: 'skeleton', name: 'Skeleton' },
      { id: 'controller', name: 'Controller' },
      { id: 'link', name: 'Link' },
      { id: 'contour', name: 'Contour' },
      { id: 'filaments', name: 'Filaments' },
      { id: 'attention', name: 'Attention' },
      { id: 'sequencer', name: 'Sequencer' },
      { id: 'rabinovich', name: 'Rabinovich' },
      { id: 'cohesion', name: 'Cohesion' },
      { id: 'pollinate', name: 'Pollinate' },
      { id: 'zero', name: 'Zero' }
    ],
    params: [
      { id: 'readouts', label: 'Readouts', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show which hand it is, the tracking score and rotation.' },
      { id: 'pinch', label: 'Pinch', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show the thumb–index line and pinch value.' },
      { id: 'distance', label: 'Distance', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show the line and distance between two hands.' },
      { id: 'fingers', label: 'Fingers', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show the gaps between neighboring fingertips on each hand.' },
      { id: 'pairs', label: 'Pairs', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show the distances between matching fingertips of your left and right hands.' },
      { id: 'signals', label: 'Signals', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show what MAGI reads from each hand: fingers, curl, spread, pinches, speed and motions.' },
      { id: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, default: 85, modes: ['controller'] },
      { id: 'style', label: 'Style', min: 0, max: 2, step: 1, default: 0, modes: ['contour'] },
      { id: 'points', label: 'Points', min: 40, max: 600, step: 1, default: 260, modes: ['contour'] },
      { id: 'rate', label: 'Rate', min: 0, max: 100, step: 1, default: 40, modes: ['contour'] },
      { id: 'labels', label: 'Labels', type: 'toggle', default: true, modes: ['contour'], hint: 'Edge-strength readouts beside the points.' },
      { id: 'strands', label: 'Strands', min: 2, max: 14, step: 1, default: 7, modes: ['filaments'] },
      { id: 'glow', label: 'Glow', min: 0, max: 100, step: 1, default: 60, modes: ['filaments'] },
      { id: 'view', label: 'View', min: 0, max: 1, step: 1, default: 0, modes: ['attention'] },
      { id: 'feed', label: 'Feed', type: 'text', default: '', placeholder: 'Feed URL or Are.na channel', maxLength: 300, modes: ['attention'] },
      { id: 'tempo', label: 'Tempo', min: 60, max: 180, step: 1, default: 110, modes: ['sequencer'] },
      { id: 'sound', label: 'Sound', type: 'toggle', default: false, modes: ['sequencer'], hint: 'Play the rings (kick, snare, hi-hat); recorded into videos.' },
      { id: 'fdim', label: 'Dim', min: 0, max: 100, step: 1, default: 0, modes: ['filaments'] },
      { id: 'dim', label: 'Dim', min: 0, max: 100, step: 1, default: 45, modes: ['sequencer', 'rabinovich', 'cohesion', 'pollinate', 'zero'] },
      { id: 'speed', label: 'Speed', min: 0, max: 100, step: 1, default: 50, modes: ['rabinovich'] },
      { id: 'trail', label: 'Trail', min: 0, max: 100, step: 1, default: 70, modes: ['rabinovich'] },
      { id: 'size', label: 'Size', min: 0, max: 100, step: 1, default: 50, modes: ['rabinovich'] },
      { id: 'strength', label: 'Strength', min: 0, max: 100, step: 1, default: 50, modes: ['rabinovich'] },
      { id: 'zcount', label: 'Count', min: 300, max: 3000, step: 1, default: 1200, modes: ['zero'] },
      { id: 'zsize', label: 'Size', min: 0, max: 100, step: 1, default: 50, modes: ['zero'] },
      { id: 'ztext', label: 'Text', min: 0, max: 100, step: 1, default: 40, modes: ['zero'] },
      { id: 'ztwist', label: 'Twist', min: 0, max: 100, step: 1, default: 60, modes: ['zero'] },
      { id: 'zcurl', label: 'Curl', min: 0, max: 100, step: 1, default: 60, modes: ['zero'] },
      { id: 'zspin', label: 'Spin', min: 0, max: 100, step: 1, default: 30, modes: ['zero'] },
      { id: 'zglow', label: 'Glow', min: 0, max: 100, step: 1, default: 40, modes: ['zero'] },
      { id: 'zcube', label: 'Cube', type: 'toggle', default: true, modes: ['zero'], hint: 'The wireframe cube and the lines inside the sphere.' },
      { id: 'zcolor', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue', modes: ['zero'] }
    ]
  },
  {
    id: 'font',
    name: 'Font',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('letter', 'Letter', 0, 25, 10),
      range('distortion', 'Distortion', 0, 100, 0),
      range('smoothness', 'Smoothness', 0, 100, 0),
      range('face', 'Face', 0, 4, 0),
      range('dim', 'Dim', 0, 100, 60),
      toggle('guide', 'Guide', true, 'Show the three grips on screen.')
    ]
  },
  {
    id: 'line-art',
    name: 'Line Art',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('size', 'Size', 0, 100, 10),
      range('thickness', 'Thickness', 0, 100, 100),
      range('texture', 'Texture', 0, 100, 75),
      range('spikiness', 'Spikiness', 0, 100, 100),
      range('rate', 'Rate', 0, 100, 30),
      range('points', 'Points', 40, 600, 200),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('dim', 'Dim', 0, 100, 0),
      toggle('connect', 'Connect', false, 'One line through both hands, with strands between matching fingertips. Off: a line per hand.')
    ]
  },
  {
    id: 'particles',
    name: 'Particles',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('count', 'Count', 200, 5000, 2600),
      range('stiffness', 'Stiffness', 0, 100, 35),
      range('damping', 'Damping', 0, 100, 30),
      range('push', 'Push', 0, 100, 50),
      range('reach', 'Reach', 0, 100, 40),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('glow', 'Glow', 0, 100, 40),
      range('dim', 'Dim', 0, 100, 0),
      toggle('hide', 'Hide', true, 'Hide resting particles: only the ones your hand moves show.'),
      toggle('pointer', 'Pointer', true, 'A red dot on your index fingertip.'),
      { id: 'text', label: 'Text', type: 'text', default: '', placeholder: 'Any characters (empty: whole screen)', maxLength: 40 }
    ]
  },
  {
    id: 'particle-life',
    name: 'Particle Life',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'worms', name: 'Worms' },
      { id: 'glow', name: 'Glow' }
    ],
    params: [
      range('count', 'Count', 200, 2000, 900),
      range('types', 'Types', 2, 8, 5),
      range('radius', 'Radius', 0, 100, 35),
      range('force', 'Force', 0, 100, 50),
      range('friction', 'Friction', 0, 100, 30),
      range('trail', 'Trail', 0, 100, 60),
      range('thickness', 'Thickness', 0, 100, 30),
      range('size', 'Size', 0, 100, 20),
      { id: 'glow', label: 'Glow', min: 0, max: 100, step: 1, default: 35, modes: ['glow'] },
      range('profile', 'Profile', 0, 100, 0),
      range('dim', 'Dim', 0, 100, 40)
    ]
  },
  {
    id: 'exhale',
    name: 'Exhale',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'sphere', name: 'Sphere' },
      { id: 'zero', name: 'Zero' },
      { id: 'binary', name: 'Binary' }
    ],
    params: [
      range('count', 'Count', 500, 6000, 1800),
      range('size', 'Size', 0, 100, 100),
      range('bristles', 'Bristles', 0, 100, 60),
      range('rate', 'Rate', 2, 20, 6),
      range('speed', 'Speed', 0, 100, 10),
      range('fluidity', 'Fluidity', 0, 100, 30),
      range('glow', 'Glow', 0, 100, 40),
      range('flash', 'Flash', 0, 100, 50),
      toggle('dissipate', 'Dissipate', false, 'With no hand up, the particles drift away and fade; they gather back when a hand returns.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('dim', 'Dim', 0, 100, 90)
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
    id: 'datamosh',
    name: 'Mosh 2.0',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('block', 'Block', 1, 9, 4),
      range('scale', 'Scale', 0, 100, 50),
      range('bloom', 'Bloom', 0, 100, 50),
      range('residual', 'Residual', 0, 100, 0),
      range('keyframes', 'Keyframes', 0, 100, 0),
      toggle('hand', 'Hand', true, 'Pinch starts the mosh, an open hand releases it. Off: it always moshes.')
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
      { id: 'blur', name: 'Blur' },
      { id: 'print', name: 'Print' },
      { id: 'code', name: 'Code' }
    ],
    // `modes` on a parameter shows it only in those modes.
    params: [
      { id: 'bands', label: 'Bands', min: 1, max: 12, step: 1, default: 1, modes: ['acid', 'thermal'] },
      { id: 'blur', label: 'Blur', min: 0, max: 100, step: 1, default: 40, modes: ['blur'] },
      { id: 'frost', label: 'Frosted', type: 'toggle', default: false, modes: ['blur'], hint: 'Frosted glass: scattered, hazy and grainy.' },
      { id: 'mosaic', label: 'Mosaic', min: 0, max: 100, step: 1, default: 0, modes: ['blur'] },
      { id: 'speed', label: 'Speed', min: 0, max: 100, step: 1, default: 30, modes: ['acid', 'thermal'] },
      { id: 'line', label: 'Line', type: 'toggle', default: false, modes: ['acid', 'thermal', 'invert', 'blur', 'print'], hint: 'A crisp outline around the window, or around each sheet.' },
      { id: 'border', label: 'Border', type: 'toggle', default: true, modes: ['print'], hint: 'A white paper margin around the print. Off: full bleed.' },
      { id: 'sheets', label: 'Sheets', min: 1, max: 4, step: 1, default: 1, modes: ['print'] },
      { id: 'dots', label: 'Dots', min: 1, max: 9, step: 1, default: 4, modes: ['print'] },
      { id: 'grain', label: 'Grain', min: 0, max: 100, step: 1, default: 60, modes: ['print'] },
      { id: 'shift', label: 'Shift', min: 0, max: 100, step: 1, default: 35, modes: ['print'] },
      { id: 'cells', label: 'Cells', min: 1, max: 9, step: 1, default: 3, modes: ['code'] },
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue', modes: ['code'] },
      { id: 'lock', label: 'Lock', type: 'toggle', default: true, modes: ['code'], hint: 'On: corners stay where you let go of them; a fist frees that hand’s corner. Off: the box follows your pinches.' },
      { id: 'outside', label: 'Outside', type: 'toggle', default: false, modes: ['code'], hint: 'Code everything outside the box; the box stays live.' },
      { id: 'solid', label: 'Solid', type: 'toggle', default: false, modes: ['code'], hint: 'Fill the area with one flat color (Color) instead of code.' },
      toggle('skeleton', 'Skeleton', false, 'Draw the hand skeleton.')
    ]
  },
  {
    id: 'wisp',
    name: 'Wisp',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'smoke', name: 'Smoke' },
      { id: 'watercolor', name: 'Watercolor' }
    ],
    params: [
      { id: 'trail', label: 'Trail', min: 0, max: 100, step: 1, default: 50, modes: ['smoke'] },
      { id: 'flow', label: 'Flow', min: 0, max: 100, step: 1, default: 60, modes: ['smoke'] },
      { id: 'swirl', label: 'Swirl', min: 0, max: 100, step: 1, default: 45, modes: ['smoke'] },
      { id: 'rise', label: 'Rise', min: 0, max: 100, step: 1, default: 30, modes: ['smoke'] },
      { id: 'wtrail', label: 'Trail', min: 0, max: 100, step: 1, default: 0, modes: ['watercolor'] },
      { id: 'wflow', label: 'Flow', min: 0, max: 100, step: 1, default: 0, modes: ['watercolor'] },
      { id: 'wswirl', label: 'Swirl', min: 0, max: 100, step: 1, default: 30, modes: ['watercolor'] },
      { id: 'colors', label: 'Colors', min: 0, max: 100, step: 1, default: 4, modes: ['watercolor'] },
      { id: 'edges', label: 'Edges', min: 0, max: 100, step: 1, default: 50, modes: ['watercolor'] },
      { id: 'dark', label: 'Dark', type: 'toggle', default: false, modes: ['watercolor'], hint: 'Paint on black paper instead of white.' }
    ]
  },
  {
    id: 'web',
    name: 'Web',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('rings', 'Rings', 0, 5, 3),
      range('sag', 'Sag', 0, 100, 35),
      range('particles', 'Particles', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 60),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' }
    ]
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'soap', name: 'Soap' },
      { id: 'neon', name: 'Neon' },
      { id: 'inverse', name: 'Inverse' },
      { id: 'electro', name: 'Electrokinetic' }
    ],
    params: [
      range('amount', 'Amount', 0, 100, 60),
      range('size', 'Size', 0, 100, 50),
      range('float', 'Float', 0, 100, 40),
      range('wind', 'Wind', 0, 100, 35),
      range('profile', 'Profile', 0, 100, 0),
      toggle('wand', 'Wand', true, 'Pinch thumb and index: a bubble grows while you hold and floats off when you let go.'),
      toggle('pop', 'Pop', true, 'Touch a bubble with a fingertip to pop it.'),
      toggle('skeleton', 'Skeleton', false, 'Draw the hand skeleton.')
    ]
  },
  {
    id: 'claw',
    name: 'Claw',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('claw', 'Talons', 0, 100, 35),
      range('size', 'Size', 0, 100, 50),
      range('offsetX', 'X', -100, 100, 0),
      range('offsetY', 'Y', -100, 100, -7),
      range('glow', 'Glow', 0, 100, 80),
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
      range('size', 'Size', 0, 100, 10),
      range('particles', 'Particles', 500, 3000, 1000),
      range('gravity', 'Gravity', 0, 100, 100),
      range('viscosity', 'Viscosity', 0, 100, 50),
      range('orbit', 'Orbit', 0, 100, 0),
      range('spin', 'Spin', 0, 100, 0),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 9, track: 'hue' },
      toggle('outline', 'Cube', true, 'Draw the cube’s edges.'),
      toggle('glow', 'Glow', true, 'Particles add light where they overlap.'),
      toggle('readouts', 'Readouts', true, 'Show the simulation’s numbers and the hand’s position and rotation.')
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
      range('size', 'Size', 10, 100, 30),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 55, track: 'hue' },
      range('spread', 'Spread', 0, 100, 45),
      range('opacity', 'Opacity', 10, 100, 50),
      toggle('outline', 'Outline', false, 'Black edges on each panel.'),
      toggle('line', 'Line', false, 'Show the line and distance between your palms.')
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
      range('squish', 'Squish', 0, 100, 0),
      range('dim', 'Dim', 0, 100, 0),
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
      range('dim', 'Dim', 0, 100, 0),
      toggle('squares', 'Squares', true, 'A small square at every color.'),
      toggle('axes', 'Axes', true, 'Draw the color space’s axes.')
    ]
  },
  {
    id: 'tendrils',
    name: 'Tendrils',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'neon', name: 'Neon' },
      { id: 'silk', name: 'Silk' }
    ],
    params: [
      range('count', 'Count', 0, 100, 50),
      range('curl', 'Curl', 0, 100, 50),
      range('length', 'Length', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 60),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' }
    ]
  },
  {
    id: 'fibre',
    name: 'Fibre',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'light', name: 'Light' },
      { id: 'ink', name: 'Ink' }
    ],
    params: [
      range('count', 'Count', 20, 1000, 250),
      range('size', 'Size', 0, 100, 50),
      range('turbulence', 'Turbulence', 0, 100, 65),
      range('scale', 'Scale', 0, 100, 60),
      range('hold', 'Hold', 0, 100, 30),
      range('trails', 'Trails', 0, 100, 75),
      range('exposure', 'Exposure', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 35),
      toggle('camera', 'Camera', false, 'Each particle takes the color of the video under it.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('dim', 'Dim', 0, 100, 90)
    ]
  },
  {
    id: 'particle-cloud',
    name: 'Particle Cloud',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'light', name: 'Light' },
      { id: 'ink', name: 'Ink' }
    ],
    params: [
      range('count', 'Count', 20, 1000, 300),
      range('turbulence', 'Turbulence', 0, 100, 50),
      range('scale', 'Scale', 0, 100, 40),
      range('hold', 'Hold', 0, 100, 50),
      range('trails', 'Trails', 0, 100, 40),
      range('exposure', 'Exposure', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 40),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('dim', 'Dim', 0, 100, 85)
    ]
  },
  {
    id: 'pseudo-plexus',
    name: 'Pseudo Plexus',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'light', name: 'Light' },
      { id: 'ink', name: 'Ink' }
    ],
    params: [
      range('count', 'Count', 2, 100, 6),
      range('links', 'Links', 1, 6, 4),
      range('reach', 'Reach', 0, 100, 65),
      range('lines', 'Lines', 0, 100, 70),
      range('turbulence', 'Turbulence', 0, 100, 30),
      range('scale', 'Scale', 0, 100, 40),
      range('hold', 'Hold', 0, 100, 50),
      range('trails', 'Trails', 0, 100, 0),
      range('exposure', 'Exposure', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 15),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      range('dim', 'Dim', 0, 100, 90)
    ]
  },
  {
    id: 'cards',
    name: 'Cards',
    group: 'hand',
    ready: true,
    photoType: 'image/jpeg',
    modes: [
      { id: 'ribbon', name: 'Ribbon' },
      { id: 'ring', name: 'Ring' },
      { id: 'lattice', name: 'Lattice' }
    ],
    params: [
      range('count', 'Count', 12, 120, 60),
      range('size', 'Size', 0, 100, 50),
      range('spin', 'Spin', 0, 100, 30),
      toggle('inset', 'Inset', true, 'Flat background with the camera in a small window.'),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 0, track: 'hue' },
      { id: 'text', label: 'Text', type: 'text', default: '', placeholder: 'Words along the structure', maxLength: 60 },
      { id: 'feed', label: 'Feed', type: 'text', default: '', placeholder: 'Feed URL or Are.na channel', maxLength: 300 }
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
      range('count', 'Count', 3, 100, 12),
      range('size', 'Size', 0, 100, 40),
      range('posX', 'X', -100, 100, 0),
      range('posY', 'Y', -100, 100, 0),
      toggle('sphere', 'Sphere', true, 'Show the wireframe sphere on your palm.'),
      range('mosaic', 'Mosaic', 0, 100, 8),
      range('mono', 'Mono', 0, 100, 100)
    ]
  },
  {
    id: 'word-box',
    name: 'Word Box',
    group: 'spacenet',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      { id: 'text', label: 'Text', type: 'text', default: '', placeholder: 'Type in any language or keyboard', maxLength: 400 },
      range('set', 'Set', 0, 5, 0),
      range('points', 'Points', 80, 900, 420),
      range('links', 'Links', 1, 6, 3),
      range('size', 'Size', 0, 100, 30),
      range('hands', 'Hands', 0, 100, 30),
      range('zoom', 'Zoom', 0, 100, 50),
      range('rotation', 'Rotation', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 60),
      toggle('box', 'Box', false, 'The turning wireframe box under the figure.'),
      range('dim', 'Dim', 0, 100, 100)
    ]
  },
  {
    id: 'word-space',
    name: 'Word Space',
    group: 'spacenet',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      { id: 'text', label: 'Text', type: 'text', default: '', placeholder: 'Type in any language or keyboard', maxLength: 400 },
      range('set', 'Set', 0, 5, 0),
      range('points', 'Points', 60, 700, 260),
      range('links', 'Links', 1, 6, 3),
      range('size', 'Size', 0, 100, 30),
      range('flow', 'Flow', 0, 100, 40),
      range('depth', 'Depth', 0, 100, 60),
      range('rotation', 'Rotation', 0, 100, 50),
      range('glow', 'Glow', 0, 100, 60),
      range('dim', 'Dim', 0, 100, 20)
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
      { id: 'spread', label: 'Spread', min: 0, max: 100, step: 1, default: 40, modes: ['dissolve'] },
      range('profile', 'Profile', 0, 5, 0),
      { id: 'depth', label: 'Depth', type: 'toggle', default: false, modes: ['blocks', 'dissolve'], hint: 'Bigger blocks the closer you are to the camera.' },
      { id: 'neon', label: 'Overexposed', type: 'toggle', default: true, modes: ['blocks'], hint: 'Include blown-out blocks decoded at 1 bit per channel.' },
      toggle('hand', 'Hand', true, 'Your hand controls the glitch; a fist stops it. Off: a steady glitch at Amount.')
    ]
  },

  {
    id: 'facade-interactive',
    name: 'Interactive',
    group: 'facade',
    ready: true,
    params: facadeParams(true, 13, 9).concat([range('opacity', 'Opacity', 0, 100, 75)], tintParams(100))
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
  },
  {
    id: 'quadtree',
    name: 'Quadtree',
    group: 'facade',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('detail', 'Detail', 0, 100, 60),
      range('min', 'Min', 2, 24, 4),
      range('max', 'Max', 8, 256, 128),
      range('blur', 'Blur', 0, 100, 50),
      range('lines', 'Lines', 0, 100, 20),
      COLOR
    ]
  }
];

Magi.defaultsFor = function (effect) {
  var values = {};
  effect.params.forEach(function (p) { values[p.id] = p.default; });
  if (effect.modes) values.mode = effect.modes[0].id;
  return values;
};

// The Advanced panel under each effect's controls: what it does, its gestures and parameters.
// "Term: text" lines show the term emphasized.
Magi.effectGuides = {
  bitmap: [
    'How it works: 8×8 ordered (Bayer) dithering on a square grid; gray comes from how many pixels are on.',
    'Scale: pixel size. Intensity: contrast around mid-gray.',
    'Saturation: how much of the picture’s own color shows. Color: ink hue (far left is white).'
  ],
  ascii: [
    'How it works: one character per cell, picked by how much ink it has. Tap the tile to change mode.',
    'Modes: Classic, Detailed (70 characters), Blocks, Braille (2×4 dots per cell), Edges (strokes along edges).',
    'Scale: cell size on screen. Intensity: contrast. Saturation and Color: as in Bitmap.'
  ],
  binary: [
    'How it works: only 0, 1 and space, picked by brightness. Tap the tile to switch font (VT323, Silkscreen).',
    'Scale, Intensity, Saturation, Color: as in Bitmap.'
  ],
  'xs-and-os': [
    'How it works: x, o, X and O by brightness. Tap the tile to switch font (Bodoni, Silkscreen).',
    'Scale, Intensity, Saturation, Color: as in Bitmap.'
  ],
  quadtree: [
    'How it works: a quadtree. Squares split into four while their brightness varies too much; in focus they split readily, out of focus only at strong edges, so sharp detail breaks into fine cells that keep the picture and the bokeh stays in big flat squares of its average color.',
    'Bokeh: a lens blur. You stay in focus and the room blurs, by the thin-lens circle of confusion (needs a person in view).',
    'Pinch: focus moves to what’s under your pinch, and blur grows with distance from it. Make a fist: focus goes back to you.',
    'Detail: how readily squares split. Min, Max: smallest and largest square. Blur: bokeh strength. Lines: outline opacity. Color: line tint (far left: white).'
  ],
  'hand-landmarks': [
    'How it works: the 21-point hand skeleton MediaPipe tracks, with the measurements effects use.',
    'Readouts: left or right hand, tracking score, rotation (0° = fingers up).',
    'Pinch: thumb–index distance in palm lengths; “closed” when pinched.',
    'Distance: line and distance between two palms, as a share of the frame width.',
    'Fingers: gaps between neighboring fingertips, in palm lengths.',
    'Pairs: distances between matching fingertips of your two hands.',
    'Signals: what MAGI reads from your hand: finger count, curl, spread, pinches, speed, last swipe, flick or shake.',
    'Modes: tap the tile. Skeleton (the toggles above), Controller, Link.',
    'Controller: a circle spans your thumb and index fingertips and grows as they open; it slides along the ruler, and its value is your position across the frame. It’s an outline while your hand is open and fills as you pinch; Opacity: the fullest fill.',
    'Controller, index only (thumb tucked): the circle shrinks to a pointer dot on your fingertip and keeps sliding. Two hands: the second hand gets its own circle, value and ring stack on the right.',
    'Controller: rings swell as thumb and index open. Node map: your hand redrawn small, fingertips trailing smooth curves. Graph: the value held every quarter second, scrolling down as a staircase (hand 2 in gray, to the left).',
    'Link: two hands; a line joins your index fingertips with their distance at the green midpoint; the scope shows your fingertips around the palm.',
    'Contour: points gather on the outlines of your hands and arms (drawn where the picture’s edges are strongest). Style 0 Points with readouts, 1 Path (a nearest-neighbor tour through them), 2 Fill (that path as a flat lime shape). Pinch to step through the styles. Points: how many. Rate: how often they’re redrawn. Labels: the readouts.',
    'Filaments: bundles of glowing strands strung along your bones, between fingertips and across both hands; they flex as you move, with bright pulses running along them. Strands: per bundle. Glow, Dim: light and background.',
    'Attention: your image library as a Mapper graph: images that look alike gather into nodes, and nodes that share images are linked. View 0 Graph, 1 PCA (each image by its two main directions of variation). Feed: a JSON feed or Are.na channel; images with an embedding in the feed are grouped by it, others by color. Without a feed, camera snapshots stand in.',
    'Attention gestures: point (only the index up) to select the node under your fingertip and fan out its images; a fist pulls the graph in; an open palm spreads it out.',
    'Sequencer: three rings of Euclidean rhythms (events spread as evenly as possible over the steps). Grip and turn like a knob to change a ring’s number of events: thumb and index out for red, add the middle finger for yellow, all five for blue. Close your hand to randomize where the events sit. Tempo: speed. Sound: kick, snare and hi-hat, recorded into videos. Dim: darkens the camera.',
    'Rabinovich: thousands of points ride the Rabinovich–Fabrikant equations. Open thumb and index to raise α (0.1 → 1.3) and reshape the attractor; turn and raise your hand to turn the view. Two hands: two attractors, one per hand. Speed, Trail, Size, Dim. Strength: how bright and thick the trails are.',
    'Cohesion: a chord diagram of your hand’s 21 landmarks. Pairs close together are joined, so a fist fills the circle and spread fingers thin it; the level reads at the top with its recent history. Two hands: all 42 landmarks, chords across the hands in white as they come together, and each hand’s level plus the hands’ cohesion.',
    'Pollinate: point with your index finger: a small pad appears there, and only your index finger moves it (by pushing past an edge). Your fingertip’s place on it picks two concepts (across, down). Hold still on a cell for half a second: the cell is marked in red and they pollinate into “A + B = ?” and an idea that decodes on the right. Fist: clears the marks. The two concepts under the crosshair are named beside the pad.',
    'Zero: a sphere of digits (each latitude band counts 0–9) with a wireframe cube inside, bent by real shape operators (twist, bend, and a collapse onto its equator), with the formulas and live values in the top-left corner. Pinch and drag: turns it. Spread thumb and index: twists it (roll left to reverse). Fist: collapses it into a flat ring, a zero; open palm: blooms back. Two hands: closer curls it tighter. Swipe left/right: shuffles the digits; up/down: new lines in the cube. Count, Size, Text, Twist, Curl, Spin, Glow, Cube, Color, Dim.',
  ],
  'line-art': [
    'How it works: points gather on the outlines of your hands and arms (where the picture’s edges are strongest) and one continuous line runs through them, always to the nearest point, redrawn as you move.',
    'Pinch: freezes the drawing until you let go.',
    'Close your palm: the drawing shrinks; open it: the drawing expands. Size: how large the drawing is around each hand. Connect: one line through both hands with strands between matching fingertips (off: each hand its own line).',
    'Thickness: line width. Texture: a highlighter / marker stroke: translucent ink with darker edges and fine streaks, fixed to the line. Spikiness: 0 rounded curves, 50 straight lines, 100 sharp spikes. Rate: how often it redraws. Points: how many. Color: far left lime. Dim: darkens the camera.'
  ],
  particles: [
    'How it works: every particle sits on a damped spring to its resting place; your fingertips push particles away as they pass, and the field springs back behind them. Moving particles light up and streak.',
    'Count: how many. Stiffness: how fast they spring back. Damping: how quickly they settle (low: they wobble). Push, Reach: how hard and how far your fingertips push.',
    'Text: type any characters to make the particles form them (empty: the whole screen). Hide: only the particles your hand moves show. Pointer: a red dot on your index fingertip. Color, Glow: tint and halo. Dim: darkens the camera.'
  ],
  'particle-life': [
    'How it works: every color is a species. Each species feels every other one as an attraction or a repulsion, set by a hidden random table that isn’t symmetric: red may chase yellow while yellow runs from red. Up close, everything pushes apart so particles never overlap.',
    'Colors, in order (Original profile): 1 red, 2 yellow, 3 blue, 4 green, 5 violet, 6 pink, 7 cyan, 8 white (Types sets how many are in play).',
    'What you see: species that attract their own kind clump into cells; a species chasing one that flees forms worms and trails; mutual attraction makes orbits and swirls; mutual repulsion spreads them apart.',
    'Your fingertip shows the color it holds: hold up 1 to 5 fingers to pick it (1 red … 5 violet). Pinch: particles near the pinch become that color, so you add a species where you want it.',
    'Point (index only): your fingertip pulls particles in like a current. Fist: they flee your hand. Clap: a new random table, a new world.',
    'Size: how big each particle is (a round head on its trail). Thickness: the trail’s width. Modes: tap the tile. Worms: colored trails. Glow: the trails drawn as neon light that adds up, so dense clusters burn white. Glow: how much they glow (low: just a soft line). Profile: the colors (Original, Pastel, Neon, Ember, Ocean, Forest, Mono).',
    'Count, Types: how many particles and species. Radius: how far they sense each other. Force: how strongly they pull. Friction: how quickly they slow. Trail, Thickness: the worms. Dim: darkens the camera.'
  ],
  exhale: [
    'How it works: a sphere of particles that breathes. Each particle springs toward the breath at its own pace, so exhales bloom bristled and inhales rush back.',
    'Open palm: exhale. Fist: inhale all the way and the sphere implodes into a bright core; open your hand and it blooms back out.',
    'Two hands: pull them apart and the sphere divides gradually into two, one per hand, each breathing with its own hand. The two pull on each other like gravity; bring them together and when they touch, particles cross over where they meet and the two blend into one shared sphere.',
    'Pull apart: pinch and hold with both hands and the sphere is torn to each pinch, fast; open both palms and pull apart and it separates slowly, like iron filings between two magnets. A fist pulls its particles in faster.',
    'Pinch: the sphere moves to your pinch, its particles streaming there and forming it again around your fingers; let go and they stream back to your palm. Brush your hand across it to spin it like a ball; roll your hand to turn it; swipe to fling it. No hand: it breathes on its own at Rate.',
    'Count, Size: how many and how big. Bristles: the streaks of rushing particles. Rate: breaths a minute with no hand. Speed: how fast the particles travel and breathe. Fluidity: how liquid it feels — particles trail further behind your hand, the shell sloshes after each breath and ripples on its surface. Glow: a soft bloom around them. Flash: how bright the core flashes when it implodes (0: none). Dissipate: fades the particles away when no hand is up. Modes: tap the tile. Sphere: dots. Zero: digits counting 0–9 down the sphere. Binary: flickering 0s and 1s. Color: far left green. Dim: darkens the camera.'
  ],
  'word-space': [
    'How it works: characters strung together by red threads, like Word Box, but free in the room: they drift through the whole picture and through depth on a swirling flow (curl noise, so they eddy without bunching up).',
    'Open hand: a magnet; words are drawn to it and gather around your palm. Fist: scatters them. Pinch: grabs the words within reach; move to carry them, let go to throw them.',
    'Turn your hand: turns the space (Rotation sets how far). Swipe: changes the set (with no Text).',
    'Text: type anything, in any keyboard. Set: 0 Hiragana, 1 Kanji, 2 Latin, 3 Hangul, 4 Digits, 5 Emoji. Points, Links: how many characters and threads. Size, Flow, Depth: character size, drift speed, how deep the space is. Glow, Dim: thread glow, darkens the camera.'
  ],
  'word-box': [
    'How it works: your body (from the segmenter) filled with characters strung together by red threads, above a wireframe box. The characters keep their places on your body, head to toe, and move with you; a share of them ride your hands.',
    'Text: type anything, with any keyboard — Japanese, Chinese, Korean, Arabic, emoji. Empty: Set picks 0 Hiragana, 1 Kanji, 2 Latin, 3 Hangul, 4 Digits, 5 Emoji; swipe to change it.',
    'Turn your hand: turns the whole structure in depth. Spread thumb and index (other fingers down): zooms in between them. Open palm: loosens the figure. Fist: pulls it tight.',
    'Zoom: how far spreading thumb and index zooms in (up to 5×). Rotation: how much turning your hand turns the structure. Points, Links: how many characters and threads each. Size: character size. Hands: share of characters on your hands. Glow: thread glow. Box: show the box. Dim: darkens the camera.'
  ],
  font: [
    'How it works: a letter traced from a typeface (marching squares), drawn as a dotted outline inside an A–Z dial, with an envelope around it.',
    'Grip it like a knob and turn your hand. Thumb and index out (an L): picks the letter. Thumb, index and middle out: Distortion, the outline warped by a smooth field. All five out: Smoothness, the outline rounded (Taubin smoothing). The sliders move with your hand.',
    'Face: 0 Literata, 1 Bodoni, 2 Inter, 3 Silkscreen, 4 VT323. Dim: darkens the camera behind the letter.',
    'Guide: shows the three grips on screen.'
  ],
  mosh: [
    'Spread thumb and index: the zone between them moshes; spreading wider makes it bigger.',
    'Pinch (thumb and index touching): snaps the picture clean, like a fresh keyframe.',
    'Scale: how far motion vectors push. Block: macroblock size. Hold: how long the smear lasts before it unwinds. Reach: zone size.'
  ],
  'pinch-frame': [
    'Acid, Thermal, Invert, Blur: make an L with thumb and index on both hands; the window between them changes. Bands and Speed shape Acid and Thermal.',
    'Blur: how soft the window is. Frosted: frosted glass, scattered, hazy and grainy. Mosaic: cuts the window into glass blocks, each blurred on its own.',
    'Line: a crisp outline around the filter window, or around each print sheet and its fold.',
    'Print: hold a sheet by its corners, index fingers on top, thumbs below. Twist to fold it; a side that turns over shows its back.',
    'Sheets: 1 is the folding print. 2–4 give each finger its own sheet (index, middle, ring, pinky), in overprinting riso inks.',
    'Dots, Grain, Shift: halftone size, riso grain, ink misregistration. Border: the white paper margin (off: full bleed).',
    'Code: pinch with both hands to span a box, read out as 1-bit code. Cells: block size. Color: ink.',
    'Lock: on, corners stay where you let go; a fist frees that hand’s corner until your next pinch. Off: the box follows your pinches.',
    'Outside: codes everything outside the box instead. Solid: fills the area with one flat color.',
    'Skeleton: draws the tracked hands.'
  ],
  wisp: [
    'Move your fingers through the picture: the video itself swirls and drags like smoke where they pass, then settles. A still hand does nothing.',
    'Fist: vacuums the picture back to normal around your hand; two fists vacuum two places.',
    'Pinch: shifts the colors (in Smoke, the hue of the swirls; in Watercolor, through the palettes). Pinch with both hands: twice as fast.',
    'Trail: how long the swirl lasts. Flow: how strongly your motion drags the picture.',
    'Swirl: extra curling where you’ve moved. Rise: how much the disturbance drifts upward, like smoke.',
    'Watercolor (tap the tile): your fingers paint pigment that the same flow carries and bleeds, on paper. Colors mix like glazes and pool darker at their edges.',
    'Colors: 0 takes colors from the camera; above it the slider runs through 23 palettes, blending between neighbors (Rothko, Indigo, Spring, Sunset, Earth, Water Lilies, Great Wave, Gold Leaf, Cutouts, Stain, Neon, Ocean, Forest, Desert, Sumi, Fauve, Klein, Candy, Ember, Aurora, Pop, Lagoon, Blossom; the name shows on screen). Fist: vacuums the painting away around your hand. Edges: how much pigment pools at the edges. Dark: black paper instead of white. Trail: how long the painting lasts. Flow, Swirl: how much your motion and the curls move the paint.'
  ],
  bubbles: [
    'Wave your fingers: faster fingers blow more bubbles.',
    'Pinch thumb and index and hold: a bubble grows at your fingertips; open to let it float off.',
    'Pop: a bubble pops when its life runs out (2–5 s, longer for blown ones) or, with Pop on, when a fingertip touches it.',
    'Modes: Soap (lit soap film), Neon (each rim a glowing neon tube in its film’s color), Inverse (inverts the video under each bubble), Electrokinetic (the video as dot glazing inside each bubble).',
    'Amount, Size: how many and how big. Float: how fast they rise. Wind: how much the air swirls. Profile: the colors. In Soap and Neon it thickens the soap films, so the iridescence shifts as real bubbles do; in Inverse and Electrokinetic it tints them.'
  ],
  claw: [
    'Raise a hand: a 3D armature follows it, drawn slightly ahead so it keeps up. Curl a finger to retract its talon; open to extend it.',
    'Talons: talon length. Size: the whole rig’s size. X, Y: move the rig away from your hand.',
    'Glow: bloom on the lines. Glyphs: HUD brackets orbiting the palm. Color: accent color.'
  ],
  'fluid-cube': [
    'Point: the cube floats at your index fingertip and turns as your hand turns. Bring your hand closer to make it bigger.',
    'Two hands: bring the other index fingertip closer to the cube and it moves over to that hand.',
    'Flick: throws the fluid. Shake: churns it. Tilting pours it, since gravity stays screen-down.',
    'Orbit: keeps the cube turning on its own axis. Size, Particles, Gravity, Viscosity: the cube and its fluid. Spin: turning with no hand.',
    'Cube, Glow, Readouts: edges, additive light, on-screen numbers. Color: fluid color.'
  ],
  accordion: [
    'Hold up both hands: a bellows of panels spans them. Pull apart to open it, bring them together to fold it.',
    'Bring one hand closer to the camera: the bellows stretches in depth toward it. Roll your palms to tilt the panels.',
    'Pinch and hold: the color drifts around the wheel (the Color slider follows); pinch with both hands for twice the speed.',
    'Panels, Waist, Size: count, middle narrowing, height. Spread: hue range. Opacity, Outline, Line: fill, edges, distance readout.'
  ],
  tutting: [
    'Hold up both hands: a volume of image tiles fills the box between your palms; side by side a slab, stacked a column. It holds when your hands come together.',
    'Flick a hand down or up (a quick snap of the fingers or hand is enough): that side of the volume turns over like a Rubik’s cube layer.',
    'Modes: Scatter (pieces of the room) or Behind (what’s behind each tile).',
    'Tiles, Size, Fan, Depth, Drift: count, tile size, page turn, perspective, float. Squish: packs the tiles closer together. Dim: darkens the camera. Edges: tile outlines.'
  ],
  chromatic: [
    'The space stays where you leave it; it only moves when you act on it.',
    'Point: browse. The focus follows your fingertip to whichever color is nearest, highlighted with its name and hex code.',
    'Pinch with your other hand while pointing: locks the selection until you open that pinch.',
    'Pinch with one hand: grabs the space; drag left–right to turn it about the vertical axis, up–down about the horizontal axis. Let go and it keeps turning, then slows. Pinching on a color selects it too.',
    'Open palm: zooms in, steadily, while you hold it open. Fist: zooms out.',
    'Swipe left or right: flings it into a spin. Tap the tile to change space (Lab, HSL, RGB).',
    'Labels, Text: how many names and how big. Spin: turning with no hand. Dim, Squares, Axes: background, color squares, axes.'
  ],
  'face-landmarks': [
    'How it works: the 478-point face mesh, contours, head pose and strongest expressions.',
    'Mesh: the full triangle mesh. Readouts: yaw, pitch, roll and expressions.'
  ],
  'token-cry': [
    'Face the camera: your text falls from your eyes as tears, following your head.',
    'Text: what falls. Speed: how fast. Scale: size relative to your eyes.',
    'Phrase: whole phrase per tear, or one symbol at a time. Pool: pile up or fall through. Color: token color.'
  ],
  collage: [
    'Modes: tap the tile. Eye: every snapshot is your right eye. Features: eye, eye, mouth and nose in turn.',
    'Face the camera and raise a hand: snapshots of your eyes, mouth and nose pile onto a sphere around your head. The source box stays on your right eye. Lower your hand and they fly back.',
    'Pinch: sphere size. Spread fingers: spacing between copies.',
    'Orbit: palm square to the camera, nothing turns; turn your hand and hold, and the sphere keeps turning that way.',
    'Rate, Count, Size: how fast, how many, how big. Sphere: shows the wireframe sphere on your palm; X, Y move it from your hand. Mosaic: the camera behind in flat blocks (snapshots stay sharp). Mono: how gray, with film grain.'
  ],
  glitch: [
    'Your body glitches inside its outline. A fist stops the glitch; a pinch freezes it until you let go; a swipe bursts.',
    'Split: two seams cross at your hand; each tile slips and splits its colors.',
    'Blocks, Dissolve: raise your hand higher to glitch harder. Spread (Dissolve): how far pieces scatter. Overexposed (Blocks): blown-out neon blocks.',
    'Profile: 0 natural, 1 neon, 2–5 two-ink looks (red/cyan, magenta/green, gold/blue, black/white). Depth: bigger blocks the closer you are.',
    'Amount, Block, Speed: strength, damage size, how often it changes. Hand: off for a steady glitch.'
  ],
  'facade-interactive': [
    'How it works: the camera is the sun behind a building skin; louvers turn face-on where something moves.',
    'Scale: module size. Response, Speed: how strongly and how fast modules react.',
    'Shade: close against light (on) or open to it (off). Opacity: how solid the louvers are over the camera. Saturation, Color: louver tint.'
  ],
  'facade-electrokinetic': [
    'How it works: pixel glazing; colored particles spread over each cell in proportion to the light behind it. Tap the tile to change shape.',
    'Scale, Response, Speed, Shade: as in Interactive. Saturation: image color. Color: hue rotation.'
  ],
  web: [
    'Raise a hand: threads run from your palm to each fingertip and between neighboring fingertips, with rings like an orb web.',
    'Two hands: threads join matching fingertips across your hands, with rings between them.',
    'Pinch: draws a taut thumb–index thread; let go and the web gets plucked.',
    'Slingshot: pinch, pull back and let go: a web line shoots the opposite way (harder the further you pulled), sticks at the edge of the frame with a splat and holds to your hand. Pull too far and it snaps. A short pinch just plucks the web.',
    'Flick: the web lets go of your fingers and floats away, and a new one forms.',
    'Threads sag and swing as you move: real rope physics, pinned to your fingers.',
    'Rings: how many rings. Sag: how much threads droop. Particles: how many specks flow along the threads. Glow, Color: light and color.'
  ],
  fibre: [
    'How it works: hundreds of thousands of particles on the graphics card, stirred by synthetic turbulence (a sum of swirling waves with the energy spectrum of real turbulence) and held to a sphere by a spring. Their paths fade slowly, so each one draws a fibre.',
    'One hand: the sphere follows your palm. Two hands: it sits between them, as wide as they are apart. Open palm: the fibres fly loose. Fist: it pulls tight.',
    'Pinch and drag: turns it, and it keeps turning when you let go. Swipe: spins it. Sweep your hand through it fast: the fibres blow away.',
    'Modes: tap the tile. Light: glowing points on the dark camera. Ink: dark fibres on white paper.',
    'Count: particles, in thousands (fewer if your phone stutters). Size, Turbulence, Scale: sphere size, how hard and how fine the swirl is. Hold: how strongly the shell pulls them back (low: fur, high: a smooth ball). Trails: how long the paths last. Exposure, Glow: brightness and bloom. Camera: color from the video. Color: tint (far left white, or black ink). Dim: darkens (or, in Ink, whitens) the camera.'
  ],
  'particle-cloud': [
    'How it works: hundreds of thousands of particles on the graphics card, born at the 21 points of each hand, stirred by turbulence and added like light, so your hands give off a soft luminous cloud. Your palms pull drifting particles back.',
    'Open palm: the cloud blooms. Fist: it condenses onto your hand. Pinch: it is drawn to your fingertips. Move: it streams off you.',
    'Modes: tap the tile. Light: glowing on the dark camera. Ink: dark on white.',
    'Count: particles, in thousands (fewer if your phone stutters). Turbulence, Scale: how hard and how fine the swirl is. Hold: how strongly your palms pull it back. Trails, Exposure, Glow: streaks, brightness and bloom. Color: tint. Dim: darkens (or whitens) the camera.'
  ],
  'pseudo-plexus': [
    'How it works: particles born at fixed points on your hands drift slowly, and each is joined by straight lines to a few partners further along the list; a line shows only when its two ends are close, so a web of lines grows between near points, the plexus look, without searching for neighbors.',
    'Move your hands: the web grows from them and stretches. Fist: it pulls in. Open palm: it drifts loose. Pinch: drawn to your fingertips.',
    'Modes: tap the tile. Light or Ink.',
    'Count: particles, in thousands. Links: lines per particle. Reach: the longest line that still shows. Lines: their brightness. Turbulence, Scale, Hold, Trails, Exposure, Glow, Color, Dim: as in Particle Cloud.'
  ],
  cards: [
    'How it works: a collection of images built into 3D structures. Without a feed, the cards are snapshots of the camera.',
    'L (thumb and index out, other fingers in): a zoom/rotate handle. Turn the line to turn the structure; open or close it to zoom. Let go and it stays as you left it.',
    'Pinch and drag: up–down tips the structure, left–right turns it; it coasts when you let go.',
    'Swipe right or left: next or previous structure (Ribbon, Ring, Lattice; tapping the tile does too). The lime widget above shows which.',
    'Count, Size, Spin: how many cards, how big, turning with no hand. Inset: flat background (Color) with the camera in a window. Text: words along the structure.',
    'Feed: a JSON feed URL (items with src) or a public Are.na channel URL. Images must be served with CORS; ones that aren’t are skipped.'
  ],
  tendrils: [
    'How it works: moving fingertips release particles that follow a curl-noise flow (swirls with no sources or sinks); each draws a thread that tapers to a fine tail.',
    'Modes: tap the tile. Neon: colored tubes with a white-hot core and bloom. Silk: fine pale threads.',
    'Pinch: pulls the tendrils toward the pinch. Make a fist, then open it: a ring bursts from your palm.',
    'Count: how many come off a moving finger. Curl: flow strength. Length: how long threads are. Glow, Color: light and color.'
  ],
  datamosh: [
    'How it works: real datamoshing. The keyframes (full pictures) are dropped, so each new frame’s motion vectors keep moving the pixels of a picture that is gone, and it melts along the motion.',
    'Pinch: the keyframes stop and everything that moves smears. Open your hand: a fresh keyframe releases the picture.',
    'Swipe: Bloom, a repeated P-frame; the same vectors push again and again and the picture balloons in the swipe’s direction.',
    'Block: macroblock size. Scale: how far vectors push. Bloom: how long a swipe keeps pushing. Residual: how much real correction gets through (0 is pure mosh). Keyframes: a clean picture every 1–10 s (far left: never). Hand: off to mosh all the time.'
  ]
};
