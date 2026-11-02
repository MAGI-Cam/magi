// Glitch: your whole body breaks up like corrupted video, and your hand controls it.
//
// The body is MediaPipe's person mask (Magi.tracking.body); the glitch happens only inside it.
// The hand is the controller (Interaction Engine). In Blocks and Dissolve, the higher your highest
// fingertip, the stronger the glitch; in Split, the seams cross at your hand. A swipe fires a
// burst that fades with a 0.25 s half-life. A fist stops the glitch while you hold it (the video
// keeps running clean). With Hand off, the glitch holds steady at Amount.
//
// The corruption is redrawn from a new random seed `Speed` times a second (2–30 Hz) and holds in
// between, so it stutters like a broken stream instead of shimmering. Each mode is a real failure:
//   Split    — tiles out of register, like the reference: two seams, one vertical and one
//              horizontal, cross at your hand and cut the frame into four tiles. Within each tile
//              the picture slips by its own offset and its red, green and blue channels are read
//              from three different places (chroma misregistration), so edges grow red, green and
//              blue ghosts that change from tile to tile, while the photo itself stays visible.
//   Blocks   — 8×8-style macroblock damage: blocks that lose their AC coefficients decode as their
//              DC term alone (the block's mean color), blocks with a wrong motion vector copy
//              pixels from the wrong place, and some decode with the channels in the wrong order.
//   Dissolve — packet loss: pieces of the body arrive in the wrong place (up to Spread away), and
//              the missing pieces decode as random bits, 1 bit per channel against a random
//              threshold, which keeps the body's color on average.
// Color (Blocks, Dissolve) gives the damage a color profile: 0 keeps the picture's own colors;
// above that, damaged pixels are hue-rotated by the slider's angle (Rodrigues rotation about the
// gray axis, which keeps brightness) and saturated 1.5×. Depth (Blocks, Dissolve) sizes the blocks
// by how close you are: the share of the frame your body fills, and near each hand that hand's
// size, snapped to ½×, 1×, 2× or 4× so neighboring grids nest.
// It runs as a WebGL fragment shader: every pixel is decided independently from the seed.
(function () {
  var INDEX_TIP = 8;
  var MODES = { split: 0, blocks: 1, dissolve: 2 };

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size, seam;',
    'uniform float amount, block, seed, mode, hue, depth, spread, near;',
    'uniform vec3 handA, handB;', // x, y, scale; scale 0 = no hand
    'varying vec2 uv;',
    // Dave Hoskins' hash without sine: a uniform pseudo-random number in [0, 1) per input.
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'float body(vec2 px) { return smoothstep(0.35, 0.65, texture2D(mask, px / size).r); }',
    'vec3 cam1(vec2 px) { return texture2D(cam, clamp(px / size, 0.0, 1.0)).rgb; }',
    'vec3 crush(vec3 c) { return step(0.5, c); }', // 1 bit per channel
    // Hue rotation about the gray axis (Rodrigues), then saturation × 1.5 around the luma.
    'vec3 profile(vec3 c) {',
    '  if (hue <= 0.0) return c;',
    '  float a = hue, k = 0.57735, cs = cos(a), sn = sin(a);',
    '  vec3 ax = vec3(k);',
    '  c = c * cs + cross(ax, c) * sn + ax * dot(ax, c) * (1.0 - cs);',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  return clamp(mix(vec3(l), c, 1.5), 0.0, 1.0);',
    '}',
    // Block size here: by body proximity, and near a hand by that hand's size; powers of two.
    'float blockAt(vec2 px) {',
    '  if (depth < 0.5) return block;',
    '  float s = near;',
    '  if (handA.z > 0.0) s = mix(s, handA.z, exp(-pow(length(px - handA.xy) / (size.y * 0.25), 2.0)));',
    '  if (handB.z > 0.0) s = mix(s, handB.z, exp(-pow(length(px - handB.xy) / (size.y * 0.25), 2.0)));',
    '  return block * exp2(clamp(floor(log2(s) + 0.5), -1.0, 2.0));',
    '}',
    'void main() {',
    '  vec2 px = uv * size;',
    '  vec3 base = texture2D(cam, uv).rgb;',
    '  vec3 col = base;',
    '  float s = seed * 0.6180339;',
    '  if (mode < 0.5) {',
    '    vec2 tile = vec2(px.x < seam.x ? 0.0 : 1.0, px.y < seam.y ? 0.0 : 1.0);',
    '    float mag = amount * size.x * 0.05;',
    '    vec2 slip = (vec2(hash(tile + s), hash(tile + s + 2.1)) - 0.5) * 2.0 * mag;',
    '    vec2 src = px - slip;',
    '    vec2 oR = (vec2(hash(tile + s + 4.3), hash(tile + s + 5.9)) - 0.5) * 2.0 * mag;',
    '    vec2 oB = (vec2(hash(tile + s + 7.7), hash(tile + s + 8.1)) - 0.5) * 2.0 * mag;',
    '    float m = max(body(src), max(body(src + oR), body(src + oB)));',
    '    if (m > 0.0) {',
    '      vec3 c = vec3(cam1(src + oR).r, cam1(src).g, cam1(src + oB).b);',
    '      col = mix(base, c, m);',
    '    }',
    '  } else if (mode < 1.5) {',
    '    float b = blockAt(px);',
    '    vec2 cell = floor(px / b), center = (cell + 0.5) * b;',
    '    if (body(center) > 0.5 && hash(cell + s) < amount) {',
    '      float k = hash(cell + s + 3.7);',
    '      if (k < 0.45) {',
    '        vec3 sum = vec3(0.0);',
    '        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) sum += cam1(center + vec2(float(i), float(j)) * b / 3.0);',
    '        col = sum / 9.0;',
    '      } else if (k < 0.8) {',
    '        vec2 mv = (vec2(hash(cell + s + 5.1), hash(cell + s + 9.3)) - 0.5) * b * 6.0 * amount;',
    '        col = cam1(px + mv);',
    '      } else {',
    '        col = crush(base.gbr);',
    '      }',
    '      col = profile(col);',
    '    }',
    '  } else {',
    '    float c = max(2.0, floor(blockAt(px) * 0.5));',
    '    vec2 cell = floor(px / c), center = (cell + 0.5) * c;',
    '    vec2 dir = vec2(hash(cell + s), hash(cell + s + 1.3)) - 0.5;',
    '    vec2 from = center - dir * 2.0 * amount * spread * size.y;',
    '    float r = hash(cell + s + 2.9);',
    '    if (body(from) > 0.5 && r < amount * 0.5) {',
    '      vec3 piece = cam1(from);',
    '      col = profile(hash(cell + s + 4.4) < 0.3 ? crush(piece) : piece);',
    '    } else if (body(center) > 0.5 && r < amount * 0.75) {',
    // A lost piece decodes as random bits: 1 bit per channel with a random threshold, so on
    // average it keeps the body's own color (stochastic quantization).
    '      vec3 noise = vec3(hash(cell + s + 6.1), hash(cell + s + 7.7), hash(cell + s + 8.3));',
    '      col = profile(step(noise, cam1(center)));',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function createGlitch() {
    var pass, maskBytes = null, burst = 0, lastT = null, seenEvent = 0, seam = null;
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (pass === undefined) pass = Magi.fx.shaderPass(FRAG, ['cam', 'mask']);
        if (!pass) { frame.say('Glitch needs WebGL, which this browser has turned off.'); return; }

        var t = frame.time / 1000;
        var dt = lastT === null ? 1 / 30 : Math.max(1 / 120, Math.min(0.1, t - lastT));
        lastT = t;
        var body = Magi.tracking.body, seg = body.detect(frame);
        var hands = [], hand = Magi.tracking.hands, level = 1, split = params.mode === 'split' || !params.mode, stopped = false;
        burst *= Math.pow(2, -dt / 0.25);
        if (!seam) seam = { x: W / 2, y: H / 2 };
        if (params.hand) {
          var ix = Magi.interaction.read(frame);
          hands = ix.hands;
          ix.events.forEach(function (e) {
            if (e.n <= seenEvent || e.type !== 'swipe') return;
            seenEvent = e.n;
            burst = 1;
          });
          stopped = hands.some(function (h) { return h.fist; });
          if (!hands.length) level = 0.3;
          else if (split) {
            // The seams follow your hand, eased.
            var e = 1 - Math.exp(-dt * 10);
            seam.x += (hands[0].center.x - seam.x) * e; seam.y += (hands[0].center.y - seam.y) * e;
          } else {
            var high = Math.max.apply(null, hands.map(function (h) { return 1 - h.points[INDEX_TIP].y / H; }));
            var x = Math.min(1, Math.max(0, (high - 0.1) / 0.8));
            level = x * x * (3 - 2 * x);
          }
        }
        // A fist stops the glitch; the video keeps running.
        if (stopped) { frame.say('Open your hand to glitch again.'); return; }
        var amount = Math.min(1, params.amount / 100 * level + burst);

        if (seg) {
          var n = seg.width * seg.height, m = seg.mask, present = 0;
          if (!maskBytes || maskBytes.length !== n * 4) maskBytes = new Uint8Array(n * 4);
          for (var i = 0; i < n; i++) {
            var v = m[i] * 255, o = i * 4;
            maskBytes[o] = maskBytes[o + 1] = maskBytes[o + 2] = v;
            maskBytes[o + 3] = 255;
            present += m[i];
          }
          if (amount > 0.01 && present / n > 0.01) {
            pass.texture('cam', out);
            pass.data('mask', seg.width, seg.height, maskBytes);
            var rate = 2 + params.speed / 100 * 28;
            // Depth: a body filling 35% of the frame is 1×; hands at 15% of the frame height are 1×.
            var hs = function (h) { return h ? [h.center.x, h.center.y, Math.max(0.5, h.size / (H * 0.15))] : [0, 0, 0]; };
            pass.run(W, H, {
              size: [W, H],
              amount: amount,
              block: Math.round((4 + params.block * 4) * Math.max(W, H) / 1280),
              seed: Math.floor(t * rate) % 4096,
              mode: MODES[params.mode] || 0,
              seam: [seam.x, seam.y],
              hue: params.color > 0 ? (params.color - 1) / 99 * Math.PI * 2 + 0.001 : 0,
              depth: params.depth ? 1 : 0,
              near: Math.max(0.5, (present / n) / 0.35),
              spread: (params.spread / 100) * 0.6,
              handA: hs(hands[0]),
              handB: hs(hands[1])
            });
            ctx.drawImage(pass.canvas, 0, 0);
          }
          if (present / n <= 0.01) return frame.say('Step into view.');
        }

        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (params.hand && hand.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, hand, 'hand');
        else if (params.hand && !hands.length) frame.say(split ? 'Raise a hand: the seams cross at your hand. Fist stops.' : 'Raise a hand: higher glitches harder, swipe bursts, fist stops.');
      },
      reset: function () {
        burst = 0; seenEvent = 0; seam = null;
        lastT = null;
      }
    };
  }

  Magi.renderers.glitch = createGlitch;
})();
