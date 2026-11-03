// Vines: neon vines grow from your fingertips and branch across the picture.
//
// Growth is the space colonization algorithm (Runions et al., "Modeling and visualization of leaf
// venation patterns", 2005; Runions, Lane & Prusinkiewicz, "Modeling trees with a space colonization
// algorithm", 2007). Attraction points are scattered over the frame (Density). Each step, every
// attraction point finds the nearest vine node within its radius of influence; every node that was
// chosen grows one new node a fixed step toward the average direction of the points that chose it;
// attraction points within the kill distance of a node are used up. Competition for the remaining
// space makes the vines branch on their own and spread instead of clumping. Used-up points are
// replaced over time, so growth keeps going.
// Roots: moving fingertips plant buds along their path; every bud is a node that can grow.
// Thickness follows the pipe model (da Vinci's rule, as plant biology uses it): a branch's cross
// section equals the sum of its children's, so a node's width is √(number of tips it carries).
// Leaves sit on tips (Leaves); vines age and wither away (Wither), oldest first.
// Pinch and hold: growth runs three times as fast.
(function () {
  var TIPS = [4, 8, 12, 16, 20], MAX_NODES = 3500;

  function createVines() {
    var nodes = [], attract = [], prev = {}, lastT = null, lastIx = null, recount = 0;

    function scatter(n, W, H) { for (var i = 0; i < n; i++) attract.push({ x: Math.random() * W, y: Math.random() * H }); }

    // Uniform grid over nodes, for nearest-node and kill queries.
    function grid(cell) {
      var g = new Map();
      nodes.forEach(function (nd, i) {
        var k = Math.floor(nd.x / cell) + ',' + Math.floor(nd.y / cell);
        (g.get(k) || g.set(k, []).get(k)).push(i);
      });
      return g;
    }

    function grow(W, H, step, influence, kill) {
      var g = grid(influence), pull = new Map();
      attract = attract.filter(function (a) {
        var cx = Math.floor(a.x / influence), cy = Math.floor(a.y / influence), best = -1, bd = influence * influence;
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          var list = g.get((cx + dx) + ',' + (cy + dy));
          if (!list) continue;
          for (var j = 0; j < list.length; j++) {
            var nd = nodes[list[j]], ex = a.x - nd.x, ey = a.y - nd.y, d2 = ex * ex + ey * ey;
            if (d2 < kill * kill) return false; // used up
            if (d2 < bd && nd.alive) { bd = d2; best = list[j]; }
          }
        }
        if (best >= 0) {
          var nd2 = nodes[best], l = Math.sqrt(bd) || 1, acc = pull.get(best) || [0, 0];
          acc[0] += (a.x - nd2.x) / l; acc[1] += (a.y - nd2.y) / l;
          pull.set(best, acc);
        }
        return true;
      });
      pull.forEach(function (v, i) {
        if (nodes.length >= MAX_NODES) return;
        var l = Math.hypot(v[0], v[1]) || 1, nd = nodes[i];
        nodes.push({ x: nd.x + v[0] / l * step, y: nd.y + v[1] / l * step, parent: i, age: 0, alive: true, tips: 1, leaf: Math.random() });
      });
    }

    // Pipe model: tips carried by each node, counted from the leaves back to the roots.
    function thickness() {
      nodes.forEach(function (nd) { nd.tips = 0; nd.kids = 0; });
      nodes.forEach(function (nd) { if (nd.parent >= 0) nodes[nd.parent].kids++; });
      for (var i = nodes.length - 1; i >= 0; i--) {
        var nd = nodes[i];
        if (!nd.kids) nd.tips += 1;
        if (nd.parent >= 0) nodes[nd.parent].tips += nd.tips;
      }
    }

    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        var dt = lastT === null ? 1 / 60 : Math.max(1 / 120, Math.min(1 / 30, t - lastT));
        lastT = t;
        var tracker = Magi.tracking.hands, ix = Magi.interaction.read(frame), newFrame = ix !== lastIx;
        lastIx = ix;
        var step = H * 0.012, influence = H * 0.09, kill = step * 1.6;
        var want = Math.round(150 + params.density * 9);
        if (attract.length < want) scatter(Math.min(want - attract.length, Math.ceil(want * dt * 0.4) + 1), W, H);

        // Moving fingertips plant buds along their path.
        var seen = {}, boost = 1;
        ix.hands.forEach(function (hd) {
          var p = hd.points, last = prev[hd.id];
          seen[hd.id] = true;
          if (hd.pinched) boost = 3;
          if (newFrame) {
            TIPS.forEach(function (ti) {
              var q = p[ti], lb = last && last[ti];
              if (!lb || Math.hypot(q.x - lb.x, q.y - lb.y) > step * 2.5) {
                if (nodes.length < MAX_NODES) nodes.push({ x: q.x, y: q.y, parent: -1, age: 0, alive: true, tips: 1, leaf: Math.random() });
                if (!last) last = prev[hd.id] = {};
                last[ti] = { x: q.x, y: q.y };
              }
            });
          }
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k]) delete prev[k]; });

        // Growth: up to 24 steps per second (×3 while pinching).
        var steps = (params.growth / 100) * 24 * boost * dt, whole = Math.floor(steps) + (Math.random() < steps % 1 ? 1 : 0);
        for (var s = 0; s < whole; s++) grow(W, H, step, influence, kill);

        // Withering: nodes older than their lifetime fade and are removed (children stay as roots).
        var life = 2 + (1 - params.wither / 100) * 18;
        nodes.forEach(function (nd) { nd.age += dt; nd.alive = nd.age < life * 0.8; });
        if (nodes.some(function (nd) { return nd.age > life; })) {
          var keep = [], map = new Map();
          nodes.forEach(function (nd, i) { if (nd.age <= life) { map.set(i, keep.length); keep.push(nd); } });
          keep.forEach(function (nd) { nd.parent = map.has(nd.parent) ? map.get(nd.parent) : -1; });
          nodes = keep;
        }
        if (++recount % 6 === 0 || nodes.length < 200) thickness();

        // Drawing: each segment parent → node, width from the pipe model, faded with age.
        var ink = params.color ? Magi.fx.inkColor(params.color) : [0.35, 1, 0.65];
        var rgb = ink.map(function (v) { return Math.round(v * 255); }).join(','), glow = params.glow / 100;
        ctx.save();
        ctx.lineCap = 'round';
        var buckets = [[], [], [], []];
        nodes.forEach(function (nd) {
          if (nd.parent < 0) return;
          var w = Math.min(4, Math.sqrt(nd.tips || 1) * 0.6) * u, fade = Math.max(0, 1 - nd.age / life);
          buckets[Math.min(3, Math.floor(fade * 4))].push([nodes[nd.parent], nd, Math.max(0.8 * u, w)]);
        });
        buckets.forEach(function (bk, bi) {
          if (!bk.length) return;
          var alpha = (bi + 1) / 4;
          if (glow > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.12 * glow * alpha) + ')';
            ctx.lineWidth = 6 * u;
            ctx.beginPath();
            bk.forEach(function (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); });
            ctx.stroke();
          }
          // The vines themselves are painted, so they keep their color on bright backgrounds.
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.9 * alpha) + ')';
          bk.forEach(function (sg) { ctx.lineWidth = sg[2]; ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke(); });
        });
        // Leaves on tips: small ellipses along the growth direction, and buds as dots.
        ctx.fillStyle = 'rgba(' + rgb + ',0.8)';
        ctx.beginPath();
        nodes.forEach(function (nd) {
          if (nd.kids || nd.parent < 0 || nd.leaf > params.leaves / 100) return;
          var pa = nodes[nd.parent], an = Math.atan2(nd.y - pa.y, nd.x - pa.x) + (nd.leaf < 0.5 ? 0.7 : -0.7), r = step * 0.9;
          ctx.moveTo(nd.x + Math.cos(an) * r * 2, nd.y + Math.sin(an) * r * 2);
          ctx.ellipse(nd.x + Math.cos(an) * r, nd.y + Math.sin(an) * r, r, r * 0.4, an, 0, Math.PI * 2);
        });
        ctx.fill();
        ctx.restore();

        if (tracker.status() !== 'ready') Magi.tracking.drawStatus(ctx, frame, tracker, 'hand');
        else if (!ix.hands.length && !nodes.length) Magi.tracking.hint(ctx, frame, 'Raise a hand and move your fingers to plant vines.');
      },
      reset: function () { nodes = []; attract = []; prev = {}; lastT = null; lastIx = null; }
    };
  }

  Magi.renderers.vines = createVines;
})();
