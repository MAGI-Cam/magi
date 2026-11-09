# Magi

Minimalist effects tool library: apply a visual effect to live camera input or an uploaded photo/video, adjust it, capture, and save to the device. Tray: **Normal** (no effect), then parent tiles: **Halftone** (Bitmap, ASCII, Binary, XO), **Gesture** (**Hand Tracking**: Landmarks, Font, Line Art, Particles, Particle Life, Exhale, Mosh, Mosh 2.0, Pinch Frame, Wisp, Web, Bubbles, Claw, Fluid Cube, Accordion, Tutting, Chromatic, Tendrils, Cards, Fibre, Particle Cloud, Pseudo Plexus; **Face Tracking**: Landmarks, Token Cry, Collage; **Body Tracking**: Glitch; **Spacenet**: Word Box, Word Space), **Facade** (Interactive, Electrokinetic, Quadtree). Groups live in `Magi.effectGroups` and nest with `parent`; an effect joins one with `group`. The tray shows one level at a time with a back row, and reopens at the last level you looked at.

Source of truth for scope is the PRD in `docs/`. This file guides implementation. Both are starting points; update them when prototyping proves a better direction.

## Structure

- `index.html` — the single page. No build step; plain scripts load in order. Every release bumps one number N in three places: the `magi-version` meta in `index.html`, the `?v=N` on every CSS/JS link, and `version.json`. The app compares its meta with `version.json` on open, on refocus and every 30 s, and reloads under `?v=N` when a newer release is published and nothing would be lost. GitHub Pages rejects a deploy while another is still in progress, so after every push check `gh run list -R MAGI-Cam/magi -L 3` until it succeeds, and rerun a failed one (`gh run rerun <id> -R MAGI-Cam/magi`).
- `css/magi.css` — interface shell (black and white only).
- `js/effects/config.js` — effect names, order, availability and parameters (`Magi.effectConfig`). No rendering code.
- `js/effects/shared.js` — helpers shared by effects: tone/color sampler, Bayer thresholds, ink tinting (`applyInk`), glyph atlas and glyph renderer, `shaderPass`, `motionEstimator` (codec-style three-step block matching, used by Mosh and Mosh 2.0), and `audio()` (a shared WebAudio output; effects that make sound set `audioLiveAt` and the app records `audioStream` with videos). Every renderer calls `applyInk` last.
- `manifest.webmanifest`, `icons/` — install as an app (Dock, home screen).
- `js/effects/<effect>.js` — one file per effect, or per family (`facades.js`, `landmarks.js`). Registers a factory in `Magi.renderers[id]` returning `{ render(frame, outCanvas, params), reset() }`, plus `animated: true` if it must redraw every frame on a still image.
- `js/tracking.js` — `Magi.tracking.body.detect(frame)` returns a person mask `{ mask, width, height }` (selfie segmenter on a ≤256 px copy of the frame). `Magi.tracking.hands` / `.face`: MediaPipe loaded on first `detect(frame)` (hands also offer `predicted(frame, lead)`, landmarks extrapolated by their filtered velocity, for drawing that must keep up); landmarks in frame pixels, mirrored like the preview, smoothed with a One Euro filter. `details()` gives handedness (hands) or blendshapes and head transform (face); `Magi.tracking.connections` has MediaPipe's drawing connections. `drawStatus` and `hint` report loading/empty states through `frame.say`. `Magi.tracking.frameId(frame.source)` changes once per new camera/video frame, for effects that keep frame history.
- `js/interaction.js` — the Interaction Engine. `Magi.interaction.read(frame)` returns `{ hands, pair, events }` once per camera frame: per hand side, center, size, rotation, finger curl/extension and count, pinch (with hysteresis) and pinches to each finger, spread, pointing, fist, velocity and the fingertip's velocity relative to the palm; two-hand distance/angle/closer; swipe, flick, shake and clap events (each with a unique `n`). New gesture logic goes here, not in effects; effects move onto it as they're touched. Hand Landmarks' Signals switch shows what it reads.
- Tracking runs once per camera frame (cached by `requestVideoFrameCallback`, else the video's time), follows hands by position with a 200 ms hold, and smooths x, y and z with One Euro (min cutoff 1.5 Hz, β 0.05, speed cutoff 4 Hz).
- `frame` gives effects: `width`, `height`, `draw(ctx, w, h)`, `moving`, `pxPerCss`, `source` (raw element), `mirror`, `time` (ms), `say(text)` for a one-line instruction shown as DOM text over the preview (sharp, never saved), and `setParam(id, value)` for a gesture that changes one of the effect's own parameters (the slider moves with it; `'mode'` switches mode), and `hud`, a 2D context over the preview at the screen's resolution in frame coordinates: draw all text there so it stays sharp (the app copies it into the picture for photos and videos). Don't draw instructions into the canvas.
- Parameter types in config: range (default), `toggle` (with `hint`), `text`. `track: 'hue'` draws a color spectrum. `modes: [...]` on a parameter shows it only in those modes. `Magi.effectGuides[id]` holds each effect's Advanced panel text ("Term: text" lines): keep it in step with the effect's gestures and parameters.
- `js/app.js` — camera/upload input, tray, shared controls, capture, review, save. Must stay effect-agnostic.
- `docs/` — PRD, design file and original guidance (v0.1 PDFs).
- Data: `js/effects/color-names.js` is the xkcd color survey (949 names, CC0), extracted as text from matplotlib's `_color_data.py`.
- External: Google Fonts (Inter and glyph faces) and MediaPipe Tasks Vision 0.10.14 from jsDelivr with models (hand, face, selfie segmenter) from storage.googleapis.com, plus image feeds the user names in an effect (`js/library.js`: a JSON feed or a public Are.na channel through api.are.na; images load with CORS or are skipped, so the canvas is never tainted). Nothing else.
- `js/library.js` — `Magi.library.get(source)` returns `{ status, items: [thumbnail canvases], message }`, filling in as images arrive; cached per source for the session. Each canvas carries `.meta`, its feed entry (with `embedding` when the feed has one).
- `js/effects/gpu-particles.js` — `Magi.gpuParticles()`: a WebGL2 particle system after TouchDesigner's Particle POP and Lookup Texture POP. State in float textures (one texel per particle, position+age and velocity+lifespan, updated in one pass with two render targets); Kinematic Simulation turbulence, a shell spring, attractors, sphere/line/point emitters, life and rebirth; points added into a half-float image with feedback trails, bloom and light (1 − e^(−Ex)) or ink (e^(−Ex)) tone mapping; optional camera color lookup. `setCount`, `step(uniforms)`, `draw(options)`, then draw `.canvas` onto the effect's canvas ('lighter' or 'multiply'). Emitters can be up to 42 hand landmarks (optionally by particle index), and `draw({ lines })` adds pseudo-plexus lines (particle i to i + stride, faded by length). Used by Fibre, Particle Cloud and Pseudo Plexus (`plexus.js`). Headless Chromium emulates the GPU on the CPU (about 180 ms a frame at 250k), so time it on a real device.
- `js/effects/landmark-modes.js` — Landmarks' Contour, Filaments, Attention, Sequencer, Rabinovich, Cohesion, Pollinate and Zero modes (`Magi.landmarkModes`), plus `Magi.contourSampler` and `Magi.nearestTour`, shared with Line Art; `js/effects/font-editor.js` — the Font tile.

To add an effect: add its entry in `config.js` with `ready: true`, create its renderer file, add a `<script>` tag in `index.html`.

## Priorities

- Working Bitmap before expanding the library.
- Live camera and uploaded photos/videos use the same workflow.
- Bitmap: square pixels; gray comes from pixel density. Pure black and white by default.
- Shared controls: Scale, Intensity, Saturation (media color), Color (ink hue). Medium default Scale, reset-to-defaults. Defaults keep the original black-and-white look.
- Effects can have modes (`modes` in config); tapping the active tile cycles them. ASCII has five.
- Glyph effects size cells in screen pixels (`frame.pxPerCss`) so characters stay legible on phones. Bitmap sizes in image pixels.
- Photos: PNG by default (exact edges); photographic effects set `photoType: 'image/jpeg'` (Normal, Landmarks, Mosh, Token Cry, Quadtree).
- Performance: anything drawn per cell or per module at small sizes goes through a pixel buffer (`fx.blitGlyphs`, Electrokinetic's `paint`), not thousands of canvas calls. Measure frame time at the smallest Scale before shipping. Per-pixel work over large areas (Glitch, Collage's grain) goes in a WebGL fragment shader through `fx.shaderPass`; Wisp runs its whole fluid on WebGL2 (half-float render targets); headless Chromium needs `--enable-unsafe-swiftshader` for WebGL and runs shaders on the CPU, so time those on a real device. Headless tests run MediaPipe on CPU (~150 ms/frame); time effects with detection stubbed out.
- Effects follow the real formula or mechanism they're named for, written in a comment next to the code. Verify math numerically when it can be.
- The preview canvas scales with nearest-pixel only when enlarging; when shrunk it scales smoothly (`.view.is-reduced`), or thin strokes vanish.
- Web fonts used on canvas must be loaded first (`fx.fontReady`); hairline faces need a low atlas `threshold`.
- No logo mark on the preview.
- Black-and-white, minimal UI. Text-only, uniform effect tiles. Icon-only fixed bottom toolbar with accessible names.
- Capture, retake, save/download.

## Principles

- Keep each effect separate from the camera interface; keep config separate from rendering.
- Reuse shared controls. Don't add dependencies, abstractions or features without a clear need.
- Build incrementally and verify each interaction in a real browser (desktop and mobile width).
- Inter is the starting typeface, not a fixed rule. Let the effects carry the personality.
- Take inspiration from minimalist editorial design philosophy without copying any brand identity.

## Working style

- Inspect the structure and explain the approach briefly before broad changes. Prefer small, reversible changes.
- Ask only when a missing decision blocks progress; otherwise state the assumption.
- Don't silently invent product requirements. Flag trade-offs and open decisions.
- Keep docs aligned with the implementation.

## Open decisions

Effect algorithms and parameter ranges, depth estimation, export format/limits, responsive layout specifics, Effect Lab architecture. See README for what v0.1 assumed.
