# Magi

Minimalist effects tool library: apply a visual effect to live camera input or an uploaded photo/video, adjust it, capture, and save to the device. First release: **Bitmap**.

Source of truth for scope is the PRD in `docs/`. This file guides implementation. Both are starting points; update them when prototyping proves a better direction.

## Structure

- `index.html` — the single page. No build step; plain scripts load in order.
- `css/magi.css` — interface shell (black and white only).
- `js/effects/config.js` — effect names, order, availability and parameters (`Magi.effectConfig`). No rendering code.
- `js/effects/<effect>.js` — one file per effect. Registers a factory in `Magi.renderers[id]` returning `{ render(frame, outCanvas, params), reset() }`.
- `js/app.js` — camera/upload input, tray, shared controls, capture, review, save. Must stay effect-agnostic.
- `docs/` — PRD, design file and original guidance (v0.1 PDFs).

To add an effect: add its entry in `config.js` with `ready: true`, create its renderer file, add a `<script>` tag in `index.html`.

## Priorities

- Working Bitmap before expanding the library.
- Live camera and uploaded photos/videos use the same workflow.
- Bitmap: square pixels, pure black and white only; gray comes from pixel density.
- Scale and Intensity controls, medium default Scale, reset-to-defaults.
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
