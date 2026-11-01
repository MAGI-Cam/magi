# Magi

A minimalist effects tool library. Apply a visual effect to your live camera or an uploaded photo or video, adjust it, capture, and save the result to your device.

The tray opens on **Normal** (the plain camera) and four parent tiles. Tap a parent to see its effects; the back row returns. A parent tile shows which of its effects is on.

**Halftone**: rebuild the image from a grid of marks and let their density carry the shading.

- **Bitmap**: square pixels in pure black and white.
- **ASCII**: one character per cell. Tap the active tile to switch mode: *Classic* (`.:-=+*#%@`), *Detailed* (Paul Bourke's 70-character ramp), *Blocks* (░ ▒ ▓ █), *Braille* (2×4 dots per cell, 8× finer), *Edges* (`- | / \` along edges).
- **Binary**: only `0`, `1` and space, in VT323 or Silkscreen.
- **XO**: x, o, X, O in Bodoni or Silkscreen.

Halftone controls: Scale, Intensity, Saturation (how much of the media's own color shows) and Color (ink: white at the far left, then the hue wheel). Glyphs are written straight into one pixel buffer per frame, so the smallest scales keep up with live video.

**Hand Tracking** (MediaPipe Hand Landmarker, the same model TouchDesigner's MediaPipe plugin uses)

- **Landmarks**: the 21-point skeleton per hand. Switches: Readouts (handedness, score, rotation), Pinch (thumb–index distance over palm length), Distance (between two hands).
- **Mosh**: real datamoshing. Block motion vectors are measured with three-step search and applied, uncorrected, to a picture that never refreshes, inside the zone between thumb and index finger. Pinch to snap clean. Controls: Scale (vector strength), Block (macroblock size), Hold (how long the smear lasts before it unwinds block by block, newest first), Reach (zone size).

**Face Tracking** (MediaPipe Face Landmarker: 478 points, 52 blendshapes, head pose)

- **Landmarks**: the full mesh with eye, iris, brow, lip and face-oval contours, head yaw/pitch/roll and the strongest expressions.
- **Token Cry**: your text (any language, emoji) pours from your lower eyelids along your face's own "down", following head movement. Tokens are Verlet-physics bodies: a symbol is a circle, a phrase a rigid stick, so they tumble, bounce a little and pile up like objects in a jar. Controls: Text, Speed, Scale (relative to your eyes, so tokens grow as you come closer), Phrase (whole phrase per tear, or one symbol at a time), Pool (pile up, or fall through), Inverse (tokens invert what's beneath them), Color.

All landmarks are smoothed with a One Euro filter, which holds points steady at rest without adding lag to fast moves.

**Facade**: the camera is the sun behind an adaptive building envelope. Every module reads the light (Interactive: motion) behind it and moves with first-order lag, a → a* with time constant τ. Controls: Scale, Response, Speed, Shade (on: close against bright light; off: open toward it).

- *Interactive*: pivoting louvers that turn face-on where something moves. Saturation and Color tint the louvers.
- *Electrokinetic*: pixel glazing; colored particles spread over each pixel, area ∝ signal. Modes: Circle, Square, Hexagon, Triangle, Diamond. Saturation scales the image's color saturation and Color rotates its hues. Shapes are anti-aliased and placed to the quarter pixel.

Instructions and loading states from effects ("Raise a hand.") show as text over the preview, never in saved photos.

## Install it

Open https://magi-cam.github.io/magi/ and install it like an app:

- **Mac, Safari:** File → Add to Dock (macOS Sonoma or later).
- **Mac or PC, Chrome:** ⋮ → Cast, Save, and Share → Install page as app.
- **iPhone:** Safari → Share → Add to Home Screen.
- **Android:** Chrome → ⋮ → Add to Home screen.

## Run it locally

No build step and no dependencies. The camera only works over `https` or `localhost`, so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in Chrome, Safari, Firefox or Edge and allow camera access.

To try it on a phone, the page has to be served over https (for example from GitHub Pages or another static host). Phone browsers block the camera on plain `http://` addresses on your local network.

## How to use

- **Live camera** opens by default. The upload icon (bottom-left) switches to a photo or video. The camera icon in the same spot switches back.
- **Photo / Video** toggle (bottom-left) picks the capture mode.
- **Shutter** (center): photo mode captures a still. Video mode starts recording on the first tap and stops on the second.
- **Effects tray** (caret, bottom-right): pick an effect and adjust its sliders. The circular arrow resets the sliders to defaults (an ASCII mode stays as chosen). Tapping the active ASCII tile switches mode. **Normal** shows the camera without an effect.
- **Review**: after capture the preview freezes. The shutter becomes Retake. The download icon (top-right) saves the result.

## Decisions made for v0.1

These fill gaps the PRD leaves open. They are easy to change.

| Area | v0.1 choice |
| --- | --- |
| Bitmap method | 8×8 ordered (Bayer) dithering on a coarse grid. The pattern stays fixed in place, so live video doesn't shimmer. |
| Gentle motion | Each pixel eases toward the new frame (45% per frame), which softens camera noise and flicker. |
| Scale | 9 steps, pixel size 2–16 px on a 1280 px working frame. Default is step 5 (6 px). |
| Intensity | 0–100, applied as contrast around mid-gray (0.25× at 0, 1× at 50, 4× at 100). Default 50. |
| Depth | Not implemented yet. Bitmap responds to brightness only. |
| Camera | Front-facing camera, mirrored like a photo booth. Saved results are mirrored too. |
| Photo export | Halftone effects save PNG, which keeps hard pixel edges exact. Normal saves JPEG (quality 92). About 1280 px on the long edge. |
| Video export | MP4 where the browser can record it (Safari, recent Chrome), otherwise WebM. 30 fps, no audio, no length limit. |
| Saving on phones | Uses the share sheet when available, so the result can go to the camera roll. Desktop downloads the file. |
| Tracking | Google MediaPipe (Hand Landmarker, Face Landmarker), loaded from jsDelivr and Google's model storage the first time a tracking effect is picked. It needs a connection then; a status line on the frame says when it is loading or failed. |
| Glyph effects | ASCII, Binary and XO are white glyphs on black, snapped to pure black and white. Glyphs are ordered by measured ink coverage and dithered between neighbors. Scale sets the cell size in screen pixels (6–24, default 11), so characters stay readable on a phone where the preview is shrunk. These looks are first interpretations, not from the PRD. |
| Color | Saturation and Color tint whatever is lit (white pixels or glyphs); the black background stays black. Both default to 0, which is the original pure black and white. |
| Canvas fit | The whole frame is shown (contained) with black around it. Nothing is cropped or stretched. |

## Project layout

```
index.html            page structure
manifest.webmanifest  install details (name, icons, standalone window)
icons/                app icons (pixel M)
css/magi.css          interface shell
js/effects/config.js  effect names, order and parameters
js/effects/shared.js  tone sampling, dithering, glyph renderer, fonts, modes
js/effects/*.js       one renderer per effect (facades.js and landmarks.js hold families)
js/tracking.js        hand and face tracking (MediaPipe, loaded on demand)
js/app.js             camera, upload, tray, capture, review, save
docs/                 PRD, design file, project guidance (v0.1)
```
