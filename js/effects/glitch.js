// Glitch: your whole body breaks up like corrupted video, and your hand controls it.
//
// The body is MediaPipe's person mask (Magi.tracking.body); the glitch happens only inside it.
// The hand is the controller (Interaction Engine). In Blocks and Dissolve, the higher your highest
// fingertip, the stronger the glitch; in Split, the seams cross at your hand. A swipe fires a
// burst that fades with a 0.25 s half-life. A fist stops the glitch while you hold it (the video
// keeps running clean); a pinch freezes the glitched picture until you let go. With Hand off, the
// glitch holds steady at Amount.
//
// The corruption is redrawn from a new random seed `Speed` times a second (2–30 Hz) and holds in
// between, so it stutters like a broken stream instead of shimmering. Each mode is a real failure:
//   Split    — tiles out of register, like the reference: two seams, one vertical and one
//              horizontal, cross at your hand and cut the frame into four tiles (cross-faded over
//              1.5% of the frame, so the seams aren't hard cuts). Within each tile the picture
//              slips by its own offset and its channels are read from different places (chroma
//              misregistration), so edges grow colored ghosts that change from tile to tile,
//              while the photo stays visible; the effect fades in softly at the body's edge.
//   Blocks   — 8×8-style macroblock damage: blocks that lose their AC coefficients decode as their
//              DC term alone (the block's mean color), blocks with a wrong motion vector copy
//              pixels from the wrong place, and some decode with the channels in the wrong order.
//   Dissolve — packet loss: pieces of the body arrive in the wrong place (up to Spread away), and
//              the missing pieces decode as random bits, 1 bit per channel against a random
//              threshold, which keeps the body's color on average.
// Profile: 0 keeps the picture's colors; 1 is neon (saturation and contrast up); 2–5 are two-ink
// duotones (red/cyan, magenta/green, gold/blue, black/white). In Split each ink reads the picture
// from its own offset, like an anaglyph; in Blocks and Dissolve damaged pixels map from one ink to
// the other by brightness. Overexposed (Blocks): include blocks decoded at 1 bit per channel.
// Depth (Blocks, Dissolve) sizes the blocks by how close you are: the share of the frame your body
// fills, snapped to ½×, 1×, 2× or 4×.
// It runs as a WebGL fragment shader: every pixel is decided independently from the seed.
(function () {
  var INDEX_TIP = 8;
  var MODES = { split: 0, blocks: 1, dissolve: 2 };

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size, seam;',
    'uniform float amount, block, seed, mode, profile, depth, spread, near, neon;',
    'varying vec2 uv;',
    // Dave Hoskins' hash without sine: a uniform pseudo-random number in [0, 1) per input.
    'float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'float body(vec2 px) { return smoothstep(0.35, 0.65, texture2D(mask, px / size).r); }',
    'float soft(vec2 px) { return smoothstep(0.15, 0.85, texture2D(mask, px / size).r); }',
    'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'vec3 cam1(vec2 px) { return texture2D(cam, clamp(px / size, 0.0, 1.0)).rgb; }',
    'vec3 crush(vec3 c) { return step(0.5, c); }', // 1 bit per channel
    // Profiles: 0 the picture's own colors, 1 neon (saturation × 1.8, contrast × 1.3), then two-ink
    // duotones that map luma from one ink to the other: 2 red/cyan, 3 magenta/green, 4 gold/blue,
    // 5 black/white.
    'vec3 inkA(float p) { return p < 2.5 ? vec3(1.0, 0.1, 0.15) : p < 3.5 ? vec3(1.0, 0.0, 0.8) : p < 4.5 ? vec3(1.0, 0.75, 0.0) : vec3(1.0); }',
    'vec3 inkB(float p) { return p < 2.5 ? vec3(0.0, 0.9, 1.0) : p < 3.5 ? vec3(0.0, 1.0, 0.3) : p < 4.5 ? vec3(0.1, 0.25, 1.0) : vec3(0.0); }',
    'vec3 tone(vec3 c) {',
    '  if (profile < 0.5) return c;',
    '  if (profile < 1.5) { float l = luma(c); return clamp((mix(vec3(l), c, 1.8) - 0.5) * 1.3 + 0.5, 0.0, 1.0); }',
    '  float l = smoothstep(0.1, 0.9, luma(c));',
    '  return mix(inkB(profile), inkA(profile), l);',
    '}',
    // Block size by how close the body is (the share of the frame it fills), as a power of two.
    'float blockAt(vec2 px) {',
    '  if (depth < 0.5) return block;',
    '  return block * exp2(clamp(floor(log2(near) + 0.5), -1.0, 2.0));',
    '}',
    'void main() {',
    '  vec2 px = uv * size;',
    '  vec3 base = texture2D(cam, uv).rgb;',
    '  vec3 col = base;',
    '  float s = seed * 0.6180339;',
    '  if (mode < 0.5) {',
    // Two seams cross at the hand; within 1.5% of the frame of a seam the tiles cross-fade, so
    // the seams read as slips, not hard cuts.
    '    float feather = size.y * 0.015;',
    '    vec2 w = smoothstep(-feather, feather, px - seam);',
    '    vec3 acc = vec3(0.0); float tot = 0.0;',
    '    for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) {',
    '      vec2 tile = vec2(float(i), float(j));',
    '      float k = (i == 0 ? 1.0 - w.x : w.x) * (j == 0 ? 1.0 - w.y : w.y);',
    '      if (k < 0.001) continue;',
    '      float mag = amount * size.x * 0.045;',
    '      vec2 src = px - (vec2(hash(tile + s), hash(tile + s + 2.1)) - 0.5) * 2.0 * mag;',
    '      vec2 oR = (vec2(hash(tile + s + 4.3), hash(tile + s + 5.9)) - 0.5) * 2.0 * mag;',
    '      vec2 oB = (vec2(hash(tile + s + 7.7), hash(tile + s + 8.1)) - 0.5) * 2.0 * mag;',
    '      vec3 c;',
    '      if (profile < 1.5) c = tone(vec3(cam1(src + oR).r, cam1(src).g, cam1(src + oB).b));',
    // Two-ink profiles split like an anaglyph: each ink reads the picture from its own offset.
    // The inks are complementary (they add to about white), so where the two reads agree the
    // picture is gray and where they differ the ghosts come out in the two inks.
    '      else {',
    '        float la = luma(cam1(src + oR)), lb = luma(cam1(src + oB));',
    '        c = profile > 4.5 ? vec3(0.5 * (la + lb)) : clamp(inkA(profile) * la + inkB(profile) * lb, 0.0, 1.0);',
    '      }',
    '      acc += c * k; tot += k;',
    '    }',
    '    col = mix(base, acc / max(tot, 1e-4), soft(px));',
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
    '      } else if (neon > 0.5) {',
    '        col = crush(base.gbr);', // overexposed: wrong channel order at 1 bit
    '      } else {',
    '        col = base.gbr;',
    '      }',
    '      col = tone(col);',
    '    }',
    '  } else {',
    '    float c = max(2.0, floor(blockAt(px) * 0.5));',
    '    vec2 cell = floor(px / c), center = (cell + 0.5) * c;',
    '    vec2 dir = vec2(hash(cell + s), hash(cell + s + 1.3)) - 0.5;',
    '    vec2 from = center - dir * 2.0 * amount * spread * size.y;',
    '    float r = hash(cell + s + 2.9);',
    '    if (body(from) > 0.5 && r < amount * 0.5) {',
    '      vec3 piece = cam1(from);',
    '      col = tone(hash(cell + s + 4.4) < 0.3 ? crush(piece) : piece);',
    '    } else if (body(center) > 0.5 && r < amount * 0.75) {',
    // A lost piece decodes as random bits: 1 bit per channel with a random threshold, so on
    // average it keeps the body's own color (stochastic quantization).
    '      vec3 noise = vec3(hash(cell + s + 6.1), hash(cell + s + 7.7), hash(cell + s + 8.3));',
    '      col = tone(step(noise, cam1(center)));',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Slip (after a black-and-white music-video edit): the picture crushed to black and white, the
  // mouth-and-jaw block of your face slipping out of place, and a mirrored ripple through the body.
  //   Threshold: Otsu's method (1979) on a 128-px-wide copy: the threshold t that maximizes the
  //     between-class variance σ²(t) = ω₀ω₁(μ₀ − μ₁)² of the brightness histogram, so the split
  //     adapts to the light; the picture goes through a steep curve there (±0.05).
  //   Block: from the face mesh, under the nose (landmark 2) to the chin (152), jaw to jaw (58,
  //     172, 61 / 288, 397, 291). Speed times a second it jumps to a new offset, mostly down and
  //     sideways, up to Amount × (0.6 × its height, 0.3 × its width); one jump in five snaps back.
  //     It is drawn from where it was, with a thin black seam on its edge, like a cut-and-paste.
  //   Ripple: under the chin, for 1.6 face heights and only inside the body mask, x is mirrored
  //     about the face's center line, x′ = cx − |x − cx|, and shifted by a·sin(0.045y + 5t),
  //     a = Amount × 0.12 × the face height, faded in and out across the band (sin πk).
  var SLIP_FRAG = [
    'precision highp float;',
    'uniform sampler2D cam, mask;',
    'uniform vec2 size, r0, r1, d, band;',
    'uniform float thr, cx, amp, t, face;',
    'varying vec2 uv;',
    'void main() {',
    '  vec2 px = uv * size, src = px;',
    '  float body = smoothstep(0.35, 0.65, texture2D(mask, uv).r);',
    '  if (face > 0.5 && px.y > band.x && px.y < band.y && body > 0.5) {',
    '    float k = (px.y - band.x) / (band.y - band.x);',
    '    src.x = cx - abs(px.x - cx) + amp * sin(px.y * 0.045 + t * 5.0) * sin(k * 3.14159);',
    '  }',
    '  float seamLine = 0.0;',
    '  if (face > 0.5) {',
    '    vec2 q = px - d;',
    '    if (q.x > r0.x && q.x < r1.x && q.y > r0.y && q.y < r1.y) {',
    '      src = q;',
    '      vec2 e = min(q - r0, r1 - q);',
    '      if (min(e.x, e.y) < 1.5 && length(d) > 1.0) seamLine = 1.0;',
    '    }',
    '  }',
    '  float L = dot(texture2D(cam, clamp(src / size, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  float v = smoothstep(thr - 0.05, thr + 0.05, L) * (1.0 - seamLine);',
    '  gl_FragColor = vec4(vec3(v), 1.0);',
    '}'
  ].join('\n');

  // Otsu's threshold of the frame's brightness, 0…1.
  function otsu(ctx2, w, h) {
    var d = ctx2.getImageData(0, 0, w, h).data, hist = new Float64Array(256), n = w * h, i;
    for (i = 0; i < n; i++) hist[Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2])]++;
    var sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var w0 = 0, s0 = 0, best = 0, at = 128;
    for (i = 0; i < 256; i++) {
      w0 += hist[i];
      if (!w0) continue;
      var w1 = n - w0;
      if (!w1) break;
      s0 += i * hist[i];
      var m0 = s0 / w0, m1 = (sum - s0) / w1, between = w0 * w1 * (m0 - m1) * (m0 - m1);
      if (between > best) { best = between; at = i; }
    }
    return at / 255;
  }

  function createGlitch() {
    var pass, maskBytes = null, burst = 0, lastT = null, seenEvent = 0, seam = null, held = null;
    var slipPass, small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
    var thr = 0.5, lastId = null, slip = { d: [0, 0], epoch: -1 };
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
        var hands = [], hand = Magi.tracking.hands, level = 1, split = params.mode === 'split' || !params.mode, stopped = false, pinched = false;
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
          pinched = hands.some(function (h) { return h.pinched; });
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
        // A fist stops the glitch; the video keeps running. A pinch holds the glitched picture as
        // it is until you let go.
        if (stopped) { held = null; frame.say('Open your hand to glitch again.'); return; }
        if (pinched && held) { ctx.drawImage(held, 0, 0); return; }
        var amount = Math.min(1, params.amount / 100 * level + burst);

        if (params.mode === 'slip') {
          if (slipPass === undefined) slipPass = Magi.fx.shaderPass(SLIP_FRAG, ['cam', 'mask']);
          if (!slipPass) { frame.say('Slip needs WebGL, which this browser has turned off.'); return; }
          // Otsu threshold once per camera frame.
          var id = Magi.tracking.frameId(frame.source) + W;
          if (id !== lastId) {
            lastId = id;
            var sw = 128, sh = Math.max(8, Math.round(128 * H / W));
            if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
            sctx.drawImage(out, 0, 0, sw, sh);
            thr = otsu(sctx, sw, sh);
          }
          var faces = Magi.tracking.face.detect(frame), f = faces[0], u0 = { r0: [0, 0], r1: [0, 0], band: [0, 0], cx: 0, fh: 1 };
          if (f) {
            var xs = function (ids, fn) { return fn.apply(null, ids.map(function (k) { return f[k].x; })); };
            var fh = Math.abs(f[152].y - f[10].y) || 1;
            u0 = { r0: [xs([58, 172, 61], Math.min), f[2].y], r1: [xs([288, 397, 291], Math.max), f[152].y], cx: f[1].x, fh: fh };
            u0.band = [f[152].y + 0.05 * fh, f[152].y + 1.6 * fh];
          }
          // The block's offset jumps Speed times a second.
          var rate = 2 + params.speed / 100 * 10, ep = Math.floor(t * rate);
          if (ep !== slip.epoch) {
            slip.epoch = ep;
            var bw = u0.r1[0] - u0.r0[0], bh = u0.r1[1] - u0.r0[1];
            slip.d = Math.random() < 0.2 ? [0, 0] : [(Math.random() - 0.5) * 0.6 * bw * amount, Math.random() * 0.6 * bh * amount];
          }
          if (seg) {
            var nn = seg.width * seg.height;
            if (!maskBytes || maskBytes.length !== nn * 4) maskBytes = new Uint8Array(nn * 4);
            for (var q = 0; q < nn; q++) { var mv = seg.mask[q] * 255; maskBytes[q * 4] = maskBytes[q * 4 + 1] = maskBytes[q * 4 + 2] = mv; maskBytes[q * 4 + 3] = 255; }
            slipPass.data('mask', seg.width, seg.height, maskBytes);
          } else slipPass.data('mask', 1, 1, new Uint8Array([0, 0, 0, 255]));
          slipPass.texture('cam', out);
          slipPass.run(W, H, { size: [W, H], r0: u0.r0, r1: u0.r1, d: slip.d, band: u0.band, thr: thr, cx: u0.cx, amp: amount * 0.12 * u0.fh, t: t, face: f ? 1 : 0 });
          ctx.drawImage(slipPass.canvas, 0, 0);
          if (!held || held.width !== W || held.height !== H) { held = document.createElement('canvas'); held.width = W; held.height = H; }
          held.getContext('2d').drawImage(out, 0, 0);
          var faceT = Magi.tracking.face;
          if (faceT.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, faceT, 'face');
          else if (!f) frame.say('Face the camera.');
          return;
        }

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
            // Depth: a body filling 35% of the frame is 1×.
            pass.run(W, H, {
              size: [W, H],
              amount: amount,
              block: Math.round((4 + params.block * 4) * Math.max(W, H) / 1280),
              seed: Math.floor(t * rate) % 4096,
              mode: MODES[params.mode] || 0,
              seam: [seam.x, seam.y],
              profile: params.profile,
              depth: params.depth ? 1 : 0,
              near: Math.max(0.5, (present / n) / 0.35),
              spread: (params.spread / 100) * 0.6,
              neon: params.neon ? 1 : 0
            });
            ctx.drawImage(pass.canvas, 0, 0);
            if (!held || held.width !== W || held.height !== H) { held = document.createElement('canvas'); held.width = W; held.height = H; }
            held.getContext('2d').drawImage(out, 0, 0);
          }
          if (present / n <= 0.01) return frame.say('Step into view.');
        }

        if (body.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, body, 'body');
        else if (params.hand && hand.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, hand, 'hand');
        else if (params.hand && !hands.length) frame.say(split ? 'Raise a hand: the seams cross at your hand. Fist stops.' : 'Raise a hand: higher glitches harder, swipe bursts, fist stops.');
      },
      reset: function () {
        burst = 0; seenEvent = 0; seam = null; held = null;
        lastT = null;
      }
    };
  }

  Magi.renderers.glitch = createGlitch;
})();
