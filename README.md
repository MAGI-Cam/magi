# Magi

A minimalist effects tool library. Apply a visual effect to your live camera or an uploaded photo or video, adjust it, capture, and save the result to your device.

The tray has **Normal** (the plain camera), then the **Halftone** effects. Halftone is the printing technique of faking gray with a pattern of marks; every effect here rebuilds the image from a grid of marks and lets their density carry the shading.

- **Bitmap**: square pixels in pure black and white, with gray made only by how densely the black pixels sit.
- **ASCII**: one character per cell, in five modes. Tap the ASCII tile again to switch mode:
  - *Classic*: the short `.:-=+*#%@` ramp most ASCII art uses.
  - *Detailed*: Paul Bourke's 70-character ramp, with finer tonal steps.
  - *Blocks*: the DOS-era shade characters ░ ▒ ▓ █, drawn as pixel patterns.
  - *Braille*: each cell is a 2×4 grid of dots, so detail is 8× finer.
  - *Edges*: outlines drawn with `- | / \` along edges, Classic ramp elsewhere.
- **Binary**: only `0`, `1` and empty space.
- **X's and O's**: drawn crosses and rings that grow and thicken in brighter areas.

Every effect has the same controls: **Scale**, **Intensity**, **Saturation** (how much of the media's own color shows) and **Color** (the ink color: white at the far left, then the hue wheel). With both up, Saturation blends from the chosen color toward the media's color.

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
| Glyph effects | ASCII, Binary and X's and O's are white glyphs on black, snapped to pure black and white. Glyphs are ordered by measured ink coverage and dithered between neighbors. Scale sets the cell size in screen pixels (6–24, default 11), so characters stay readable on a phone where the preview is shrunk. These looks are first interpretations, not from the PRD. |
| Color | Saturation and Color tint whatever is lit (white pixels or glyphs); the black background stays black. Both default to 0, which is the original pure black and white. |
| Canvas fit | The whole frame is shown (contained) with black around it. Nothing is cropped or stretched. |

## Project layout

```
index.html            page structure
manifest.webmanifest  install details (name, icons, standalone window)
icons/                app icons (pixel M)
css/magi.css          interface shell
js/effects/config.js  effect names, order and parameters
js/effects/shared.js  tone sampling, dithering, glyph renderer
js/effects/*.js       one renderer per effect
js/app.js             camera, upload, tray, capture, review, save
docs/                 PRD, design file, project guidance (v0.1)
```
