# Magi

Minimalist effects tool library: apply a visual effect to live camera input or an uploaded photo/video, adjust it, capture, and save to the device. Tray: **Normal** (no effect), then the **Halftone** group: Bitmap, ASCII, Binary, X's and O's. Groups live in `Magi.effectGroups`; an effect joins one with `group`.

Source of truth for scope is the PRD in `docs/`. This file guides implementation. Both are starting points; update them when prototyping proves a better direction.

## Structure

- `index.html` — the single page. No build step; plain scripts load in order. CSS/JS links carry `?v=N`; bump N on every release so browsers and installed apps don't mix cached old files with new ones.
- `css/magi.css` — interface shell (black and white only).
- `js/effects/config.js` — effect names, order, availability and parameters (`Magi.effectConfig`). No rendering code.
- `js/effects/shared.js` — helpers shared by effects: tone/color sampler, Bayer thresholds, ink tinting (`applyInk`), glyph atlas and glyph renderer. Every renderer calls `applyInk` last.
- `manifest.webmanifest`, `icons/` — install as an app (Dock, home screen).
- `js/effects/<effect>.js` — one file per effect. Registers a factory in `Magi.renderers[id]` returning `{ render(frame, outCanvas, params), reset() }`.
- `js/app.js` — camera/upload input, tray, shared controls, capture, review, save. Must stay effect-agnostic.
- `docs/` — PRD, design file and original guidance (v0.1 PDFs).

To add an effect: add its entry in `config.js` with `ready: true`, create its renderer file, add a `<script>` tag in `index.html`.

## Priorities

- Working Bitmap before expanding the library.
- Live camera and uploaded photos/videos use the same workflow.
- Bitmap: square pixels; gray comes from pixel density. Pure black and white by default.
- Shared controls: Scale, Intensity, Saturation (media color), Color (ink hue). Medium default Scale, reset-to-defaults. Defaults keep the original black-and-white look.
- Effects can have modes (`modes` in config); tapping the active tile cycles them. ASCII has five.
- Glyph effects size cells in screen pixels (`frame.pxPerCss`) so characters stay legible on phones. Bitmap sizes in image pixels.
- Photos: PNG for halftone effects (exact edges), JPEG for Normal (`photoType`).
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
