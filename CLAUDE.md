# Magi

Minimalist effects tool library: apply a visual effect to live camera input or an uploaded photo/video, adjust it, capture, and save to the device. Tray: **Normal** (no effect), then parent tiles: **Halftone** (Bitmap, ASCII, Binary, XO), **Gesture** (**Hand Tracking**: Landmarks, Mosh, Pinch Frame, Wisp, Claw, Fluid Cube, Accordion, Tutting, Chromatic; **Face Tracking**: Landmarks, Token Cry), **Facade** (Interactive, Electrokinetic). Groups live in `Magi.effectGroups` and nest with `parent`; an effect joins one with `group`. The tray shows one level at a time with a back row, and always opens at the top level.

Source of truth for scope is the PRD in `docs/`. This file guides implementation. Both are starting points; update them when prototyping proves a better direction.

## Structure

- `index.html` — the single page. No build step; plain scripts load in order. Every release bumps one number N in three places: the `magi-version` meta in `index.html`, the `?v=N` on every CSS/JS link, and `version.json`. The app compares its meta with `version.json` on open, on refocus and every 30 s, and reloads under `?v=N` when a newer release is published and nothing would be lost. GitHub Pages rejects a deploy while another is still in progress, so after every push check `gh run list -R MAGI-Cam/magi -L 3` until it succeeds, and rerun a failed one (`gh run rerun <id> -R MAGI-Cam/magi`).
- `css/magi.css` — interface shell (black and white only).
- `js/effects/config.js` — effect names, order, availability and parameters (`Magi.effectConfig`). No rendering code.
- `js/effects/shared.js` — helpers shared by effects: tone/color sampler, Bayer thresholds, ink tinting (`applyInk`), glyph atlas and glyph renderer. Every renderer calls `applyInk` last.
- `manifest.webmanifest`, `icons/` — install as an app (Dock, home screen).
- `js/effects/<effect>.js` — one file per effect, or per family (`facades.js`, `landmarks.js`). Registers a factory in `Magi.renderers[id]` returning `{ render(frame, outCanvas, params), reset() }`, plus `animated: true` if it must redraw every frame on a still image.
- `js/tracking.js` — `Magi.tracking.hands` / `.face`: MediaPipe loaded on first `detect(frame)`; landmarks in frame pixels, mirrored like the preview, smoothed with a One Euro filter. `details()` gives handedness (hands) or blendshapes and head transform (face); `Magi.tracking.connections` has MediaPipe's drawing connections. `drawStatus` and `hint` report loading/empty states through `frame.say`.
- `frame` gives effects: `width`, `height`, `draw(ctx, w, h)`, `moving`, `pxPerCss`, `source` (raw element), `mirror`, `time` (ms), and `say(text)` for a one-line instruction shown as DOM text over the preview (sharp, never saved). Don't draw instructions into the canvas.
- Parameter types in config: range (default), `toggle` (with `hint`), `text`. `track: 'hue'` draws a color spectrum. `modes: [...]` on a parameter shows it only in those modes.
- `js/app.js` — camera/upload input, tray, shared controls, capture, review, save. Must stay effect-agnostic.
- `docs/` — PRD, design file and original guidance (v0.1 PDFs).
- Data: `js/effects/color-names.js` is the xkcd color survey (949 names, CC0), extracted as text from matplotlib's `_color_data.py`.
- External: Google Fonts (Inter and glyph faces) and MediaPipe Tasks Vision 0.10.14 from jsDelivr with models from storage.googleapis.com. Nothing else.

To add an effect: add its entry in `config.js` with `ready: true`, create its renderer file, add a `<script>` tag in `index.html`.

## Priorities

- Working Bitmap before expanding the library.
- Live camera and uploaded photos/videos use the same workflow.
- Bitmap: square pixels; gray comes from pixel density. Pure black and white by default.
- Shared controls: Scale, Intensity, Saturation (media color), Color (ink hue). Medium default Scale, reset-to-defaults. Defaults keep the original black-and-white look.
- Effects can have modes (`modes` in config); tapping the active tile cycles them. ASCII has five.
- Glyph effects size cells in screen pixels (`frame.pxPerCss`) so characters stay legible on phones. Bitmap sizes in image pixels.
- Photos: PNG by default (exact edges); photographic effects set `photoType: 'image/jpeg'` (Normal, Landmarks, Mosh, Token Cry).
- Performance: anything drawn per cell or per module at small sizes goes through a pixel buffer (`fx.blitGlyphs`, Electrokinetic's `paint`), not thousands of canvas calls. Measure frame time at the smallest Scale before shipping. Per-pixel work over large areas (Wisp's refraction) goes in a WebGL fragment shader; headless Chromium needs `--enable-unsafe-swiftshader` for WebGL and runs shaders on the CPU, so time those on a real device. Headless tests run MediaPipe on CPU (~150 ms/frame); time effects with detection stubbed out.
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
