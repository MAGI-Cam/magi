// Scanner: a kinetic text scanner. Every word in the picture gets a box and a tag with what was
// read; a dark scan head travels from word to word in reading order, leaving the visited boxes
// tinted and a thin line through their centers (after a set of references of animated OCR boxes).
//
// Where the words come from:
//   Text in the picture (a photo, a video or the live camera): OCR by Tesseract.js (Tesseract's
//     LSTM recognizer compiled to WebAssembly, running in the browser; nothing is uploaded),
//     loaded from jsDelivr on first use with the English model (about 3 MB, then cached). A photo
//     is read once; live video is read again about every 1.2 s, while the scan keeps going.
//     Words below 55% confidence are dropped.
//   No text found: the Text you type is set on the picture (Bodoni, centered lines fitted to
//     the frame) and scanned instead. With nothing typed, it asks you to type.
// Boxes: each word's bounding box plus a margin (Margin, as a share of the word's height), so a
// warped or slanted word is covered entirely.
// Reading order: words are grouped into lines (a word joins a line when its vertical center is
// within 0.6 of the line's typical height of it), lines go top to bottom, words in a line left to
// right.
// Motion: the head moves to the next word every hop (Speed: 600 ms down to 70 ms), gliding there
// with an ease-out (cubic) over the first 60% of the hop; at the end it pauses 0.8 s and starts
// again from the top.
// Hand: point with your index finger and the head jumps to the word nearest your fingertip, and
// carries on from there.
(function () {
  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/';
  var ocr = { status: 'idle', worker: null, busy: false, error: null };
  function loadOcr() {
    if (ocr.status !== 'idle') return;
    ocr.status = 'loading';
    var s = document.createElement('script');
    s.src = TESS + 'tesseract.min.js';
    s.onload = function () {
      window.Tesseract.createWorker('eng', 1, {
        workerPath: TESS + 'worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
      }).then(function (w) { ocr.worker = w; ocr.status = 'ready'; }, function (e) { ocr.status = 'failed'; ocr.error = e; });
    };
    s.onerror = function () { ocr.status = 'failed'; };
    document.head.appendChild(s);
  }
  // Read a canvas; resolves with [{ text, x, y, w, h }] in the canvas's pixels.
  function read(canvas) {
    ocr.busy = true;
    return ocr.worker.recognize(canvas).then(function (r) {
      ocr.busy = false;
      return (r.data.words || []).filter(function (wd) { return wd.confidence >= 55 && wd.text.trim(); }).map(function (wd) {
        return { text: wd.text.trim(), x: wd.bbox.x0, y: wd.bbox.y0, w: wd.bbox.x1 - wd.bbox.x0, h: wd.bbox.y1 - wd.bbox.y0 };
      });
    }, function () { ocr.busy = false; return null; });
  }

  // Reading order: lines top to bottom, words left to right.
  function order(words) {
    var byY = words.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); }), lines = [];
    byY.forEach(function (wd) {
      var cy = wd.y + wd.h / 2, line = lines[lines.length - 1];
      if (line && Math.abs(cy - line.cy) < 0.6 * line.h) { line.words.push(wd); line.cy = (line.cy * (line.words.length - 1) + cy) / line.words.length; }
      else lines.push({ cy: cy, h: wd.h, words: [wd] });
    });
    return [].concat.apply([], lines.map(function (l) { return l.words.sort(function (a, b) { return a.x - b.x; }); }));
  }

  function createScanner() {
    var words = [], src = 'none', i = 0, hopAt = 0, lastId = null, lastRead = -9, readCanvas = document.createElement('canvas'), from = null, typedKey = '', pausedTill = 0;
    function ease(k) { k = Math.max(0, Math.min(1, k)); return 1 - Math.pow(1 - k, 3); }
    return {
      animated: true,
      render: function (frame, out, params) {
        var W = frame.width, H = frame.height, u = frame.pxPerCss, t = frame.time / 1000, hud = frame.hud;
        if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
        var ctx = out.getContext('2d');
        frame.draw(ctx, W, H);
        if (params.dim) { ctx.fillStyle = 'rgba(255,255,255,' + (params.dim / 100 * 0.9).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
        loadOcr();

        // Read the picture: once per still image, about every 1.2 s for video.
        var id = Magi.tracking.frameId ? Magi.tracking.frameId(frame.source) : t, still = !frame.source || frame.source.tagName !== 'VIDEO';
        var due = still ? id !== lastId : t - lastRead > 1.2;
        if (ocr.status === 'ready' && !ocr.busy && due) {
          lastId = id; lastRead = t;
          var k = Math.min(1, 1280 / Math.max(W, H));
          readCanvas.width = Math.round(W * k); readCanvas.height = Math.round(H * k);
          readCanvas.getContext('2d').drawImage(out, 0, 0, readCanvas.width, readCanvas.height);
          read(readCanvas).then(function (found) {
            if (!found) return;
            var next = order(found.map(function (wd) { return { text: wd.text, x: wd.x / k, y: wd.y / k, w: wd.w / k, h: wd.h / k }; }));
            if (next.length) {
              // Keep the head on the nearest word when the new reading arrives.
              var cur = words[i];
              words = next; src = 'read';
              if (cur) { var best = 0, bd = 1e9; words.forEach(function (wd, j) { var d = Math.hypot(wd.x - cur.x, wd.y - cur.y); if (d < bd) { bd = d; best = j; } }); i = best; }
              else { i = 0; hopAt = t; }
            } else if (src === 'read') { words = []; src = 'none'; }
          });
        }
        // No text found: set the typed text on the picture.
        var typed = (params.text || '').trim();
        if (src !== 'read' && typed && Magi.fx.fontReady('Bodoni Moda')) {
          var key = typed + '|' + W + 'x' + H;
          if (key !== typedKey) {
            typedKey = key; src = 'typed'; i = 0; hopAt = t;
            var fs = Math.round(H * 0.09), font = function (px) { return '500 ' + px + 'px "Bodoni Moda", Georgia, serif'; }, lines = [], maxW = W * 0.8;
            ctx.font = font(fs);
            var wordsIn = typed.split(/\s+/), cur2 = '';
            wordsIn.forEach(function (wd) { var tr = cur2 ? cur2 + ' ' + wd : wd; if (ctx.measureText(tr).width > maxW && cur2) { lines.push(cur2); cur2 = wd; } else cur2 = tr; });
            if (cur2) lines.push(cur2);
            while (lines.length * fs * 1.25 > H * 0.8 && fs > 12) fs = Math.round(fs * 0.9);
            ctx.font = font(fs);
            var top = H / 2 - lines.length * fs * 1.25 / 2;
            words = [];
            lines.forEach(function (ln, li) {
              var lw = ctx.measureText(ln).width, x = (W - lw) / 2, y = top + li * fs * 1.25, sp = ctx.measureText(' ').width;
              ln.split(' ').forEach(function (wd) { var ww = ctx.measureText(wd).width; words.push({ text: wd, x: x, y: y + fs * 0.12, w: ww, h: fs, typed: true, fs: fs, font: font(fs) }); x += ww + sp; });
            });
          }
        } else if (src === 'typed' && (!typed || src === 'read')) { words = []; src = 'none'; typedKey = ''; }
        if (src === 'typed') {
          hud.save(); hud.fillStyle = '#111'; hud.textBaseline = 'top';
          words.forEach(function (wd) { hud.font = wd.font; hud.fillText(wd.text, wd.x, wd.y - wd.h * 0.12); });
          hud.restore();
        }

        if (!words.length) {
          frame.say(ocr.status === 'loading' ? 'Loading the text reader (about 3 MB, first time only)…' : ocr.status === 'failed' ? 'The text reader couldn’t load. Type some text in Advanced to scan it.' : 'No text found. Point the camera at text, upload a photo of some, or type text to scan.');
          return;
        }

        // Pointing: jump to the word nearest the fingertip.
        var hands = Magi.interaction.read(frame).hands, pointer = hands.filter(function (h) { return h.fingers.index.extended && !h.fingers.middle.extended && !h.fingers.ring.extended && !h.pinched; })[0];
        if (pointer) {
          var tp = pointer.points[8], best2 = i, bd2 = 1e9;
          words.forEach(function (wd, j) { var d = Math.hypot(wd.x + wd.w / 2 - tp.x, wd.y + wd.h / 2 - tp.y); if (d < bd2) { bd2 = d; best2 = j; } });
          if (best2 !== i) { from = box(words[i]); i = best2; hopAt = t; }
        }

        // Advance.
        var hop = 0.6 - params.speed / 100 * 0.53;
        if (i >= words.length) i = 0;
        if (t >= pausedTill && t - hopAt > hop) {
          from = box(words[i]); hopAt = t;
          if (i + 1 >= words.length) { pausedTill = t + 0.8; i = 0; from = null; } else i++;
        }
        function box(wd) { var m = wd.h * (params.margin / 100) * 0.6; return { x: wd.x - m, y: wd.y - m, w: wd.w + 2 * m, h: wd.h + 2 * m }; }

        // Draw: visited boxes, the path, the head, the tags.
        var tint = params.color ? Magi.fx.inkColor(params.color).map(function (v) { return Math.round(v * 255); }) : [150, 205, 205];
        ctx.save();
        ctx.lineWidth = Math.max(1, 0.8 * u);
        for (var j = 0; j < i; j++) {
          var b = box(words[j]);
          ctx.fillStyle = 'rgba(' + tint.join(',') + ',0.42)'; ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = 'rgba(' + tint.map(function (v) { return Math.round(v * 0.6); }).join(',') + ',0.9)'; ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
        if (params.path && i > 0) {
          ctx.strokeStyle = 'rgba(80,80,80,0.75)'; ctx.fillStyle = 'rgba(60,60,60,0.9)';
          ctx.beginPath();
          for (var j2 = 0; j2 <= i; j2++) { var c = box(words[j2]); var cx = c.x + c.w / 2, cy = c.y + c.h / 2; j2 ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); }
          ctx.stroke();
          for (var j3 = 0; j3 < i; j3++) { var c2 = box(words[j3]); ctx.beginPath(); ctx.arc(c2.x + c2.w / 2, c2.y + c2.h / 2, Math.max(1.2, 1.4 * u), 0, Math.PI * 2); ctx.fill(); }
        }
        // The head glides from the last word to this one.
        var to = box(words[i]), k2 = from ? ease((t - hopAt) / Math.max(0.05, hop * 0.6)) : 1, f0 = from || to;
        var hb = { x: f0.x + (to.x - f0.x) * k2, y: f0.y + (to.y - f0.y) * k2, w: f0.w + (to.w - f0.w) * k2, h: f0.h + (to.h - f0.h) * k2 };
        ctx.fillStyle = 'rgba(40,40,40,0.5)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        ctx.strokeStyle = 'rgba(20,20,20,0.95)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
        ctx.restore();
        if (params.labels) {
          hud.save(); hud.textBaseline = 'bottom';
          var fsz = Math.max(7, Math.round(7.5 * u));
          hud.font = '500 ' + fsz + 'px Inter, sans-serif';
          for (var j4 = 0; j4 < i; j4++) { var bb = box(words[j4]); hud.fillStyle = 'rgba(40,40,40,0.85)'; hud.fillText(words[j4].text, bb.x, bb.y - 2 * u); }
          if (k2 >= 1) {
            var tw = hud.measureText(words[i].text).width;
            hud.fillStyle = '#111'; hud.fillRect(hb.x, hb.y - fsz - 4 * u, tw + 6 * u, fsz + 3 * u);
            hud.fillStyle = '#fff'; hud.fillText(words[i].text, hb.x + 3 * u, hb.y - 2 * u);
          }
          hud.restore();
        }
      },
      reset: function () { i = 0; from = null; lastId = null; lastRead = -9; typedKey = ''; if (src === 'typed') { words = []; src = 'none'; } }
    };
  }

  Magi.renderers.scanner = createScanner;
})();
