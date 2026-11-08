# MAGI roadmap (decided November 2026)

Decisions from the planning questionnaire. Each item becomes a small release, tested in a browser before shipping.

## App (done in release 38)

- **Camera picker:** a camera icon in the bottom toolbar, shown only when more than one camera exists. It lists cameras by name (`enumerateDevices`, `deviceId`). The choice is remembered per device. A newly plugged-in camera is switched to (`devicechange`), and an unplugged one falls back to the previous camera.
- **Microphone:** a mic toggle next to the video button, off by default. Permission is asked the first time it's turned on. Its audio track is added to the recorded stream.
- **Double-tap:** on phones it flips the front and back cameras. On computers it does nothing; the camera menu is used instead. It does nothing on uploaded media.

## Media library

- **Source:** a JSON feed published on Allen's own sites. The media lives on GitHub and Cloudflare. GitHub Pages already sends CORS headers; Cloudflare (R2 or Pages) needs one rule. Images must be served with CORS, or the canvas is tainted and photos and videos can't be saved.
- **Discovery:** MAGI will ship with the feed URL built in once it exists (waiting on the URL); for now the Cards effect's Feed field takes any feed or Are.na channel. An Advanced field accepts another feed or a public Are.na channel. CLAUDE.md's external-host list grows by these hosts when this lands.
- **Feed format (draft):** `{ "items": [ { "src": "https://…/image.jpg", "title": "…", "w": 1200, "h": 800 } ] }`. A3 adds `embedding`/`graph` fields.
- **Open:** Cargo and Are.na are still being weighed for the sites. Are.na channels are read through its open API, without a login.

## Effects

- **A2 Card structures** (first library effect; done in release 39 as **Cards**): library images as 3D card stacks (ribbon, ring, lattice) with lime 3D text. Pinch-spread zooms and rotates; finger count switches the structure.
- **A3 Attention graph** (Landmarks mode): a node graph of library thumbnails. A script run on the site computes image embeddings (CLIP) and the Mapper graph and writes them into the feed. MAGI only draws and navigates it: point to select, fist to pull in, open palm to spread out.
- **A1 Tracking boxes:** library images pop up inside thin red/green/blue boxes that cluster where things move (motion blobs from frame differencing). Later.
- **A5 Font editor** (Landmarks mode):
  - Glyph outlines come from fonts MAGI already loads, traced instead of parsed. A glyph is drawn on a hidden canvas, its contours are traced with marching squares and resampled evenly. Default face Bodoni Moda; Inter, Silkscreen and VT323 can be chosen in Advanced.
  - Gestures, after the reference: the fingers touching the thumb pick what's adjusted (index: character, index + middle: distortion, all five: smoothness). Turning the hand turns the value like a knob, and the A–Z dial rotates with it.
  - Distortion displaces points through a smooth noise field. Smoothness is iterated Laplacian smoothing.
  - On screen: dotted outline points, a wobbly envelope, a crosshair, and a HUD reading ADJUSTING, CHARACTER, DISTORTION and SMOOTHNESS.
- **A4 "Slip"** (a Glitch mode):
  - Pure black and white by Otsu's threshold.
  - The mouth-and-jaw block from the face mesh slides out of place in jumps.
  - A mirrored ripple band runs through the body below it.
