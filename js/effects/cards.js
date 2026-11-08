// Cards: a collection of images built into 3D structures you turn and zoom with your hand.
//
// Images come from the media library (Feed: a JSON feed URL or a public Are.na channel; see
// js/library.js). Without a feed, the cards are snapshots of the camera, taken every half second.
// Structures (modes; hold up 1, 2 or 3 fingers, still, for 0.7 s to switch, or tap the tile):
//   Ribbon  — cards stand side by side along a wave, x ∈ [−1.6, 1.6], z = 0.45·sin(πx),
//             y = 0.18·sin(2πx), each turned to face across the path (normal to its tangent), so
//             they overlap like a fanned deck.
//   Ring    — cards on a circle of radius 1.1, facing outward (tangent to the circle).
//   Lattice — cards on an n×n×n grid (n = ⌈∛count⌉), all facing you, joined to their grid
//             neighbors by lime lines with a node at each card: a node graph.
// When the structure changes, every card glides to its new place and orientation over 0.8 s
// (smoothstep), its axes interpolated and re-orthonormalized.
// Projection: perspective with focal length F = 3 (in structure units): a point at depth z is
// scaled by F / (F + z). Each card is drawn by the affine map that takes the image's corners to
// three of its projected corners (top-left, top-right, bottom-left), back to front.
// Hand (thumb–index line, after the reference's "zoom/rotate"): its length zooms (0.25–1.6 palm
// lengths → 0.6×–1.8×) and its angle turns the structure; the hand's height tips it. No hand: the
// structure turns slowly on its own (Spin).
// Text: one line of lime letters in 3D below and in front of the structure, turning with it,
// on the HUD so it stays sharp.
// Inset: on, the background is a flat color (Color) and the camera sits in a small window with a
// lime title bar, as in the reference; off, the cards float over the camera.
(function () {
  var LIME = '#c8f03c', F = 3, SNAP_EVERY = 0.5;

  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

  // Target place for card i of n in a structure: center p, right axis u (the card's up is y-ish).
  function layout(mode, i, n) {
    if (mode === 'ring') {
      var a = i / n * Math.PI * 2;
      return { p: [Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1], u: [-Math.sin(a), 0, Math.cos(a)] };
    }
    if (mode === 'lattice') {
      var g = Math.max(2, Math.ceil(Math.cbrt(n))), x = i % g, y = Math.floor(i / g) % g, z = Math.floor(i / (g * g));
      var sp = 1.8 / (g - 1 || 1);
      return { p: [(x - (g - 1) / 2) * sp, (y - (g - 1) / 2) * sp, (z - (g - 1) / 2) * sp], u: [1, 0, 0], grid: [x, y, z, g] };
    }
    var t = n > 1 ? i / (n - 1) : 0.5, X = -1.6 + 3.2 * t;
    var dz = 0.45 * Math.PI * Math.cos(Math.PI * X); // tangent (1, ·, dz) in xz
    return { p: [X, 0.18 * Math.sin(2 * Math.PI * X), 0.45 * Math.sin(Math.PI * X)], u: norm([-dz, 0, 1]) };
  }

  function createCards() {
    var cards = [], mode = null, since = 0, snaps = [], lastSnap = -9, cam = document.createElement('canvas');
    var view = { yaw: 0.5, pitch: 0.2, zoom: 1, spin: 0 }, cand = null, candSince = 0, lastT = null;

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        var dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, t - lastT));
        lastT = t;
        if (cam.width !== W || cam.height !== H) { cam.width = W; cam.height = H; }
        frame.draw(cam.getContext('2d'), W, H);

        // Images: the library, or camera snapshots.
        var lib = Magi.library.get(params.feed), imgs = lib.items;
        if (!imgs.length) {
          if (t - lastSnap > SNAP_EVERY) {
            lastSnap = t;
            var s = document.createElement('canvas'), k = 200 / Math.max(W, H);
            s.width = Math.round(W * k); s.height = Math.round(H * k);
            s.getContext('2d').drawImage(cam, 0, 0, s.width, s.height);
            snaps.push(s);
            if (snaps.length > 120) snaps.shift();
          }
          imgs = snaps;
        }

        // Background and inset camera.
        if (params.inset) {
          var bg = params.color ? Magi.fx.inkColor(params.color) : [0.43, 0.56, 0.75];
          ctx.fillStyle = 'rgb(' + bg.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
          ctx.fillRect(0, 0, W, H);
        } else ctx.drawImage(cam, 0, 0);

        // Hand: zoom and turn from the thumb–index line; 1–3 fingers held still switch structure.
        var ix = Magi.interaction.read(frame), hd = ix.hands[0], e = 1 - Math.exp(-dt / 0.15);
        if (hd && !hd.fist) {
          var p = hd.points, th = p[4], ind = p[8];
          var dl = Math.hypot(ind.x - th.x, ind.y - th.y) / hd.size;
          view.zoom += (0.6 + 1.2 * Math.max(0, Math.min(1, (dl - 0.25) / 1.35)) - view.zoom) * e;
          view.yaw += (Math.atan2(ind.y - th.y, ind.x - th.x) * 1.4 - view.yaw) * e;
          view.pitch += ((hd.center.y / H - 0.5) * 1.2 - view.pitch) * e;
          if (hd.count >= 1 && hd.count <= 3 && hd.speed < 0.3 * H && !hd.pinched) {
            if (cand !== hd.count) { cand = hd.count; candSince = t; }
            else if (t - candSince > 0.7) {
              var want = ['ribbon', 'ring', 'lattice'][cand - 1];
              if (want !== params.mode) frame.setParam('mode', want);
            }
          } else cand = null;
        } else {
          cand = null;
          view.yaw += (params.spin / 100) * 0.5 * dt;
        }

        // Cards: targets for the current structure; glide on change.
        var n = Math.max(1, Math.min(Math.round(params.count), imgs.length || 1)), m = params.mode || 'ribbon';
        if (m !== mode || cards.length !== n) {
          var old = cards;
          cards = [];
          for (var i = 0; i < n; i++) {
            var tg = layout(m, i, n), from = old[i] || old[old.length - 1] || { p: tg.p, u: tg.u };
            cards.push({ from: { p: from.p, u: from.u }, to: tg, p: from.p, u: from.u, grid: tg.grid });
          }
          mode = m; since = t;
        }
        var g = smooth((t - since) / 0.8);
        cards.forEach(function (c) { c.p = lerp3(c.from.p, c.to.p, g); c.u = norm(lerp3(c.from.u, c.to.u, g)); });

        // Projection.
        var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
        var scale = Math.min(W, H) * 0.32 * view.zoom * (0.5 + params.size / 100), ox = W / 2, oy = H * (params.inset ? 0.56 : 0.5);
        function rot(v) {
          var x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy;
          return [x, v[1] * cp - z * sp, v[1] * sp + z * cp];
        }
        function proj(v) { var r = rot(v), k = F / (F + r[2]); return { x: ox + r[0] * scale * k, y: oy - r[1] * scale * k, z: r[2] }; }
        var cw = 0.42 * (m === 'lattice' ? 0.55 : 1), list = cards.map(function (c, i) {
          var img = imgs[i % imgs.length], ar = img ? img.height / img.width : 0.62;
          // The card's up: world up with its component along u removed (Gram–Schmidt).
          var d = c.u[1], v = norm([-c.u[0] * d, 1 - c.u[1] * d, -c.u[2] * d]);
          var hw = cw / 2, hh = cw * ar / 2;
          var tl = proj([c.p[0] - c.u[0] * hw + v[0] * hh, c.p[1] - c.u[1] * hw + v[1] * hh, c.p[2] - c.u[2] * hw + v[2] * hh]);
          var tr = proj([c.p[0] + c.u[0] * hw + v[0] * hh, c.p[1] + c.u[1] * hw + v[1] * hh, c.p[2] + c.u[2] * hw + v[2] * hh]);
          var bl = proj([c.p[0] - c.u[0] * hw - v[0] * hh, c.p[1] - c.u[1] * hw - v[1] * hh, c.p[2] - c.u[2] * hw - v[2] * hh]);
          return { img: img, tl: tl, tr: tr, bl: bl, z: proj(c.p).z, c: proj(c.p), grid: c.grid };
        }).sort(function (a, b) { return b.z - a.z; });

        // Lattice: node graph between grid neighbors, behind the cards.
        if (m === 'lattice' && g >= 1) {
          var at = {};
          list.forEach(function (q) { if (q.grid) at[q.grid.slice(0, 3).join(',')] = q.c; });
          ctx.strokeStyle = LIME; ctx.lineWidth = Math.max(1, 1.2 * u);
          ctx.beginPath();
          Object.keys(at).forEach(function (key) {
            var xyz = key.split(',').map(Number);
            [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (d) {
              var nb = at[(xyz[0] + d[0]) + ',' + (xyz[1] + d[1]) + ',' + (xyz[2] + d[2])];
              if (nb) { ctx.moveTo(at[key].x, at[key].y); ctx.lineTo(nb.x, nb.y); }
            });
          });
          ctx.stroke();
          ctx.fillStyle = LIME;
          Object.keys(at).forEach(function (key) { var q = at[key]; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(2, 3 * u), 0, Math.PI * 2); ctx.fill(); });
        }
        list.forEach(function (q) {
          if (!q.img) return;
          var iw = q.img.width, ih = q.img.height;
          ctx.save();
          ctx.setTransform((q.tr.x - q.tl.x) / iw, (q.tr.y - q.tl.y) / iw, (q.bl.x - q.tl.x) / ih, (q.bl.y - q.tl.y) / ih, q.tl.x, q.tl.y);
          ctx.drawImage(q.img, 0, 0);
          ctx.restore();
        });

        // Text in lime along the structure (on the HUD).
        if (params.text) {
          var txt = String(params.text), fsz = Math.max(10, 26 * u * view.zoom);
          hud.save();
          hud.fillStyle = LIME;
          hud.textAlign = 'center';
          hud.textBaseline = 'middle';
          for (var c2 = 0; c2 < txt.length; c2++) {
            // One line in 3D, letters 0.12 apart, below and in front of the structure.
            var X = (c2 - (txt.length - 1) / 2) * 0.12;
            var q2 = proj([X, -0.75, 0.6]), k2 = F / (F + q2.z);
            hud.font = '500 ' + Math.round(fsz * k2) + 'px ' + Magi.fx.MONO;
            hud.fillText(txt[c2], q2.x, q2.y);
          }
          hud.restore();
        }

        // The camera in a window with a lime title bar, the thumb–index line labeled.
        if (params.inset) {
          var iw2 = W * 0.34, ih2 = iw2 * H / W, ix0 = W * 0.04, iy0 = H * 0.05, bar = Math.max(10, 14 * u);
          ctx.fillStyle = LIME; ctx.fillRect(ix0, iy0, iw2, bar);
          ctx.drawImage(cam, ix0, iy0 + bar, iw2, ih2);
          ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, u);
          for (var b2 = 0; b2 < 3; b2++) ctx.strokeRect(ix0 + iw2 - (b2 + 1) * bar * 1.1, iy0 + bar * 0.2, bar * 0.7, bar * 0.6);
          if (hd) {
            var sc = iw2 / W, a1 = { x: ix0 + hd.points[4].x * sc, y: iy0 + bar + hd.points[4].y * sc }, a2 = { x: ix0 + hd.points[8].x * sc, y: iy0 + bar + hd.points[8].y * sc };
            ctx.strokeStyle = LIME; ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
            ctx.fillStyle = LIME; [a1, a2].forEach(function (q) { ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(2, 2.5 * u), 0, Math.PI * 2); ctx.fill(); });
            hud.save(); hud.fillStyle = LIME; hud.font = '500 ' + Math.round(10 * u) + 'px ' + Magi.fx.MONO; hud.textBaseline = 'middle';
            hud.fillText('zoom/rotate', Math.max(a1.x, a2.x) + 6 * u, (a1.y + a2.y) / 2); hud.restore();
          }
        }

        if (lib.status === 'loading' || lib.status === 'failed') frame.say(lib.message);
        else if (Magi.tracking.hands.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, Magi.tracking.hands, 'hand');
      },
      reset: function () { cards = []; mode = null; snaps = []; lastSnap = -9; lastT = null; }
    };
  }

  Magi.renderers.cards = createCards;
})();
