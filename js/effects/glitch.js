// Glitch: your whole body breaks up like corrupted video, and your hand controls how much.
//
// The body is MediaPipe's person mask (Magi.tracking.body); the glitch happens only inside it.
// The hand is the controller: the higher your highest fingertip, the stronger the glitch, and a
// fast swipe (wrist speed over half a frame height per second) fires a burst that fades with a
// 0.25 s half-life. With Hand off, the glitch holds steady at Amount.
//
// The corruption is redrawn from a new random seed `Speed` times a second (2–30 Hz) and holds in
// between, so it stutters like a broken stream instead of shimmering. Each mode is a real failure:
//   Split    — horizontal slices shift sideways (lost line sync), the red and blue channels
//              separate (chroma misregistration), and some slices drop to 1 bit per channel,
//              which leaves only the 8 RGB primaries.
//   Blocks   — 8×8-style macroblock damage: blocks that lose their AC coefficients decode as their
//              DC term alone (the block's mean color), blocks with a wrong motion vector copy
//              pixels from the wrong place, and some decode with the channels in the wrong order.
//   Dissolve — packet loss: pieces of the body arrive in the wrong place, and the missing pieces
//              decode as random bits, 1 bit per channel against a random threshold, which keeps
//              the body's color on average.
// It runs as a WebGL fragment shader: every pixel is decided independently from the seed.
(function () {
  var INDEX_TIP = 8, WRIST = 0;
  var MODES = { split: 0, blocks: 1, dissolve: 2 };

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size;',
    'uniform float amount, block, seed, mode;',
    'varying vec2 uv;',
    // Dave Hoskins' hash without sine: a uniform pseudo-random number in [0, 1) per input.
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'float body(vec2 px) { return smoothstep(0.35, 0.65, texture2D(mask, px / size).r); }',
    'vec3 cam1(vec2 px) { return texture2D(cam, clamp(px / size, 0.0, 1.0)).rgb; }',
    'vec3 crush(vec3 c) { return step(0.5, c); }', // 1 bit per channel
    'void main() {',
    '  vec2 px = uv * size;',
    '  vec3 base = texture2D(cam, uv).rgb;',
    '  vec3 col = base;',
    '  float s = seed * 0.6180339;',
    '  if (mode < 0.5) {',
    '    float band = floor(px.y / (block * 2.0));',
    '    float on = step(hash(vec2(band, s)), amount * 0.85);',
    '    float dx = (hash(vec2(band, s + 7.0)) - 0.5) * 2.0 * amount * size.x * 0.12 * on;',
    '    float split = amount * size.x * 0.012 * (1.0 + 2.0 * on);',
    '    vec2 src = px - vec2(dx, 0.0);',
    '    float m = body(src);',
    '    if (m > 0.0) {',
    '      vec3 c = vec3(cam1(src + vec2(split, 0.0)).r, cam1(src).g, cam1(src - vec2(split, 0.0)).b);',
    '      if (on > 0.5 && hash(vec2(band, s + 13.0)) < amount * 0.7) c = crush(c);',
    '      col = mix(base, c, m);',
    '    }',
    '  } else if (mode < 1.5) {',
    '    vec2 cell = floor(px / block), center = (cell + 0.5) * block;',
    '    if (body(center) > 0.5 && hash(cell + s) < amount) {',
    '      float k = hash(cell + s + 3.7);',
    '      if (k < 0.45) {',
    '        vec3 sum = vec3(0.0);',
    '        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) sum += cam1(center + vec2(float(i), float(j)) * block / 3.0);',
    '        col = sum / 9.0;',
    '      } else if (k < 0.8) {',
    '        vec2 mv = (vec2(hash(cell + s + 5.1), hash(cell + s + 9.3)) - 0.5) * block * 6.0 * amount;',
    '        col = cam1(px + mv);',
    '      } else {',
    '        col = crush(base.gbr);',
    '      }',
    '    }',
    '  } else {',
    '    float c = max(2.0, floor(block * 0.5));',
    '    vec2 cell = floor(px / c), center = (cell + 0.5) * c;',
    '    vec2 dir = vec2(hash(cell + s), hash(cell + s + 1.3)) - 0.5;',
    '    vec2 from = center - dir * 2.0 * amount * size.y * 0.25;',
    '    float r = hash(cell + s + 2.9);',
    '    if (body(from) > 0.5 && r < amount * 0.5) {',
    '      vec3 piece = cam1(from);',
    '      col = hash(cell + s + 4.4) < 0.3 ? crush(piece) : piece;',
    '    } else if (body(center) > 0.5 && r < amount * 0.75) {',
    // A lost piece decodes as random bits: 1 bit per channel with a random threshold, so on
    // average it keeps the body's own color (stochastic quantization).
    '      vec3 noise = vec3(hash(cell + s + 6.1), hash(cell + s + 7.7), hash(cell + s + 8.3));',
    '      col = step(noise, cam1(center));',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function createGlitch() {
    var pass, maskBytes = null, prevWrist = {}, burst = 0, lastT = null;

    // Hand control: height of the highest fingertip, plus bursts from fast swipes.
    function handLevel(frame, hands, dt) {
      var H = frame.height, high = 0, fast = 0, seen = {};
      hands.forEach(function (p, i) {
        high = Math.max(high, 1 - p[INDEX_TIP].y / H);
        var w = p[WRIST], q = prevWrist[i];
        if (q) fast = Math.max(fast, Math.hypot(w.x - q.x, w.y - q.y) / dt / H);
        prevWrist[i] = { x: w.x, y: w.y };
        seen[i] = true;
      });
      Object.keys(prevWrist).forEach(function (k) { if (!seen[k]) delete prevWrist[k]; });
      burst *= Math.pow(2, -dt / 0.25);
      burst = Math.max(burst, Math.min(1, (fast - 0.5) / 1.5));
      var x = Math.min(1, Math.max(0, (high - 0.1) / 0.8));
      return x * x * (3 - 2 * x);
    }

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
        var hands = [], hand = Magi.tracking.hands, level = 1;
        if (params.hand) {
          hands = hand.detect(frame);
          level = hands.length ? handLevel(frame, hands, dt) : 0.3;
        }
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
            pass.run(W, H, {
              size: [W, H],
              amount: amount,
              block: Math.round((4 + params.block * 4) * Math.max(W, H) / 1280),
              seed: Math.floor(t * rate) % 4096,
              mode: MODES[params.mode] || 0
            });
            ctx.drawImage(pass.canvas, 0, 0);
          }
          if (present / n <= 0.01) return frame.say('Step into view.');
        }

        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (params.hand && hand.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, hand, 'hand');
        else if (params.hand && !hands.length) frame.say('Raise a hand: higher glitches harder, a fast swipe bursts.');
      },
      reset: function () {
        prevWrist = {};
        burst = 0;
        lastT = null;
      }
    };
  }

  Magi.renderers.glitch = createGlitch;
})();
