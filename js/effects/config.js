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
    id: 'quadtree',
    name: 'Quadtree',
    group: 'halftone',
    ready: true,
    photoType: 'image/jpeg',
    params: [
      range('detail', 'Detail', 0, 100, 60),
      range('min', 'Min', 2, 24, 4),
      range('max', 'Max', 8, 256, 128),
      range('blur', 'Blur', 0, 100, 50),
      range('lines', 'Lines', 0, 100, 30),
      COLOR
    ]
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
      { id: 'link', name: 'Link' }
    ],
    params: [
      { id: 'readouts', label: 'Readouts', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show which hand it is, the tracking score and rotation.' },
      { id: 'pinch', label: 'Pinch', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show the thumb–index line and pinch value.' },
      { id: 'distance', label: 'Distance', type: 'toggle', default: true, modes: ['skeleton'], hint: 'Show the line and distance between two hands.' },
      { id: 'fingers', label: 'Fingers', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show the gaps between neighboring fingertips on each hand.' },
      { id: 'pairs', label: 'Pairs', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show the distances between matching fingertips of your left and right hands.' },
      { id: 'signals', label: 'Signals', type: 'toggle', default: false, modes: ['skeleton'], hint: 'Show what MAGI reads from each hand: fingers, curl, spread, pinches, speed and motions.' },
      { id: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, default: 85, modes: ['controller'] }
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
      { id: 'speed', label: 'Speed', min: 0, max: 100, step: 1, default: 30, modes: ['acid', 'thermal'] },
      { id: 'line', label: 'Line', type: 'toggle', default: false, modes: ['acid', 'thermal', 'invert', 'blur'], hint: 'A crisp outline around the window.' },
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
    params: [
      range('trail', 'Trail', 0, 100, 50),
      range('flow', 'Flow', 0, 100, 60),
      range('swirl', 'Swirl', 0, 100, 45),
      range('rise', 'Rise', 0, 100, 30)
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
      { id: 'inverse', name: 'Inverse' },
      { id: 'electro', name: 'Electrokinetic' }
    ],
    params: [
      range('amount', 'Amount', 0, 100, 60),
      range('size', 'Size', 0, 100, 50),
      range('float', 'Float', 0, 100, 40),
      range('wind', 'Wind', 0, 100, 35),
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
      range('size', 'Size', 30, 200, 100),
      range('particles', 'Particles', 500, 3000, 1200),
      range('gravity', 'Gravity', 0, 100, 60),
      range('viscosity', 'Viscosity', 0, 100, 20),
      range('orbit', 'Orbit', 0, 100, 0),
      range('spin', 'Spin', 0, 100, 15),
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
      range('size', 'Size', 10, 100, 50),
      { id: 'color', label: 'Color', min: 0, max: 100, step: 1, default: 55, track: 'hue' },
      range('spread', 'Spread', 0, 100, 45),
      range('opacity', 'Opacity', 10, 100, 95),
      toggle('outline', 'Outline', true, 'Black edges on each panel.'),
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
      { id: 'silk', name: 'Silk' },
      { id: 'neon', name: 'Neon' }
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
    params: [
      range('rate', 'Rate', 0, 100, 50),
      range('count', 'Count', 3, 100, 12),
      range('size', 'Size', 0, 100, 40),
      range('posX', 'X', -100, 100, 0),
      range('posY', 'Y', -100, 100, 0),
      toggle('sphere', 'Sphere', true, 'Show the wireframe sphere on your palm.'),
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
    'How it works: a quadtree. Squares split into four while their brightness varies too much, and always where the lens is in focus, so what’s sharp breaks into fine cells that keep the picture, and soft, out-of-focus areas stay big flat squares of their average color.',
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
    'Controller: a circle spans your thumb and index fingertips and grows as they open; it slides along the ruler, and its value is your position across the frame. Opacity: the circle’s fill.',
    'Controller, index only (thumb tucked): the circle shrinks to a pointer dot on your fingertip and keeps sliding. Two hands: the second hand gets its own circle, value and ring stack on the right.',
    'Controller: rings swell as thumb and index open; the dots trace your index fingertips, the bars recent values (hand 2 in gray).',
    'Link: two hands; a line joins your index fingertips with their distance at the green midpoint; the scope shows your fingertips around the palm.'
  ],
  mosh: [
    'Spread thumb and index: the zone between them moshes; spreading wider makes it bigger.',
    'Pinch (thumb and index touching): snaps the picture clean, like a fresh keyframe.',
    'Scale: how far motion vectors push. Block: macroblock size. Hold: how long the smear lasts before it unwinds. Reach: zone size.'
  ],
  'pinch-frame': [
    'Acid, Thermal, Invert, Blur: make an L with thumb and index on both hands; the window between them changes. Bands and Speed shape Acid and Thermal.',
    'Blur: how soft the window is. Frosted: frosted glass, scattered, hazy and grainy.',
    'Line: a crisp outline around the filter window.',
    'Print: hold a sheet by its corners, index fingers on top, thumbs below. Twist to fold it; a side that turns over shows its back.',
    'Sheets: 1 is the folding print. 2–4 give each finger its own sheet (index, middle, ring, pinky), in overprinting riso inks.',
    'Dots, Grain, Shift: halftone size, riso grain, ink misregistration.',
    'Code: pinch with both hands to span a box, read out as 1-bit code. Cells: block size. Color: ink.',
    'Lock: on, corners stay where you let go; a fist frees that hand’s corner until your next pinch. Off: the box follows your pinches.',
    'Outside: codes everything outside the box instead. Solid: fills the area with one flat color.',
    'Skeleton: draws the tracked hands.'
  ],
  wisp: [
    'Move your fingers through the picture: the video itself swirls and drags like smoke where they pass, then settles. A still hand does nothing.',
    'Pinch: sucks the picture back to normal quickly.',
    'Trail: how long the swirl lasts. Flow: how strongly your motion drags the picture.',
    'Swirl: extra curling where you’ve moved. Rise: how much the disturbance drifts upward, like smoke.'
  ],
  bubbles: [
    'Wave your fingers: faster fingers blow more bubbles.',
    'Pinch thumb and index and hold: a bubble grows at your fingertips; open to let it float off.',
    'Pop: a bubble pops when its life runs out (2–5 s, longer for blown ones) or, with Pop on, when a fingertip touches it.',
    'Modes: Soap (lit soap film), Inverse (inverts the video under each bubble), Electrokinetic (the video as dot glazing inside each bubble).',
    'Amount, Size: how many and how big. Float: how fast they rise. Wind: how much the air swirls.'
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
    'Tiles, Size, Fan, Depth, Drift: count, tile size, page turn, perspective, float. Dim: darkens the camera. Edges: tile outlines.'
  ],
  chromatic: [
    'Point: your index fingertip turns the space (left–right spins it, up–down tips it).',
    'Two hands: keep one pinched and pinch with the other; moving that pinch spins the space, and letting go keeps it spinning.',
    'Spread thumb and index: zooms. Pinch: grabs the name under your fingertip and pulls it out.',
    'Hold up 1, 2 or 3 fingers, still: switches to Lab, HSL or RGB (tapping the tile does too).',
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
    'Face the camera and raise a hand: snapshots of your eyes, mouth and nose pile onto a sphere around your head. The source box stays on your right eye. Lower your hand and they fly back.',
    'Pinch: sphere size. Spread fingers: spacing between copies.',
    'Orbit: palm square to the camera, nothing turns; turn your hand and hold, and the sphere keeps turning that way.',
    'Rate, Count, Size: how fast, how many, how big. Sphere: shows the wireframe sphere on your palm; X, Y move it from your hand. Mono: gray with grain.'
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
    'Shade: close against light (on) or open to it (off). Saturation, Color: louver tint.'
  ],
  'facade-electrokinetic': [
    'How it works: pixel glazing; colored particles spread over each cell in proportion to the light behind it. Tap the tile to change shape.',
    'Scale, Response, Speed, Shade: as in Interactive. Saturation: image color. Color: hue rotation.'
  ],
  web: [
    'Raise a hand: threads run from your palm to each fingertip and between neighboring fingertips, with rings like an orb web.',
    'Two hands: threads join matching fingertips across your hands, with rings between them.',
    'Pinch: draws a taut thumb–index thread; let go and the web gets plucked.',
    'Flick: the web lets go of your fingers and floats away, and a new one forms.',
    'Threads sag and swing as you move: real rope physics, pinned to your fingers.',
    'Rings: how many rings. Sag: how much threads droop. Particles: how many specks flow along the threads. Glow, Color: light and color.'
  ],
  tendrils: [
    'How it works: moving fingertips release particles that follow a curl-noise flow (swirls with no sources or sinks); each draws a thread that tapers to a fine tail.',
    'Modes: tap the tile. Silk: fine pale threads. Neon: colored tubes with a white-hot core and bloom.',
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
