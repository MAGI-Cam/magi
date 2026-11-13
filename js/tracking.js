// Hand, face, body and object tracking for effects, using Google's MediaPipe Tasks: Hand Landmarker
// (21 points per hand, handedness), Face Landmarker (478 points, 52 blendshape scores, head pose),
// Image Segmenter (a person mask) and Object Detector (boxes for 80 kinds of object).
// These are the same models TouchDesigner's MediaPipe plugin runs. Nothing loads until an effect
// first asks, so effects that don't track cost nothing.
//
// Landmarks come back in frame pixels, mirrored to match the preview, and smoothed with the
// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff rises with
// speed, so points hold still when you do and still follow fast moves without lag. Depth (z) is
// smoothed the same way.
//
// Detection runs once per camera frame, not once per screen refresh (a 120 Hz screen would
// otherwise analyze each 30 fps camera frame four times); later calls in the same camera frame
// get the cached result. Hands are followed by position from frame to frame, so a hand keeps its
// identity and its filters even when MediaPipe's left/right label flickers; the label itself is
// a running vote. A hand that drops out is held for 200 ms before it disappears.
(function () {
  var VERSION = '0.10.14';
  var BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VERSION;
  var MODELS = {
    hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    body: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    objects: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'
  };
  // One Euro settings, in frame pixels: steady at rest (1.5 Hz cutoff), opening up by 0.05 Hz per
  // pixel/second of speed, with the speed itself filtered at 4 Hz so the filter opens within a few
  // frames of a hand starting to move. Simulated at 30 fps with 1.5 px of landmark noise: worst
  // lag behind a hand starting at 1000–2000 px/s is about 7 px (it was 17–24 px with β 0.02 and a
  // 1 Hz speed filter), at the cost of 0.8 px of jitter at rest instead of 0.6 px.
  var MIN_CUTOFF = 1.5, BETA = 0.05, D_CUTOFF = 4;
  var HOLD_MS = 200;

  // An id for the picture currently in `el`: it changes exactly when a new camera or video frame
  // is shown. Uses requestVideoFrameCallback where the browser has it, else the video's time.
  var frameCounters = new WeakMap();
  function frameId(el) {
    if (!el || el.tagName !== 'VIDEO') return el ? 'img:' + (el.currentSrc || el.src) : '';
    var c = frameCounters.get(el);
    if (!c) {
      c = { n: 0, rvfc: typeof el.requestVideoFrameCallback === 'function' };
      frameCounters.set(el, c);
      if (c.rvfc) {
        var onFrame = function (now, meta) { c.n = (meta && meta.presentedFrames) || c.n + 1; el.requestVideoFrameCallback(onFrame); };
        el.requestVideoFrameCallback(onFrame);
      }
    }
    return c.rvfc ? 'v' + c.n : 't' + el.currentTime;
  }

  // Magi.tracking.frameId(frame.source): effects that keep frame history use it to act once per
  // new camera or video frame, whether or not tracking has loaded.
  Magi.tracking = { connections: null, frameId: frameId };

  var vision = null;
  function loadVision() {
    if (!vision) {
      vision = import(BASE + '/vision_bundle.mjs').then(function (m) {
        // Connection lists for drawing, straight from MediaPipe.
        Magi.tracking.connections = {
          hand: m.HandLandmarker.HAND_CONNECTIONS,
          tesselation: m.FaceLandmarker.FACE_LANDMARKS_TESSELATION,
          faceOval: m.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
          lips: m.FaceLandmarker.FACE_LANDMARKS_LIPS,
          leftEye: m.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
          rightEye: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
          leftEyebrow: m.FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
          rightEyebrow: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
          leftIris: m.FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
          rightIris: m.FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS
        };
        return m.FilesetResolver.forVisionTasks(BASE + '/wasm').then(function (files) {
          return { m: m, files: files };
        });
      });
    }
    return vision;
  }

  function lowpass(dt, cutoff) {
    var tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  // One Euro filter for one coordinate.
  function OneEuro() { this.x = null; this.dx = 0; }
  OneEuro.prototype.filter = function (x, dt) {
    if (this.x === null) { this.x = x; return x; }
    var dx = (x - this.x) / dt;
    this.dx += lowpass(dt, D_CUTOFF) * (dx - this.dx);
    var cutoff = MIN_CUTOFF + BETA * Math.abs(this.dx);
    this.x += lowpass(dt, cutoff) * (x - this.x);
    return this.x;
  };

  function createTracker(kind) {
    var status = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
    var task = null, lastTs = 0, last = [], details = [], filters = {}, lastKey = null;
    var tracks = [], nextId = 1; // hands: { id, x, y, vote, seen, points, detail }

    function create(v, delegate) {
      var options = {
        baseOptions: { modelAssetPath: MODELS[kind], delegate: delegate },
        runningMode: 'VIDEO'
      };
      if (kind === 'hands') {
        options.numHands = 2;
        options.minHandDetectionConfidence = 0.6;
        options.minTrackingConfidence = 0.6;
        return v.m.HandLandmarker.createFromOptions(v.files, options);
      }
      options.numFaces = 1;
      options.outputFaceBlendshapes = true;
      options.outputFacialTransformationMatrixes = true;
      return v.m.FaceLandmarker.createFromOptions(v.files, options);
    }

    function load() {
      status = 'loading';
      loadVision().then(function (v) {
        // The GPU is much faster; some devices refuse it, so fall back to the CPU.
        return create(v, 'GPU').catch(function () { return create(v, 'CPU'); });
      }).then(function (t) {
        task = t;
        status = 'ready';
      }).catch(function (err) {
        console.warn('Magi: ' + kind + ' tracking could not load', err);
        status = 'failed';
      });
    }

    // Smooths one set of points. `key` keeps each hand's filters with that hand. z is filtered
    // in pixels (z × width, its own scale) and returned in MediaPipe's units.
    function smooth(key, points, dt, frame) {
      var f = filters[key];
      if (!f || f.length !== points.length) {
        f = filters[key] = points.map(function () { return [new OneEuro(), new OneEuro(), new OneEuro()]; });
      }
      return points.map(function (p, i) {
        var x = (frame.mirror ? 1 - p.x : p.x) * frame.width, y = p.y * frame.height;
        return { x: f[i][0].filter(x, dt), y: f[i][1].filter(y, dt), z: f[i][2].filter((p.z || 0) * frame.width, dt) / frame.width };
      });
    }

    // Matches this frame's hands to the hands already followed, by palm position (wrist and
    // middle knuckle): with two of each, whichever pairing moves them less in total.
    function matchHands(hands, labels, frame, dt, now) {
      var found = hands.map(function (points, i) {
        var x = ((frame.mirror ? 1 - points[0].x : points[0].x) + (frame.mirror ? 1 - points[9].x : points[9].x)) / 2 * frame.width;
        var y = (points[0].y + points[9].y) / 2 * frame.height;
        var c = (labels[i] && labels[i][0]) || { categoryName: 'Hand', score: 0 };
        // MediaPipe labels hands as if the image were mirrored; MAGI feeds it the raw camera
        // image, so the labels come back swapped.
        var right = c.categoryName === 'Left' ? 1 : c.categoryName === 'Right' ? -1 : 0;
        return { i: i, x: x, y: y, right: right, score: c.score || 0 };
      });
      var pairs = [], used = {};
      function d(t, h) { return Math.hypot(t.x - h.x, t.y - h.y); }
      if (tracks.length === 2 && found.length === 2) {
        var keep = d(tracks[0], found[0]) + d(tracks[1], found[1]), swap = d(tracks[0], found[1]) + d(tracks[1], found[0]);
        pairs = keep <= swap ? [[tracks[0], found[0]], [tracks[1], found[1]]] : [[tracks[0], found[1]], [tracks[1], found[0]]];
      } else {
        found.forEach(function (h) {
          var best = null;
          tracks.forEach(function (t) { if (!used[t.id] && (!best || d(t, h) < d(best, h))) best = t; });
          if (best && d(best, h) < frame.width * 0.35) { used[best.id] = true; pairs.push([best, h]); }
          else pairs.push([null, h]);
        });
      }
      tracks.forEach(function (t) { t.idx = -1; });
      pairs.forEach(function (pr) {
        var t = pr[0], h = pr[1];
        if (!t) { t = { id: 'hand' + nextId++, vote: 0 }; tracks.push(t); }
        t.x = h.x; t.y = h.y; t.seen = now; t.idx = h.i;
        t.vote += (h.right * h.score - t.vote) * 0.25; // running left/right vote
        t.points = smooth(t.id, hands[h.i], dt, frame);
        t.detail = { label: t.vote >= 0 ? 'Right' : 'Left', score: h.score, key: t.id };
      });
      tracks = tracks.filter(function (t) {
        if (now - t.seen <= HOLD_MS) return true;
        delete filters[t.id];
        return false;
      }).slice(0, 2);
      last = tracks.map(function (t) { return t.points; });
      details = tracks.map(function (t) { return t.detail; });
    }

    return {
      status: function () { return status; },
      // Returns an array (one entry per hand or face) of landmark arrays: { x, y, z } in frame
      // pixels. Returns the last result while loading or if a frame can't be read.
      detect: function (frame) {
        if (status === 'idle') load();
        if (!task) return last;
        // Once per camera frame: the same picture (at the same size) returns the cached result.
        var key = frameId(frame.source) + '|' + frame.width + 'x' + frame.height + (frame.mirror ? 'm' : '');
        if (key === lastKey) return last;
        lastKey = key;
        var ts = Math.max(frame.time, lastTs + 1); // timestamps must strictly increase
        var dt = Math.min(0.1, Math.max(0.001, (ts - lastTs) / 1000));
        lastTs = ts;
        var res;
        try {
          res = task.detectForVideo(frame.source, ts);
        } catch (e) {
          return last;
        }
        if (kind === 'hands') {
          matchHands(res.landmarks || [], res.handedness || res.handednesses || [], frame, dt, ts);
          // Metric 3D points (meters, centered on the hand), mirrored like the preview. Angles
          // between bones measured on these don't change with distance from the camera.
          var world = res.worldLandmarks || [];
          tracks.forEach(function (t) {
            var w = t.idx >= 0 && world[t.idx];
            if (w) t.detail.world = w.map(function (q) { return { x: frame.mirror ? -q.x : q.x, y: q.y, z: q.z }; });
          });
        } else {
          var seen = {};
          var faces = res.faceLandmarks || [];
          last = faces.map(function (points, i) { seen['face' + i] = true; return smooth('face' + i, points, dt, frame); });
          details = faces.map(function (points, i) {
            var shapes = res.faceBlendshapes && res.faceBlendshapes[i] ? res.faceBlendshapes[i].categories : [];
            var matrix = res.facialTransformationMatrixes && res.facialTransformationMatrixes[i];
            return { blendshapes: shapes, matrix: matrix ? matrix.data : null };
          });
          Object.keys(filters).forEach(function (k) { if (!seen[k]) delete filters[k]; });
        }
        return last;
      },
      // The hands extrapolated to now: each point plus its filtered velocity (the One Euro
      // filter's speed estimate, px/s) × (time since the detection + lead), at most 0.1 s ahead.
      // For drawing that should keep up with fast moves. Hands only; same order as detect().
      predicted: function (frame, lead) {
        if (kind !== 'hands') return last;
        var ahead = Math.max(0, Math.min(0.1, (frame.time - lastTs) / 1000 + (lead || 0)));
        return tracks.map(function (t) {
          var f = filters[t.id];
          return t.points.map(function (q, i) {
            if (!f || !f[i]) return q;
            return { x: q.x + f[i][0].dx * ahead, y: q.y + f[i][1].dx * ahead, z: q.z };
          });
        });
      },
      // Extra results for the latest detection, parallel to detect()'s array:
      // hands: { label: 'Left' | 'Right', score, key (stable per hand), world (metric points) };
      // face: { blendshapes: [{ categoryName, score }], matrix: 4×4 column-major head transform }.
      details: function () { return details; }
    };
  }

  // Body: MediaPipe Image Segmenter with the selfie segmenter model, a per-pixel probability that
  // the pixel belongs to a person. It runs on a copy of the frame at most 256 px across (the model's
  // own input is 256×256), drawn mirrored like the preview, so the mask lines up with the frame.
  // Masks are eased over time (x ← x + 0.6·(new − x)) so the outline doesn't flicker.
  function createSegmenter() {
    var status = 'idle', task = null, lastTs = 0;
    var small = document.createElement('canvas'), sctx = small.getContext('2d');
    var result = null;

    function load() {
      status = 'loading';
      loadVision().then(function (v) {
        function create(delegate) {
          return v.m.ImageSegmenter.createFromOptions(v.files, {
            baseOptions: { modelAssetPath: MODELS.body, delegate: delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false
          });
        }
        return create('GPU').catch(function () { return create('CPU'); });
      }).then(function (t) {
        task = t;
        status = 'ready';
      }).catch(function (err) {
        console.warn('Magi: body tracking could not load', err);
        status = 'failed';
      });
    }

    return {
      status: function () { return status; },
      // Returns { mask: Float32Array (0…1, row by row), width, height }, or null before the
      // first result. The mask covers the whole frame at reduced size.
      detect: function (frame) {
        if (status === 'idle') load();
        if (!task) return result;
        var s = Math.min(1, 256 / Math.max(frame.width, frame.height));
        var w = Math.max(1, Math.round(frame.width * s)), h = Math.max(1, Math.round(frame.height * s));
        if (small.width !== w || small.height !== h) { small.width = w; small.height = h; result = null; }
        frame.draw(sctx, w, h);
        var ts = Math.max(frame.time, lastTs + 1);
        lastTs = ts;
        try {
          task.segmentForVideo(small, ts, function (res) {
            var masks = res.confidenceMasks || [];
            if (!masks.length) return;
            // The person is the last category (the only one for this model).
            var m = masks[masks.length - 1].getAsFloat32Array();
            if (!result || result.mask.length !== m.length) { result = { mask: new Float32Array(m), width: w, height: h }; return; }
            var r = result.mask;
            for (var i = 0; i < m.length; i++) r[i] += (m[i] - r[i]) * 0.6;
          });
        } catch (e) {
          return result;
        }
        return result;
      }
    };
  }

  // Objects: MediaPipe's Object Detector (EfficientDet-Lite0, the 80 COCO classes) on a copy of
  // the frame at most 320 px across, mirrored like the preview, about 10 times a second (it is
  // heavier than the landmarkers). Detections are followed between runs: each is matched to the
  // track it overlaps most (intersection over union ≥ 0.3), so an object keeps its id; a track's
  // box eases toward each new detection (half-life about 0.1 s) and is dropped after 0.5 s unseen.
  // detect(frame) → [{ id, x, y, w, h, label, score }] in frame pixels.
  function createObjects() {
    var status = 'idle', task = null, lastTs = 0, lastRun = -1e9, tracks = [], nextId = 1, lastT = null;
    var small = document.createElement('canvas'), sctx = small.getContext('2d');
    function load() {
      status = 'loading';
      loadVision().then(function (v) {
        function create(delegate) {
          return v.m.ObjectDetector.createFromOptions(v.files, {
            baseOptions: { modelAssetPath: MODELS.objects, delegate: delegate },
            runningMode: 'VIDEO', scoreThreshold: 0.35, maxResults: 8
          });
        }
        return create('GPU').catch(function () { return create('CPU'); });
      }).then(function (t) { task = t; status = 'ready'; })
        .catch(function (err) { console.warn('Magi: object tracking could not load', err); status = 'failed'; });
    }
    function iou(a, b) {
      var x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
      var i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      return i / Math.max(1e-6, a.w * a.h + b.w * b.h - i);
    }
    return {
      status: function () { return status; },
      detect: function (frame) {
        if (status === 'idle') load();
        var now = frame.time, dt = lastT === null ? 1 / 60 : Math.max(0, Math.min(0.2, (now - lastT) / 1000));
        lastT = now;
        if (task && now - lastRun >= 100) {
          lastRun = now;
          var k = Math.min(1, 320 / Math.max(frame.width, frame.height));
          var w = Math.max(1, Math.round(frame.width * k)), h = Math.max(1, Math.round(frame.height * k));
          if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
          frame.draw(sctx, w, h);
          var ts = Math.max(now, lastTs + 1); lastTs = ts;
          var res = null;
          try { res = task.detectForVideo(small, ts); } catch (e) { res = null; }
          if (res) {
            var found = (res.detections || []).map(function (d) {
              var b = d.boundingBox, c = (d.categories || [])[0] || {};
              return { x: b.originX / k, y: b.originY / k, w: b.width / k, h: b.height / k, label: c.categoryName || c.displayName || 'object', score: c.score || 0 };
            });
            var used = {};
            found.forEach(function (f) {
              var best = null, bi = 0.3;
              tracks.forEach(function (t) { if (!used[t.id] && t.label === f.label) { var v = iou(t, f); if (v > bi) { bi = v; best = t; } } });
              if (!best) { best = { id: nextId++, x: f.x, y: f.y, w: f.w, h: f.h, label: f.label }; tracks.push(best); }
              used[best.id] = true; best.target = f; best.score = f.score; best.seen = now;
            });
            tracks = tracks.filter(function (t) { return now - t.seen < 500; });
          }
        }
        var e = 1 - Math.pow(0.5, dt / 0.1);
        tracks.forEach(function (t) { var f = t.target; if (!f) return; t.x += (f.x - t.x) * e; t.y += (f.y - t.y) * e; t.w += (f.w - t.w) * e; t.h += (f.h - t.h) * e; });
        return tracks.map(function (t) { return { id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, label: t.label, score: t.score }; });
      }
    };
  }

  Magi.tracking.hands = createTracker('hands');
  Magi.tracking.face = createTracker('face');
  Magi.tracking.body = createSegmenter();
  Magi.tracking.objects = createObjects();

  // A quiet status line while a tracker loads or after it fails, so the effect never looks broken
  // without saying why. Shown as text over the preview through frame.say.
  Magi.tracking.drawStatus = function (ctx, frame, tracker, what) {
    var s = tracker.status();
    if (s === 'loading' || s === 'idle') frame.say('Loading ' + what + ' tracking…');
    else if (s === 'failed') frame.say(what.charAt(0).toUpperCase() + what.slice(1) + ' tracking couldn’t load. Check your connection.');
  };

  // A one-line instruction when tracking is ready but nobody is in view.
  Magi.tracking.hint = function (ctx, frame, text) {
    frame.say(text);
  };
})();
