// Glitch: your whole body breaks up like corrupted video, and your hand controls how much.
//
// The body is MediaPipe's person mask (Magi.tracking.body); the glitch happens only inside it.
// The hand is the controller (Interaction Engine): in Blocks and Dissolve, the higher your highest
// fingertip, the stronger the glitch; in Split, your hand's left–right position sets how far the
// color copies slide apart. A swipe fires a burst that fades with a 0.25 s half-life (in Split it
// also turns the split to the swipe's direction), and a fist freezes the picture until you open
// it. With Hand off, the glitch holds steady at Amount.
//
// The corruption is redrawn from a new random seed `Speed` times a second (2–30 Hz) and holds in
// between, so it stutters like a broken stream instead of shimmering. Each mode is a real failure:
//   Split    — the body comes apart into its color channels: three silhouettes, red, green and
//              blue, each a flat fill of its own channel (two tones, by brightness), slid apart
//              along the split direction (chroma misregistration at the scale of the whole body).
//              Channels add like light, so where two copies overlap they make yellow, cyan or
//              magenta, and white where all three meet. Some columns are smeared downward (sample
//              and hold: each run of the column repeats its top pixel), like a stalled scanline.
//   Blocks   — 8×8-style macroblock damage: blocks that lose their AC coefficients decode as their
//              DC term alone (the block's mean color), blocks with a wrong motion vector copy
//              pixels from the wrong place, and some decode with the channels in the wrong order.
//   Dissolve — packet loss: pieces of the body arrive in the wrong place, and the missing pieces
//              decode as random bits, 1 bit per channel against a random threshold, which keeps
//              the body's color on average.
// It runs as a WebGL fragment shader: every pixel is decided independently from the seed.
(function () {
  var INDEX_TIP = 8;
  var MODES = { split: 0, blocks: 1, dissolve: 2 };

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size;',
    'uniform float amount, block, seed, mode;',
    'uniform vec2 offset;',
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
    // Column smear: in some columns, sample from the top of each run of 8 blocks.
    '    float colm = floor(px.x / (block * 1.5));',
    '    vec2 q = px;',
    '    if (hash(vec2(colm, s + 3.0)) < amount * 0.35) q.y = floor(px.y / (block * 8.0)) * block * 8.0;',
    '    vec3 sil = vec3(0.0);',
    '    float inside = 0.0;',
    '    for (int c = 0; c < 3; c++) {',
    '      vec2 at = q - offset * (float(c) - 1.0);',
    '      float m = body(at);',
    '      float l = dot(cam1(at), vec3(0.299, 0.587, 0.114));',
    '      float v = m * (l > 0.35 ? 1.0 : 0.55);',
    '      if (c == 0) sil.r = v; else if (c == 1) sil.g = v; else sil.b = v;',
    '      inside = max(inside, m);',
    '    }',
    '    col = mix(base, sil, inside * min(1.0, amount * 1.4));',
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
    var pass, maskBytes = null, burst = 0, lastT = null, seenEvent = 0;
    var dir = [1, 0], push = 0.5, frozen = null, holding = false;
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
        var hands = [], hand = Magi.tracking.hands, level = 1, split = params.mode === 'split' || !params.mode;
        burst *= Math.pow(2, -dt / 0.25);
        holding = false;
        if (params.hand) {
          var ix = Magi.interaction.read(frame);
          hands = ix.hands;
          ix.events.forEach(function (e) {
            if (e.n <= seenEvent || e.type !== 'swipe') return;
            seenEvent = e.n;
            burst = 1;
            dir = e.dir === 'left' ? [-1, 0] : e.dir === 'right' ? [1, 0] : e.dir === 'up' ? [0, -1] : [0, 1];
          });
          holding = hands.some(function (h) { return h.fist; });
          if (!hands.length) level = 0.3;
          else if (split) {
            // Hand x (−1 left … 1 right) slides the channels apart; never fully closed.
            var hx = hands[0].center.x / W * 2 - 1;
            push += ((0.2 + 0.8 * Math.abs(hx)) * (hx < 0 ? -1 : 1) - push) * (1 - Math.exp(-dt * 8));
          } else {
            var high = Math.max.apply(null, hands.map(function (h) { return 1 - h.points[INDEX_TIP].y / H; }));
            var x = Math.min(1, Math.max(0, (high - 0.1) / 0.8));
            level = x * x * (3 - 2 * x);
          }
        }
        var amount = Math.min(1, params.amount / 100 * level + burst);

        // A fist holds the last picture.
        if (holding && frozen) { ctx.drawImage(frozen, 0, 0); frame.say('Open your hand to let it run.'); return; }

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
              mode: MODES[params.mode] || 0,
              offset: [dir[0] * push * amount * W * 0.16, dir[1] * push * amount * W * 0.16]
            });
            ctx.drawImage(pass.canvas, 0, 0);
          }
          if (!frozen || frozen.width !== W || frozen.height !== H) {
            frozen = document.createElement('canvas'); frozen.width = W; frozen.height = H;
          }
          frozen.getContext('2d').drawImage(out, 0, 0);
          if (present / n <= 0.01) return frame.say('Step into view.');
        }

        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (params.hand && hand.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, hand, 'hand');
        else if (params.hand && !hands.length) frame.say(split ? 'Raise a hand: move it sideways to split, swipe to turn, fist to freeze.' : 'Raise a hand: higher glitches harder, swipe bursts, fist freezes.');
      },
      reset: function () {
        burst = 0;
        dir = [1, 0]; push = 0.5; frozen = null; seenEvent = 0;
        lastT = null;
      }
    };
  }

  Magi.renderers.glitch = createGlitch;
})();
