// Magi camera interface: input (camera or upload), effect selection, capture, review and save.
// Effects plug in through Magi.effectConfig and Magi.renderers; nothing here is effect-specific.
(function () {
  'use strict';

  // Long edge of the processed frame. Keeps pixel counts consistent across sources.
  var WORK_EDGE = 1280;

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), stage = $('stage'), view = $('view'), reviewVideo = $('review-video');
  var notice = $('notice'), noticeText = $('notice-text'), noticeActions = $('notice-actions');
  var shutter = $('shutter'), saveBtn = $('save'), timer = $('timer');
  var caret = $('caret'), tray = $('tray'), tiles = $('tiles'), controls = $('controls'), hint = $('hint'), search = $('search');
  var uploadBtn = $('upload'), cameraBtn = $('camera'), fileInput = $('file');
  var camsBtn = $('cams'), camMenu = $('cam-menu'), micBtn = $('mic');
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mode-option]'));
  var ctx = view.getContext('2d');

  var camera = document.createElement('video');
  camera.muted = true;
  camera.playsInline = true;
  camera.setAttribute('playsinline', '');

  var state = {
    input: 'camera',   // 'camera' | 'upload'
    mode: 'photo',     // 'photo' | 'video'
    phase: 'live',     // 'live' | 'recording' | 'review'
    effectId: 'bitmap',
    trayOpen: false,
    params: {}
  };
  Magi.effectConfig.forEach(function (fx) { state.params[fx.id] = Magi.defaultsFor(fx); });

  var stream = null;        // camera MediaStream
  var upload = null;        // { kind: 'image' | 'video', el, url }
  var recorder = null;
  var result = null;        // Promise<{ blob, ext }> for the captured photo or video
  var renderers = {};
  var dirty = true;         // a still image only re-renders when something changed
  var recordStart = 0, timerId = 0;
  // Camera choice: a remembered deviceId (from the camera menu), or a facing direction (phones).
  var camId = load('magi.camera'), facing = 'user', camMirror = true, cams = [], knownCams = null;
  var micOn = false, micStream = null;

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var preferShare = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  /* ---------- Sources ---------- */

  function currentSource() {
    if (state.input === 'camera') {
      if (!stream || camera.readyState < 2) return null;
      return { el: camera, w: camera.videoWidth, h: camera.videoHeight, moving: true, mirror: camMirror };
    }
    if (!upload) return null;
    if (upload.kind === 'image') {
      return { el: upload.el, w: upload.el.naturalWidth, h: upload.el.naturalHeight, moving: false, mirror: false };
    }
    if (upload.el.readyState < 2) return null;
    return { el: upload.el, w: upload.el.videoWidth, h: upload.el.videoHeight, moving: true, mirror: false };
  }

  function startCamera() {
    stopUpload();
    state.input = 'camera';
    syncSourceButtons();
    resetRenderers();
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showNotice('unsupported');
      return;
    }
    showNotice('asking');
    var size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    var video = camId ? Object.assign({ deviceId: { exact: camId } }, size) : Object.assign({ facingMode: facing }, size);
    navigator.mediaDevices.getUserMedia({ video: video, audio: false }).then(function (s) {
      if (state.input !== 'camera') { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      camera.srcObject = s;
      // A camera facing away from you isn't mirrored; front and USB cameras are.
      var set = s.getVideoTracks()[0] && s.getVideoTracks()[0].getSettings ? s.getVideoTracks()[0].getSettings() : {};
      camMirror = set.facingMode !== 'environment';
      refreshCams();
      return camera.play().then(function () { hideNotice(); dirty = true; });
    }).catch(function (err) {
      if (state.input !== 'camera') return;
      // A remembered camera that's gone: forget it and open the default one.
      if (camId && err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError' || err.name === 'NotReadableError')) {
        camId = null; store('magi.camera', null); startCamera(); return;
      }
      stopCamera();
      var blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      showNotice(blocked ? 'denied' : 'unavailable');
    });
  }

  function stopCamera() {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    camera.srcObject = null;
  }

  function openFile(file) {
    var url = URL.createObjectURL(file);
    var isVideo = /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
    var el;

    function ready() {
      stopUpload();
      stopCamera();
      upload = { kind: isVideo ? 'video' : 'image', el: el, url: url };
      state.input = 'upload';
      hideNotice();
      resetRenderers();
      syncSourceButtons();
    }
    function fail() {
      URL.revokeObjectURL(url);
      showNotice('badfile');
    }

    if (isVideo) {
      el = document.createElement('video');
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.onloadeddata = function () { el.onloadeddata = null; ready(); };
      el.onerror = fail;
      el.src = url;
      el.play().catch(function () {});
    } else {
      el = new Image();
      el.onload = ready;
      el.onerror = fail;
      el.src = url;
    }
  }

  function stopUpload() {
    if (!upload) return;
    if (upload.kind === 'video') upload.el.pause();
    URL.revokeObjectURL(upload.url);
    upload = null;
  }

  function syncSourceButtons() {
    uploadBtn.hidden = state.input !== 'camera';
    cameraBtn.hidden = state.input === 'camera';
    camsBtn.hidden = state.input !== 'camera' || cams.length < 2;
    micBtn.hidden = state.input !== 'camera' || state.mode !== 'video' || !window.MediaRecorder;
    if (camsBtn.hidden) closeCamMenu();
  }

  /* ---------- Camera choice and microphone ---------- */

  // Cameras by name (labels appear once camera permission is granted). A camera that appears while
  // MAGI is open (plugged in) is switched to; if the one in use disappears, the default returns.
  function refreshCams() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      cams = list.filter(function (d) { return d.kind === 'videoinput'; });
      var ids = cams.map(function (d) { return d.deviceId; });
      var added = knownCams ? ids.filter(function (id) { return id && knownCams.indexOf(id) < 0; }) : [];
      var lost = camId && ids.indexOf(camId) < 0 && ids.some(Boolean);
      knownCams = ids;
      syncSourceButtons();
      if (state.input !== 'camera' || state.phase === 'recording') return;
      if (added.length) switchCam(added[added.length - 1]);
      else if (lost) { camId = null; store('magi.camera', null); stopCamera(); startCamera(); }
    }).catch(function () {});
  }

  function switchCam(id) {
    camId = id;
    store('magi.camera', id);
    stopCamera();
    startCamera();
  }

  function activeCamId() {
    var t = stream && stream.getVideoTracks()[0];
    return t && t.getSettings ? t.getSettings().deviceId : camId;
  }

  function openCamMenu() {
    camMenu.textContent = '';
    var current = activeCamId();
    cams.forEach(function (d, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(d.deviceId === current));
      b.textContent = d.label || 'Camera ' + (i + 1);
      b.addEventListener('click', function () { closeCamMenu(); if (d.deviceId !== current) switchCam(d.deviceId); });
      camMenu.appendChild(b);
    });
    camMenu.hidden = false;
    camsBtn.setAttribute('aria-expanded', 'true');
  }

  function closeCamMenu() {
    camMenu.hidden = true;
    camsBtn.setAttribute('aria-expanded', 'false');
  }

  // Microphone: off by default; permission is asked the first time it's turned on.
  function setMic(on) {
    if (!on) {
      micOn = false;
      if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
      micBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (s) {
      micStream = s; micOn = true;
      micBtn.setAttribute('aria-pressed', 'true');
    }).catch(function () { setMic(false); });
  }

  /* ---------- Rendering ---------- */

  function activeRenderer() {
    var id = state.effectId;
    if (!id || !Magi.renderers[id]) return null;
    if (!renderers[id]) renderers[id] = Magi.renderers[id]();
    return renderers[id];
  }

  function resetRenderers() {
    Object.keys(renderers).forEach(function (id) { renderers[id].reset(); });
    dirty = true;
  }

  var shownW = 0, shownH = 0, hudShown = false;
  var hud = document.getElementById('hud'), hctx = hud.getContext('2d');

  function tick() {
    requestAnimationFrame(tick);
    if (state.phase === 'review') return;
    var src = currentSource();
    if (!src || !src.w || !src.h) return;
    var renderer = activeRenderer();
    // Still images only re-render on change, unless the effect animates on its own.
    if (!src.moving && !dirty && !(renderer && renderer.animated)) return;
    dirty = false;

    var k = WORK_EDGE / Math.max(src.w, src.h);
    var w = Math.round(src.w * k), h = Math.round(src.h * k);
    var r = stageSize();
    var frame = {
      width: w,
      height: h,
      moving: src.moving,
      // Canvas pixels per screen (CSS) pixel once the frame is fitted to the stage. Effects
      // that should look the same size on any screen, like characters, multiply by this.
      pxPerCss: r.width && r.height ? 1 / Math.min(r.width / w, r.height / h) : 1,
      // For effects that track hands or faces: the raw element, whether the preview is
      // mirrored, and a clock in milliseconds.
      source: src.el,
      mirror: src.mirror,
      time: performance.now(),
      // A one-line instruction or status for the viewer, shown as text over the preview (sharp at
      // any size, and never part of a saved photo). Only lasts for the frame that says it.
      say: function (text) { said = text; },
      // A gesture changing one of the effect's own parameters: the value is stored like a slider
      // move (rounded to the slider's step) and the control shows it.
      setParam: function (id, value) { setParam(state.effectId, id, value); },
      draw: function (c, dw, dh) {
        c.save();
        if (src.mirror) { c.translate(dw, 0); c.scale(-1, 1); }
        c.drawImage(src.el, 0, 0, dw, dh);
        c.restore();
      }
    };

    // frame.hud: a canvas over the preview at the screen's resolution, for text. Effects draw on it
    // in frame coordinates, like on the picture; it's prepared only when an effect asks for it,
    // then copied into the picture so photos and videos include the text.
    var hudUsed = false;
    Object.defineProperty(frame, 'hud', { get: function () {
      if (!hudUsed) {
        hudUsed = true;
        var dpr = window.devicePixelRatio || 1;
        var hw = Math.max(1, Math.round(parseFloat(view.style.width || w) * dpr)), hh = Math.max(1, Math.round(parseFloat(view.style.height || h) * dpr));
        if (hud.width !== hw || hud.height !== hh) { hud.width = hw; hud.height = hh; }
        hctx.setTransform(1, 0, 0, 1, 0, 0);
        hctx.clearRect(0, 0, hw, hh);
        // In the picture's coordinates (the effect may size its picture differently from the frame,
        // as Media effects do for a post format).
        hctx.setTransform(hw / (view.width || w), 0, 0, hh / (view.height || h), 0, 0);
      }
      return hctx;
    } });

    var said = null;
    if (renderer) {
      renderer.render(frame, view, state.params[state.effectId]);
    } else {
      if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
      frame.draw(ctx, w, h);
    }
    if (hudUsed) {
      ctx.drawImage(hud, 0, 0, view.width, view.height);
      hudShown = true;
    } else if (hudShown) {
      hctx.setTransform(1, 0, 0, 1, 0, 0);
      hctx.clearRect(0, 0, hud.width, hud.height);
      hudShown = false;
    }

    if (said !== hint.textContent) hint.textContent = said || '';
    hint.hidden = !said;

    if (view.width !== shownW || view.height !== shownH) {
      shownW = view.width;
      shownH = view.height;
      fitView();
    }
  }

  var stageRect = null;
  function stageSize() {
    return stageRect || (stageRect = stage.getBoundingClientRect());
  }

  // Contain the canvas in the stage without distortion.
  function fitView() {
    stageRect = null;
    dirty = true;
    if (!view.width || !view.height) return;
    var r = stageSize();
    var s = Math.min(r.width / view.width, r.height / view.height);
    view.style.width = Math.floor(view.width * s) + 'px';
    view.style.height = Math.floor(view.height * s) + 'px';
    hud.style.width = view.style.width;
    hud.style.height = view.style.height;
    hud.style.left = (r.width - Math.floor(view.width * s)) / 2 + 'px';
    hud.style.top = (r.height - Math.floor(view.height * s)) / 2 + 'px';
    // Nearest-pixel scaling keeps pixels square when enlarging, but when shrinking it drops whole
    // rows and columns (thin strokes vanish), so shrink smoothly instead.
    view.classList.toggle('is-reduced', s * (window.devicePixelRatio || 1) < 1);
  }

  /* ---------- Notices ---------- */

  var NOTICES = {
    asking: {
      text: 'Allow camera access to see the live preview.',
      actions: ['upload']
    },
    denied: {
      text: 'Camera access is blocked. Allow it in your browser’s site settings, then try again, or upload a photo or video instead.',
      actions: ['retry', 'upload']
    },
    unavailable: {
      text: 'No camera could be started. Check that one is connected and not in use by another app.',
      actions: ['retry', 'upload']
    },
    unsupported: {
      text: 'This browser can’t open the camera on this page. Open Magi over https or localhost, or upload a photo or video.',
      actions: ['upload']
    },
    badfile: {
      text: 'That file couldn’t be opened. Try a JPEG, PNG, WebP, MP4, MOV or WebM file.',
      actions: ['upload', 'retry']
    }
  };

  var ACTIONS = {
    retry: { label: 'Try camera again', run: function () { stopCamera(); startCamera(); } },
    upload: { label: 'Upload photo or video', run: function () { fileInput.click(); } }
  };

  function showNotice(key) {
    var n = NOTICES[key];
    noticeText.textContent = n.text;
    noticeActions.textContent = '';
    n.actions.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'text-btn' + (i === 0 ? ' primary' : '');
      b.textContent = ACTIONS[a].label;
      b.addEventListener('click', ACTIONS[a].run);
      noticeActions.appendChild(b);
    });
    notice.hidden = false;
    view.hidden = true;
  }

  function hideNotice() {
    notice.hidden = true;
    view.hidden = false;
    fitView();
  }

  /* ---------- Effects tray ---------- */

  function setTray(open) {
    state.trayOpen = open;
    tray.dataset.open = String(open);
    caret.setAttribute('aria-expanded', String(open));
    caret.setAttribute('aria-label', open ? 'Hide effects' : 'Show effects');
    // Reopen where you left it: the last level of the tray you were looking at.
    if (open) { if (search.value.trim()) showSearch(search.value); else showLevel(level); }
  }

  function groupById(id) {
    for (var i = 0; i < Magi.effectGroups.length; i++) {
      if (Magi.effectGroups[i].id === id) return Magi.effectGroups[i];
    }
    return null;
  }

  // True when the effect sits in the group, directly or inside one of its subgroups.
  function inGroup(fx, groupId) {
    var g = fx && fx.group ? groupById(fx.group) : null;
    while (g) {
      if (g.id === groupId) return true;
      g = g.parent ? groupById(g.parent) : null;
    }
    return false;
  }

  // The tray shows one level at a time: the top (Normal and the parent tiles) or one group's
  // effects and subgroups, with a back row. `level` is the group id, or null for the top.
  var level = null;

  function showLevel(groupId) {
    level = groupId;
    tiles.textContent = '';
    var group = groupById(groupId);
    if (group) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'tray-back';
      var parent = groupById(group.parent);
      back.innerHTML = '<span aria-hidden="true">‹</span><span class="tray-path"></span>';
      back.lastChild.textContent = (parent ? parent.name + ' / ' : '') + group.name;
      back.setAttribute('aria-label', 'Back to ' + (parent ? parent.name : 'all effects'));
      back.addEventListener('click', function () {
        showLevel(group.parent || null);
        tiles.querySelector('button').focus();
      });
      tiles.appendChild(back);
    }
    Magi.effectConfig.forEach(function (fx) { if ((fx.group || null) === groupId) addTile(fx); });
    Magi.effectGroups.forEach(function (g) { if ((g.parent || null) === groupId) addGroupTile(g); });
    syncTiles();
  }

  // Search: every effect whose name, modes or group path contains the words typed (all of them, in
  // any order), and every group whose name does, in tray order; clearing it returns to the level.
  function showSearch(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { showLevel(level); return; }
    tiles.textContent = '';
    var path = function (gid) { var g = groupById(gid), out = []; while (g) { out.unshift(g.name); g = groupById(g.parent); } return out.join(' '); };
    var hit = function (text) { text = text.toLowerCase(); return words.every(function (w) { return text.indexOf(w) >= 0; }); };
    var n = 0;
    Magi.effectConfig.forEach(function (fx) {
      var text = fx.name + ' ' + (fx.modes || []).map(function (m) { return m.name; }).join(' ') + ' ' + path(fx.group);
      if (hit(text)) { addTile(fx); n++; }
    });
    Magi.effectGroups.forEach(function (g) { if (hit(g.name)) { addGroupTile(g); n++; } });
    if (!n) { var none = document.createElement('p'); none.className = 'tray-empty'; none.textContent = 'No effects match “' + q.trim() + '”.'; tiles.appendChild(none); }
    syncTiles();
  }
  search.addEventListener('input', function () { showSearch(search.value); });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !search.value) return; // an empty search: Escape closes the tray as usual
    e.stopPropagation(); // typing here never triggers the app's shortcuts
    if (e.key === 'Escape') { e.preventDefault(); search.value = ''; showLevel(level); }
  });

  function addGroupTile(group) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile tile-parent';
    b.dataset.group = group.id;
    b.innerHTML = '<span></span><span class="tile-mode"></span>';
    b.firstChild.textContent = group.name;
    b.addEventListener('click', function () {
      search.value = '';
      showLevel(group.id);
      tiles.querySelector('.tile').focus();
    });
    tiles.appendChild(b);
  }

  function addTile(fx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.effect = fx.id;
    b.setAttribute('role', 'radio');
    var name = document.createElement('span');
    name.textContent = fx.name;
    b.appendChild(name);
    if (fx.modes) {
      var mode = document.createElement('span');
      mode.className = 'tile-mode';
      b.appendChild(mode);
    }
    if (!fx.ready) {
      b.disabled = true;
      b.title = 'Coming later';
    }
    // Tapping the active tile steps through its modes, if it has any.
    b.addEventListener('click', function () {
      if (state.effectId !== fx.id) selectEffect(fx.id);
      else if (fx.modes) nextMode(fx);
    });
    tiles.appendChild(b);
  }

  function modeOf(fx) {
    var id = state.params[fx.id].mode;
    for (var i = 0; i < fx.modes.length; i++) if (fx.modes[i].id === id) return i;
    return 0;
  }

  function nextMode(fx) {
    state.params[fx.id].mode = fx.modes[(modeOf(fx) + 1) % fx.modes.length].id;
    resetRenderers();
    syncTiles();
    buildControls(); // some parameters belong to one mode only
  }

  // Marks the active effect, shows each effect's current mode, and on parent tiles names the
  // active effect inside them.
  function syncTiles() {
    var active = currentEffect();
    Array.prototype.forEach.call(tiles.querySelectorAll('.tile'), function (tile) {
      if (tile.dataset.group) {
        var holds = inGroup(active, tile.dataset.group);
        tile.classList.toggle('is-current', holds);
        tile.querySelector('.tile-mode').textContent = holds ? active.name : '';
        return;
      }
      var fx = effectById(tile.dataset.effect);
      tile.setAttribute('aria-checked', String(fx === active));
      if (!fx.modes) return;
      var mode = fx.modes[modeOf(fx)];
      tile.querySelector('.tile-mode').textContent = mode.name;
      tile.setAttribute('aria-label', fx.name + ', ' + mode.name + ' mode');
      tile.title = fx === active ? 'Tap to change mode' : '';
    });
  }

  function effectById(id) {
    for (var i = 0; i < Magi.effectConfig.length; i++) {
      if (Magi.effectConfig[i].id === id) return Magi.effectConfig[i];
    }
    return null;
  }

  function currentEffect() {
    return effectById(state.effectId);
  }

  function selectEffect(id) {
    state.effectId = id;
    hint.hidden = true;
    syncUploadMode();
    resetRenderers();
    syncTiles();
    buildControls();
  }

  // Shows a slider's value: a number, or for the color slider a swatch of the chosen ink.
  function showValue(p, input, out) {
    if (p.track !== 'hue') {
      out.textContent = input.value;
      return;
    }
    var rgb = Magi.fx.inkColor(Number(input.value));
    out.style.setProperty('--swatch', 'rgb(' + rgb.map(function (c) { return Math.round(c * 255); }).join(',') + ')');
    var text = Number(input.value) === 0 ? 'White' : 'Hue ' + Math.round((input.value - 1) / 99 * 360) + '°';
    input.setAttribute('aria-valuetext', text);
  }

  function setFill(input) {
    var pct = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  function buildControls() {
    controls.textContent = '';
    var fx = currentEffect();
    if (!fx || !fx.params.length) { controls.hidden = true; return; }
    controls.hidden = false;

    var head = document.createElement('div');
    head.className = 'controls-head';
    head.innerHTML = '<span></span><button class="icon-btn" type="button" aria-label="Reset to defaults">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12a6.5 6.5 0 1 0 2-4.7"/><path d="M5 4v4h4"/></svg></button>';
    head.firstChild.textContent = fx.name;
    head.lastChild.addEventListener('click', function () {
      var mode = state.params[fx.id].mode;
      state.params[fx.id] = Magi.defaultsFor(fx);
      if (mode) state.params[fx.id].mode = mode; // reset adjusts sliders, not the chosen mode
      resetRenderers();
      buildControls();
    });
    controls.appendChild(head);

    var mode = fx.modes ? fx.modes[modeOf(fx)].id : null;
    fx.params.forEach(function (p) {
      if (p.modes && p.modes.indexOf(mode) < 0) return;
      if (p.type === 'toggle') return controls.appendChild(toggleControl(fx, p));
      if (p.type === 'text') return controls.appendChild(textControl(fx, p));
      var id = 'param-' + fx.id + '-' + p.id;
      var wrap = document.createElement('div');
      wrap.className = 'control';
      wrap.innerHTML = '<div class="control-row"><label class="control-label"></label><output></output></div>' +
        '<input type="range">';
      var label = wrap.querySelector('label'), out = wrap.querySelector('output'), input = wrap.querySelector('input');
      label.textContent = p.label;
      label.htmlFor = id;
      out.htmlFor = id;
      input.id = id;
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.value = state.params[fx.id][p.id];
      if (p.track === 'hue') {
        input.classList.add('is-hue');
        out.classList.add('swatch');
      }
      showValue(p, input, out);
      setFill(input);
      input.addEventListener('input', function () {
        state.params[fx.id][p.id] = Number(input.value);
        showValue(p, input, out);
        setFill(input);
        dirty = true;
      });
      controls.appendChild(wrap);
    });
    var guide = fx.guide || (Magi.effectGuides || {})[fx.id];
    if (guide && guide.length) controls.appendChild(advancedPanel(fx, guide));
  }

  // Sets a parameter from an effect (a gesture) and updates its control if it's on screen.
  function setParam(effectId, id, value) {
    var fx = effectById(effectId), params = state.params[effectId];
    if (!fx || !params) return;
    if (id === 'mode') {
      if (params.mode === value) return;
      params.mode = value;
      syncTiles();
      if (effectId === state.effectId) buildControls();
      return;
    }
    var p = null;
    fx.params.forEach(function (q) { if (q.id === id) p = q; });
    if (!p) return;
    if (p.type !== 'toggle' && p.type !== 'text') {
      var step = p.step || 1;
      value = Math.min(p.max, Math.max(p.min, Math.round(value / step) * step));
    }
    if (params[id] === value) return;
    params[id] = value;
    var el = document.getElementById('param-' + effectId + '-' + id);
    if (!el) return;
    if (p.type === 'toggle') { el.setAttribute('aria-checked', String(!!value)); return; }
    if (document.activeElement === el) return; // you're dragging it; your hand on the slider wins
    el.value = value;
    showValue(p, el, el.parentElement.querySelector('output'));
    setFill(el);
  }

  // The Advanced panel under an effect's controls: how its gestures and parameters work.
  function advancedPanel(fx, guide) {
    var d = document.createElement('details');
    d.className = 'advanced';
    d.open = !!state.advancedOpen;
    d.innerHTML = '<summary>Advanced</summary><div class="advanced-body"></div>';
    var body = d.lastChild;
    guide.forEach(function (line) {
      var para = document.createElement('p');
      var i = line.indexOf(': ');
      if (i > 0 && i < 24) {
        var term = document.createElement('span');
        term.className = 'advanced-term';
        term.textContent = line.slice(0, i);
        para.appendChild(term);
        para.appendChild(document.createTextNode(line.slice(i + 1)));
      } else para.textContent = line;
      body.appendChild(para);
    });
    d.addEventListener('toggle', function () { state.advancedOpen = d.open; });
    return d;
  }

  // On/off switch. The label says what "on" does; the switch shows the state.
  function toggleControl(fx, p) {
    var wrap = document.createElement('div');
    wrap.className = 'control control-row';
    wrap.innerHTML = '<span class="control-label"></span><button class="switch" type="button" role="switch"></button>';
    var label = wrap.firstChild, sw = wrap.lastChild;
    label.id = 'param-' + fx.id + '-' + p.id + '-label';
    label.textContent = p.label;
    sw.id = 'param-' + fx.id + '-' + p.id;
    sw.setAttribute('aria-labelledby', label.id);
    if (p.hint) sw.title = p.hint;
    function show() { sw.setAttribute('aria-checked', String(!!state.params[fx.id][p.id])); }
    show();
    sw.addEventListener('click', function () {
      state.params[fx.id][p.id] = !state.params[fx.id][p.id];
      show();
      dirty = true;
    });
    return wrap;
  }

  // Free text. A plain input, so every keyboard, language and emoji works as the device provides.
  function textControl(fx, p) {
    var id = 'param-' + fx.id + '-' + p.id;
    var wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.innerHTML = '<label class="control-label"></label><input class="control-text" type="text">';
    var label = wrap.firstChild, input = wrap.lastChild;
    label.textContent = p.label;
    label.htmlFor = id;
    input.id = id;
    input.maxLength = p.maxLength || 280;
    input.placeholder = p.placeholder || '';
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done');
    input.value = state.params[fx.id][p.id];
    input.addEventListener('input', function () {
      state.params[fx.id][p.id] = input.value;
      dirty = true;
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
    });
    return wrap;
  }

  /* ---------- Capture, review and save ---------- */

  function setMode(mode) {
    if (state.phase !== 'live') return;
    state.mode = mode;
    app.dataset.mode = mode;
    modeButtons.forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.modeOption === mode));
    });
    syncSourceButtons();
    updateShutterLabel();
  }

  function setPhase(phase) {
    state.phase = phase;
    app.dataset.phase = phase;
    if (phase !== 'live') setTray(false);
    saveBtn.hidden = phase !== 'review';
    updateShutterLabel();
  }

  function updateShutterLabel() {
    var label = state.phase === 'review' ? 'Retake'
      : state.phase === 'recording' ? 'Stop recording'
      : state.mode === 'photo' ? 'Take photo' : 'Start recording';
    shutter.setAttribute('aria-label', label);
  }

  function capturePhoto() {
    setPhase('review');
    result = new Promise(function (resolve) {
      // PNG keeps halftone edges exact; plain photos save as JPEG (see config photoType).
      var fx = currentEffect();
      var type = (fx && fx.photoType) || 'image/png';
      view.toBlob(function (blob) {
        resolve({ blob: blob, ext: type === 'image/jpeg' ? 'jpg' : 'png' });
      }, type, 0.92);
    });
  }

  function videoType(withAudio) {
    var types = withAudio
      ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  var canRecord = !!(window.MediaRecorder && view.captureStream);

  function startRecording() {
    var out = view.captureStream(30);
    // With the mic on, the canvas's video and the microphone's audio go into one stream.
    var withMic = !!(micOn && micStream && micStream.getAudioTracks().length && state.input === 'camera');
    // Sound an effect is making (Magi.fx.audioStream, e.g. the sequencer) is recorded too. With both,
    // the effect's sound is used: one audio track keeps MediaRecorder support broad.
    var fxAudio = Magi.fx.audioStream && performance.now() - Magi.fx.audioLiveAt < 1000 ? Magi.fx.audioStream.getAudioTracks() : [];
    var audioTracks = fxAudio.length ? fxAudio : withMic ? micStream.getAudioTracks() : [];
    var withAudio = audioTracks.length > 0;
    var rec = withAudio ? new MediaStream(out.getVideoTracks().concat(audioTracks)) : out;
    var type = videoType(withAudio);
    try {
      recorder = new MediaRecorder(rec, type ? { mimeType: type, videoBitsPerSecond: 8000000 } : undefined);
    } catch (e) {
      recorder = new MediaRecorder(rec);
    }
    var chunks = [];
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      out.getTracks().forEach(function (t) { t.stop(); });
      var mime = recorder.mimeType || type || 'video/webm';
      var blob = new Blob(chunks, { type: mime.split(';')[0] });
      result = Promise.resolve({ blob: blob, ext: /mp4/.test(mime) ? 'mp4' : 'webm' });
      reviewVideo.src = URL.createObjectURL(blob);
      reviewVideo.hidden = false;
      reviewVideo.play().catch(function () {});
      setPhase('review');
    };
    recorder.start(250);
    setPhase('recording');
    startTimer();
  }

  function stopRecording() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function startTimer() {
    recordStart = Date.now();
    timer.textContent = '00:00';
    timer.hidden = false;
    timerId = setInterval(function () {
      var s = Math.floor((Date.now() - recordStart) / 1000);
      timer.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerId);
    timer.hidden = true;
  }

  function retake() {
    if (reviewVideo.src) {
      reviewVideo.pause();
      URL.revokeObjectURL(reviewVideo.src);
      reviewVideo.removeAttribute('src');
      reviewVideo.load();
    }
    reviewVideo.hidden = true;
    result = null;
    resetRenderers();
    setPhase('live');
  }

  function save() {
    if (!result) return;
    saveBtn.classList.remove('is-saving');
    void saveBtn.offsetWidth; // restart the animation on repeated saves
    saveBtn.classList.add('is-saving');

    result.then(function (r) {
      var name = 'magi-' + stamp() + '.' + r.ext;
      // On phones the share sheet is the route to the camera roll; elsewhere, download.
      if (preferShare && navigator.canShare && window.File) {
        var file = new File([r.blob], name, { type: r.blob.type });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {});
          return;
        }
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  /* ---------- Wiring ---------- */

  shutter.addEventListener('click', function () {
    if (state.phase === 'review') return retake();
    if (state.phase === 'recording') return stopRecording();
    if (!currentSource() || notice.hidden === false) return;
    if (state.mode === 'photo') capturePhoto();
    else startRecording();
  });

  modeButtons.forEach(function (b) {
    if (b.dataset.modeOption === 'video' && !canRecord) {
      b.disabled = true;
      b.title = 'Video recording isn’t supported in this browser';
    }
    b.addEventListener('click', function () { setMode(b.dataset.modeOption); });
  });

  saveBtn.addEventListener('click', save);
  saveBtn.addEventListener('animationend', function (e) {
    if (e.animationName === 'save-drop') saveBtn.classList.remove('is-saving');
  });

  caret.addEventListener('click', function () { setTray(!state.trayOpen); });
  camsBtn.addEventListener('click', function (e) { e.stopPropagation(); if (camMenu.hidden) openCamMenu(); else closeCamMenu(); });
  document.addEventListener('click', function (e) { if (!camMenu.hidden && !camMenu.contains(e.target)) closeCamMenu(); });
  micBtn.addEventListener('click', function () { setMic(!micOn); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', refreshCams);

  // Phones: double-tap the preview to flip between the front and back cameras.
  var lastTap = null;
  stage.addEventListener('touchend', function (e) {
    if (!preferShare || state.input !== 'camera' || state.phase !== 'live' || state.trayOpen) { lastTap = null; return; }
    if (e.changedTouches.length !== 1 || e.touches.length || notice.contains(e.target)) { lastTap = null; return; }
    var t = e.changedTouches[0], now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40) {
      lastTap = null;
      e.preventDefault();
      facing = facing === 'user' ? 'environment' : 'user';
      camId = null; store('magi.camera', null);
      stopCamera(); startCamera();
      return;
    }
    lastTap = { t: now, x: t.clientX, y: t.clientY };
  }, { passive: false });
  stage.addEventListener('click', function (e) {
    if (state.trayOpen && !notice.contains(e.target)) setTray(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.trayOpen) { setTray(false); caret.focus(); }
  });

  // Touch: a one-finger swipe down on the open tray closes it. The tray follows the finger, and
  // a short or slow pull springs back. Swipes that start while the tray's list is scrolled down
  // scroll the list instead.
  var drag = null;
  tray.addEventListener('touchstart', function (e) {
    if (!state.trayOpen || e.touches.length !== 1 || tray.scrollTop > 0) { drag = null; return; }
    drag = { y: e.touches[0].clientY, t: performance.now(), dy: 0 };
  }, { passive: true });
  tray.addEventListener('touchmove', function (e) {
    if (!drag) return;
    drag.dy = e.touches[0].clientY - drag.y;
    if (drag.dy > 0) {
      e.preventDefault(); // pulling down: move the tray, don't scroll the page
      tray.style.transition = 'none';
      tray.style.transform = 'translateY(' + drag.dy + 'px)';
    }
  }, { passive: false });
  tray.addEventListener('touchend', function () {
    if (!drag) return;
    var speed = drag.dy / Math.max(1, performance.now() - drag.t); // px per ms
    tray.style.transition = '';
    tray.style.transform = '';
    if (drag.dy > 80 || (drag.dy > 24 && speed > 0.5)) setTray(false);
    drag = null;
  });

  // The toolbar can be put away and brought back by swiping on the strip at the bottom where it
  // sits (or sat): down hides it, sliding and fading out while the picture grows into its space;
  // up shows it again. Trackpads: a two-finger swipe there; touch screens: a one-finger swipe.
  var toolbarEl = document.querySelector('.toolbar');
  function setToolbar(shown) { app.classList.toggle('toolbar-hidden', !shown); }
  function inToolbarZone(y) { return y > window.innerHeight - toolbarEl.offsetHeight; }
  var barDrag = null;
  window.addEventListener('touchstart', function (e) {
    barDrag = e.touches.length === 1 && !(e.target instanceof Node && tray.contains(e.target)) && inToolbarZone(e.touches[0].clientY) ? { y: e.touches[0].clientY, dy: 0 } : null;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) { if (barDrag && e.touches.length === 1) barDrag.dy = e.touches[0].clientY - barDrag.y; }, { passive: true });
  window.addEventListener('touchend', function () {
    if (!barDrag) return;
    if (barDrag.dy > 40) setToolbar(false);
    else if (barDrag.dy < -40) setToolbar(true);
    barDrag = null;
  });

  // Trackpad: a two-finger swipe up opens the tray, down closes it, anywhere outside the tray.
  // Inside it, swipes only scroll. Pinch-zoom (ctrl + wheel) is left alone. On the toolbar's strip
  // a swipe down hides the toolbar and a swipe up brings it back (or, with it showing, opens the tray).
  var swipe = { sum: 0, last: 0, quietUntil: 0 };
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    if (tray.contains(e.target)) return; // inside the tray a swipe only ever scrolls it
    var now = performance.now();
    if (now < swipe.quietUntil) return; // one gesture, one action
    if (now - swipe.last > 250) swipe.sum = 0;
    swipe.last = now;
    swipe.sum += e.deltaY;
    if (inToolbarZone(e.clientY)) {
      var hidden = app.classList.contains('toolbar-hidden');
      if (swipe.sum < -60 && !hidden) { setToolbar(false); swipe.sum = 0; swipe.quietUntil = now + 600; return; }
      if (swipe.sum > 60 && hidden) { setToolbar(true); swipe.sum = 0; swipe.quietUntil = now + 600; return; }
      if (hidden) return;
    }
    // With natural scrolling, fingers moving up give positive deltaY.
    if (swipe.sum > 60 && !state.trayOpen && state.phase === 'live') {
      setTray(true);
      swipe.sum = 0; swipe.quietUntil = now + 600;
    } else if (swipe.sum < -60 && state.trayOpen) {
      setTray(false);
      swipe.sum = 0; swipe.quietUntil = now + 600;
    }
  }, { passive: true });

  // Effects that work from a set of images (config `library: true`, the Media effects) take many
  // images per upload into the session library (Magi.media) instead of replacing the camera.
  function syncUploadMode() {
    var fx = effectById(state.effectId), lib = !!(fx && fx.library);
    fileInput.multiple = lib;
    fileInput.accept = lib ? 'image/*' : 'image/*,video/*';
    uploadBtn.setAttribute('aria-label', lib ? 'Add images' : 'Upload photo or video');
  }
  uploadBtn.addEventListener('click', function () { fileInput.click(); });
  cameraBtn.addEventListener('click', startCamera);
  fileInput.addEventListener('change', function () {
    var files = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
    fileInput.value = '';
    var fx = effectById(state.effectId);
    if (fx && fx.library && Magi.media) { if (files.length) Magi.media.add(files); return; }
    if (files[0]) openFile(files[0]);
  });

  window.addEventListener('resize', fitView);
  if (window.ResizeObserver) new ResizeObserver(fitView).observe(stage);

  showLevel(null);
  selectEffect('bitmap');
  setMode('photo');
  setPhase('live');
  startCamera();
  requestAnimationFrame(tick);

  /* ---------- Updates ---------- */

  // GitHub Pages lets browsers keep the page for up to 10 minutes, so a new release could take
  // that long to appear. When Magi opens, comes back into view, and every 30 s while open, it
  // asks for the published version number (skipping every cache); if it's newer than this page,
  // it loads the new one under a fresh URL, which the cache hasn't seen. It waits until nothing
  // would be lost: not while recording, reviewing a capture or using the tray.
  var VERSION = (document.querySelector('meta[name="magi-version"]') || {}).content;

  var pendingVersion = null;

  function checkForUpdate() {
    if (!VERSION || !window.fetch || document.hidden) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.version || String(v.version) === VERSION) return;
        if (new RegExp('[?&]v=' + v.version + '(&|$)').test(location.search)) return; // already tried
        pendingVersion = v.version;
        applyUpdate();
      })
      .catch(function () {});
  }

  // Reload into the new release once nothing would be lost: live preview, tray closed.
  function applyUpdate() {
    if (!pendingVersion || state.phase !== 'live' || state.trayOpen) return;
    location.replace(location.pathname + '?v=' + pendingVersion);
  }

  checkForUpdate();
  setInterval(checkForUpdate, 30000); // also while Magi stays open
  setInterval(applyUpdate, 2000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkForUpdate();
  });
})();
