// Tutting: a volume of image tiles held in the box your arms make, cut from your own room.
//
// Tutting is a dance of right angles made with the arms and hands, so the volume follows the box
// between your palms: its width is their horizontal distance, its height their vertical offset
// (never thinner than a hand), so it stretches to a slab side by side and stacks into a column
// one above the other. Tiles fill the box in 3D and are drawn in perspective, far to near.
// Each tile turns about the vertical axis like a page of an open book, by θ = (π/2)(1 − |x|)
// from the edges in, so its visible width is w·sin(π|x|/2): full at the sides, an edge-on
// sliver at the center. Fan sets how strongly they turn.
// Strips mode: the reference's look, thin 6:1 strips of the room in 24 rows, turning like pages
// toward an edge-on spine at the center.
// Rubik's mode: the volume becomes a 3×3×3 cube of blocks, each a stack of 12 slats. A flick (Interaction Engine)
// turns one layer 90° the flick's way over 0.35 s (eased with smoothstep), then the layer's blocks
// snap to their new grid places and orientations (positions rotated and rounded, orientations
// multiplied by the 90° rotation). Left/right flicks turn a row about the vertical axis, up/down a
// column about the horizontal one; 1, 2 or 3 fingers at the flick pick the layer. Your palms' roll
// turns the whole cube; one hand is enough. Strips go edge-on as their block turns away.
// Tiles show the camera itself, no outside images. Scatter: each tile keeps a piece of the room
// from somewhere in the frame. Behind: each tile shows what is behind it, shifted by its depth,
// like a pane of thick glass.
(function () {
  var PALM = [0, 5, 9, 13, 17], WRIST = 0, MIDDLE_TIP = 12, FOCAL = 3;

  function palmCenter(p) {
    var x = 0, y = 0;
    PALM.forEach(function (i) { x += p[i].x; y += p[i].y; });
    return { x: x / PALM.length, y: y / PALM.length };
  }

  // Strips: thin horizontal pieces of the room, 6:1, in rows, like the reference's volume.
  var STRIP = 6, ROWS = 24;

  // Rubik's: 27 blocks on a 3×3×3 grid, each holding a few strips. Rotation matrices are
  // row-major 3×3; a layer turn is 90° about x (up/down flicks) or y (left/right flicks).
  function rotAxis(axis, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return axis === 'x' ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  }
  function mulM(m, n) {
    return [0, 1, 2].map(function (i) { return [0, 1, 2].map(function (j) { return m[i][0] * n[0][j] + m[i][1] * n[1][j] + m[i][2] * n[2][j]; }); });
  }
  function mulV(m, v) { return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]; }
  var I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  var CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

  function createTutting() {
    var tiles = [], box = null, last = 0;
    var cam = document.createElement('canvas'), cctx = cam.getContext('2d');
    var strips = [], cubies = [], turn = null, queue = [], seenEvent = 0, roll = 0, cubeLines = [];

    function buildStrips(n) {
      strips = [];
      for (var i = 0; i < n; i++) {
        var row = Math.floor(Math.random() * ROWS);
        strips.push({ x: Math.random() * 2 - 1, y: (row + 0.5) / ROWS * 2 - 1, z: Math.random() * 2 - 1, s: 0.5 + Math.random(), u: Math.random(), v: Math.random() });
      }
    }

    // Each block is a neat stack of slats, 6 rows by 2 layers, filling 80% of its cell, so the
    // 27 blocks read as a cube.
    function buildCube() {
      cubies = [];
      for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
        var pieces = [];
        for (var r = 0; r < 6; r++) for (var l = 0; l < 2; l++) {
          pieces.push({ p: [0, (r + 0.5) / 6 * 0.8 - 0.4, l ? 0.2 : -0.2], s: 1, u: Math.random(), v: Math.random() });
        }
        cubies.push({ pos: [x, y, z], rot: I3, pieces: pieces });
      }
    }

    // A flick turns one layer: left/right turn a row about the vertical axis, up/down a column
    // about the horizontal axis; 1, 2 or 3 fingers pick the layer (top/left, middle, bottom/right).
    function startTurn(e, count) {
      var layer = count >= 1 && count <= 3 ? count - 2 : 0;
      if (e.dir === 'left' || e.dir === 'right') return { axis: 'y', layer: layer, sign: e.dir === 'right' ? 1 : -1, t: 0 };
      return { axis: 'x', layer: layer, sign: e.dir === 'down' ? 1 : -1, t: 0 };
    }
    function inLayer(c, tn) { return Math.round(tn.axis === 'y' ? c.pos[1] : c.pos[0]) === tn.layer; }

    function drawStrip(ctx, W, H, q, sx, sy, w, h, alpha, edges) {
      var sw = Math.min(W, w * 2.2), sh = sw / STRIP;
      var ux = q.u * (W - sw), uy = q.v * (H - sh);
      ctx.globalAlpha = alpha;
      ctx.drawImage(cam, ux, uy, sw, sh, sx - w / 2, sy - h / 2, w, h);
      if (edges) ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
    }

    function build(n) {
      tiles = [];
      for (var i = 0; i < n; i++) {
        tiles.push({
          x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 2 - 1,
          s: 0.6 + Math.random() * 0.8, u: Math.random(), v: Math.random(),
          ph: Math.random() * 6.28, rate: 0.4 + Math.random()
        });
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        if (cam.width !== W || cam.height !== H) { cam.width = W; cam.height = H; }
        frame.draw(cctx, W, H);
        ctx.drawImage(cam, 0, 0);
        if (tiles.length !== params.tiles) build(params.tiles);
        var dt = last ? Math.min(0.05, (frame.time - last) / 1000) : 1 / 60;
        last = frame.time;

        var tracker = Magi.tracking.hands, hands = tracker.detect(frame), mode = params.mode || 'scatter';
        var ix = Magi.interaction.read(frame);
        if (hands.length < 2 && mode === 'rubik' && (box || hands.length === 1)) {
          // Rubik's keeps its box with one hand, so that hand is free to flick.
          if (!box) box = { x: W / 2, y: H / 2, w: H * 0.25, h: H * 0.25 };
        } else if (hands.length >= 2) {
          var A = palmCenter(hands[0]), B = palmCenter(hands[1]);
          var hand = (Math.hypot(hands[0][MIDDLE_TIP].x - hands[0][WRIST].x, hands[0][MIDDLE_TIP].y - hands[0][WRIST].y) +
            Math.hypot(hands[1][MIDDLE_TIP].x - hands[1][WRIST].x, hands[1][MIDDLE_TIP].y - hands[1][WRIST].y)) / 2;
          var want = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, w: Math.max(Math.abs(B.x - A.x) / 2, hand * 0.5), h: Math.max(Math.abs(B.y - A.y) / 2, hand * 0.55) };
          if (!box) box = want;
          var e = 1 - Math.exp(-dt / 0.07);
          Object.keys(want).forEach(function (k) { box[k] += (want[k] - box[k]) * e; });
        } else {
          box = null;
        }

        if (box && (mode === 'strips' || mode === 'rubik')) {
          if (params.dim) {
            ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100 * 0.85).toFixed(3) + ')';
            ctx.fillRect(0, 0, W, H);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          var fanS = params.fan / 100, depthS = 0.15 + (params.depth / 100) * 0.85, list = [];
          if (mode === 'strips') {
            // Rows of strips filling the box; each turns like a page, edge-on at the center spine.
            if (strips.length !== params.tiles) buildStrips(params.tiles);
            var rowH = box.h * 2 / ROWS, driftS = (params.drift / 100) * 0.05;
            strips.forEach(function (q) {
              var x = Math.max(-1, Math.min(1, q.x + Math.sin(t * 0.7 + q.u * 9) * driftS));
              var k = FOCAL / (FOCAL + q.z * depthS), turnS = (1 - fanS) + fanS * Math.sin(Math.PI * Math.abs(x) / 2);
              var hh = rowH * 1.1 * k * (0.7 + params.size / 100 * 1.2), ww = hh * STRIP * q.s;
              list.push({ q: q, x: box.x + x * box.w * k, y: box.y + q.y * box.h * k, w: Math.max(1, ww * turnS), h: hh, z: q.z, k: k });
            });
          } else {
            if (!cubies.length) buildCube();
            ix.events.forEach(function (e) {
              if (e.n <= seenEvent || e.type !== 'flick') return;
              seenEvent = e.n;
              var hd = ix.hands.filter(function (h) { return h.id === e.hand; })[0];
              if (queue.length < 2) queue.push(startTurn(e, hd ? hd.count : 0));
            });
            if (!turn && queue.length) turn = queue.shift();
            if (turn) {
              turn.t = Math.min(1, turn.t + dt / 0.35);
              if (turn.t >= 1) {
                // Snap: the layer's blocks take their new places and orientations for good.
                var R90 = rotAxis(turn.axis, turn.sign * Math.PI / 2), tn = turn;
                cubies.forEach(function (c) {
                  if (!inLayer(c, tn)) return;
                  c.pos = mulV(R90, c.pos).map(Math.round);
                  c.rot = mulM(R90, c.rot);
                });
                turn = null;
              }
            }
            // The whole cube turns with your palms' roll, tipped back so all three faces show.
            if (ix.hands.length) roll += (ix.hands.reduce(function (a, h) { return a + h.rotation; }, 0) / ix.hands.length * Math.PI / 180 * 1.2 - roll) * (1 - Math.exp(-dt / 0.1));
            var V = mulM(rotAxis('x', -0.45), rotAxis('y', roll + 0.6)), unit = (box.w + box.h) / 2 / 1.7;
            var ang = turn ? turn.sign * Math.PI / 2 * (turn.t * turn.t * (3 - 2 * turn.t)) : 0;
            var Rt = turn ? rotAxis(turn.axis, ang) : I3;
            cubeLines = [];
            cubies.forEach(function (c) {
              var moving = turn && inLayer(c, turn), Rc = moving ? mulM(Rt, c.rot) : c.rot, pos = moving ? mulV(Rt, c.pos) : c.pos;
              var corners = [];
              for (var ci = 0; ci < 8; ci++) {
                var lc = mulV(Rc, [ci & 1 ? 0.45 : -0.45, ci & 2 ? 0.45 : -0.45, ci & 4 ? 0.45 : -0.45]);
                var wc = mulV(V, [pos[0] + lc[0], pos[1] + lc[1], pos[2] + lc[2]]), kc = FOCAL / (FOCAL + wc[2] / 1.5 * depthS);
                corners.push([box.x + wc[0] * unit * kc, box.y + wc[1] * unit * kc]);
              }
              CUBE_EDGES.forEach(function (ed) { cubeLines.push(corners[ed[0]][0], corners[ed[0]][1], corners[ed[1]][0], corners[ed[1]][1]); });
              var axisX = mulV(V, mulV(Rc, [1, 0, 0])); // the strips' own long axis, on screen
              c.pieces.forEach(function (q) {
                var w3 = mulV(V, [pos[0] + mulV(Rc, q.p)[0], pos[1] + mulV(Rc, q.p)[1], pos[2] + mulV(Rc, q.p)[2]]);
                var k = FOCAL / (FOCAL + w3[2] / 1.5 * depthS), hh = unit * 0.1 * k;
                var face = (1 - fanS) + fanS * Math.hypot(axisX[0], axisX[1]); // edge-on when turned away
                list.push({ q: q, x: box.x + w3[0] * unit * k, y: box.y + w3[1] * unit * k, w: Math.max(1, unit * 0.8 * k * face), h: hh, z: w3[2], k: k });
              });
            });
          }
          list.sort(function (a, b) { return b.z - a.z; });
          list.forEach(function (p) { drawStrip(ctx, W, H, p.q, p.x, p.y, p.w, p.h, 0.65 + 0.35 * Math.min(1, p.k), params.edges); });
          ctx.globalAlpha = 1;
          if (mode === 'rubik' && cubeLines.length) {
            // Each block's wireframe, so the cube and its turning layers read.
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = Math.max(1, frame.pxPerCss);
            ctx.beginPath();
            for (var li = 0; li < cubeLines.length; li += 4) { ctx.moveTo(cubeLines[li], cubeLines[li + 1]); ctx.lineTo(cubeLines[li + 2], cubeLines[li + 3]); }
            ctx.stroke();
          }
        } else if (box) {
          if (params.dim) {
            ctx.fillStyle = 'rgba(0,0,0,' + (params.dim / 100 * 0.85).toFixed(3) + ')';
            ctx.fillRect(0, 0, W, H);
          }
          var depth = 0.15 + (params.depth / 100) * 0.85, fan = params.fan / 100, drift = (params.drift / 100) * 0.06;
          var base = Math.min(W, H) * 0.012 + (params.size / 100) * Math.min(W, H) * 0.05;
          var placed = tiles.map(function (q) {
            var x = Math.max(-1, Math.min(1, q.x + Math.sin(t * q.rate + q.ph) * drift));
            var y = Math.max(-1, Math.min(1, q.y + Math.cos(t * q.rate * 0.8 + q.ph) * drift));
            var k = FOCAL / (FOCAL + q.z * depth);
            var turn = (1 - fan) + fan * Math.sin(Math.PI * Math.abs(x) / 2);
            var w = base * q.s * k, hgt = w * 0.55;
            return { q: q, sx: box.x + x * box.w * k, sy: box.y + y * box.h * k, w: Math.max(1, w * turn), h: hgt, z: q.z, k: k };
          });
          placed.sort(function (a, b) { return b.z - a.z; });
          var behind = params.mode === 'behind';
          placed.forEach(function (p) {
            var sw = p.w * 1.4, sh = p.h * 1.4, sx, sy;
            if (behind) {
              sx = p.sx - sw / 2 + p.z * box.w * 0.35;
              sy = p.sy - sh / 2;
            } else {
              sx = p.q.u * (W - sw);
              sy = p.q.v * (H - sh);
            }
            sx = Math.max(0, Math.min(W - sw, sx));
            sy = Math.max(0, Math.min(H - sh, sy));
            ctx.globalAlpha = 0.6 + 0.4 * Math.min(1, p.k);
            ctx.drawImage(cam, sx, sy, sw, sh, p.sx - p.w / 2, p.sy - p.h / 2, p.w, p.h);
            if (params.edges) {
              ctx.strokeStyle = 'rgba(255,255,255,0.35)';
              ctx.lineWidth = 1;
              ctx.strokeRect(p.sx - p.w / 2, p.sy - p.h / 2, p.w, p.h);
            }
          });
          ctx.globalAlpha = 1;
        }

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (mode === 'rubik' && !box) Magi.tracking.hint(ctx, frame, 'Hold up a hand. Flick to turn a layer; 1, 2 or 3 fingers pick it; roll to turn the cube.');
        else if (hands.length < 2 && mode !== 'rubik') Magi.tracking.hint(ctx, frame, 'Hold up both hands. Move them apart, together, above and below.');
      },
      reset: function () { last = 0; box = null; turn = null; queue = []; roll = 0; cubies = []; }
    };
  }

  Magi.renderers.tutting = createTutting;
})();
