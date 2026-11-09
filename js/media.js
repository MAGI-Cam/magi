// Media library: the images you upload for the Media effects (and the Cube landmark), kept for this
// session only, in memory. Nothing is uploaded anywhere.
//
// Magi.media.add(files) decodes each image file into a thumbnail canvas (longest side 640 px) that
// keeps its file name, for captions; `items` lists them in the order chosen, `version` changes
// whenever the set does. A new upload replaces the set.
// Helpers for the Media effects:
//   list(frame): the uploaded images, or, until there are some, snapshots of the camera (one every
//     0.6 s, the last 16) so the effect shows something at once.
//   gray(item): the item's grayscale copy (Rec. 709 luma), made once.
//   size(out, frame, format): sizes the effect's picture for a post: 0 the source's own shape, 1 4:5
//     (1080 × 1350), 2 9:16 (1080 × 1920), 3 1:1 (1080 × 1080). Returns [width, height].
(function () {
  var media = { items: [], version: 0, loading: 0 };
  var THUMB = 640;

  function thumb(src, w, h, name) {
    var k = Math.min(1, THUMB / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return { img: c, name: name, w: c.width, h: c.height, grayImg: null };
  }

  media.add = function (files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(f.name); });
    if (!list.length) return;
    var next = new Array(list.length), left = list.length;
    media.loading = list.length;
    list.forEach(function (f, i) {
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () { next[i] = thumb(im, im.naturalWidth, im.naturalHeight, f.name); URL.revokeObjectURL(url); done(); };
      im.onerror = function () { URL.revokeObjectURL(url); done(); };
      im.src = url;
    });
    function done() {
      media.loading = --left;
      if (left) return;
      media.items = next.filter(Boolean);
      media.version++;
    }
  };

  media.clear = function () { media.items = []; media.version++; };

  media.gray = function (it) {
    if (it.grayImg) return it.grayImg;
    var c = document.createElement('canvas'); c.width = it.w; c.height = it.h;
    var g = c.getContext('2d'); g.drawImage(it.img, 0, 0);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) { var y = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(d, 0, 0);
    return (it.grayImg = c);
  };

  var snaps = [], snapAt = -9, snapN = 0;
  media.list = function (frame) {
    if (media.items.length) return media.items;
    var t = frame.time / 1000;
    if (t - snapAt > 0.6) {
      snapAt = t;
      var c = document.createElement('canvas'), k = 320 / Math.max(frame.width, frame.height);
      c.width = Math.round(frame.width * k); c.height = Math.round(frame.height * k);
      frame.draw(c.getContext('2d'), c.width, c.height);
      var now = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      snaps.push({ img: c, w: c.width, h: c.height, name: 'Camera ' + pad(now.getHours()) + '.' + pad(now.getMinutes()) + '.' + pad(now.getSeconds()) + ' (' + (++snapN) + ').png', grayImg: null });
      if (snaps.length > 16) snaps.shift();
    }
    return snaps;
  };

  media.size = function (out, frame, format) {
    var f = Math.round(format || 0), W = frame.width, H = frame.height;
    if (f === 1) { W = 1080; H = 1350; } else if (f === 2) { W = 1080; H = 1920; } else if (f === 3) { W = 1080; H = 1080; }
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    return [W, H];
  };

  Magi.media = media;
})();
