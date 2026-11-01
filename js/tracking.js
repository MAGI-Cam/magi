// Hand and face tracking for effects, using Google's MediaPipe Tasks (Hand Landmarker: 21 points
// per hand; Face Landmarker: 478 points per face). Nothing loads until an effect first asks, so
// effects that don't track cost nothing. Landmarks come back in frame pixels, mirrored to match
// the preview.
(function () {
  var VERSION = '0.10.14';
  var BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VERSION;
  var MODELS = {
    hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  };

  var vision = null;
  function loadVision() {
    if (!vision) {
      vision = import(BASE + '/vision_bundle.mjs').then(function (m) {
        return m.FilesetResolver.forVisionTasks(BASE + '/wasm').then(function (files) {
          return { m: m, files: files };
        });
      });
    }
    return vision;
  }

  function createTracker(kind) {
    var status = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
    var task = null, lastTs = 0, last = [];

    function create(v, delegate) {
      var options = {
        baseOptions: { modelAssetPath: MODELS[kind], delegate: delegate },
        runningMode: 'VIDEO'
      };
      if (kind === 'hands') {
        options.numHands = 2;
        return v.m.HandLandmarker.createFromOptions(v.files, options);
      }
      options.numFaces = 1;
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

    return {
      status: function () { return status; },
      // Returns an array (one entry per hand or face) of landmark arrays: { x, y, z } in frame
      // pixels. Returns the last result while loading or if a frame can't be read.
      detect: function (frame) {
        if (status === 'idle') load();
        if (!task) return last;
        var ts = Math.max(frame.time, lastTs + 1); // timestamps must strictly increase
        lastTs = ts;
        var res;
        try {
          res = task.detectForVideo(frame.source, ts);
        } catch (e) {
          return last;
        }
        var sets = (kind === 'hands' ? res.landmarks : res.faceLandmarks) || [];
        last = sets.map(function (points) {
          return points.map(function (p) {
            return { x: (frame.mirror ? 1 - p.x : p.x) * frame.width, y: p.y * frame.height, z: p.z };
          });
        });
        return last;
      }
    };
  }

  Magi.tracking = { hands: createTracker('hands'), face: createTracker('face') };

  // A quiet status line drawn on the frame while a tracker loads or after it fails, so the
  // effect never looks broken without saying why.
  Magi.tracking.drawStatus = function (ctx, frame, tracker, what) {
    var s = tracker.status();
    var text = s === 'loading' || s === 'idle' ? 'Loading ' + what + ' tracking…'
      : s === 'failed' ? what.charAt(0).toUpperCase() + what.slice(1) + ' tracking couldn’t load. Check your connection.'
      : null;
    if (!text) return;
    var size = Math.round(13 * frame.pxPerCss);
    ctx.save();
    ctx.font = '400 ' + size + 'px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    var w = ctx.measureText(text).width + size * 1.6;
    ctx.fillRect(frame.width / 2 - w / 2, frame.height - size * 3.4, w, size * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, frame.width / 2, frame.height - size * 1.85);
    ctx.restore();
  };

  // A one-line instruction when tracking is ready but nobody is in view.
  Magi.tracking.hint = function (ctx, frame, text) {
    var size = Math.round(13 * frame.pxPerCss);
    ctx.save();
    ctx.font = '400 ' + size + 'px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, frame.width / 2, frame.height - size * 1.8);
    ctx.restore();
  };
})();
