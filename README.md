# Magi

A minimalist effects tool library. Apply a visual effect to your live camera or an uploaded photo or video, adjust it, capture, and save the result to your device.

Effects:

- **Bitmap**: square pixels in pure black and white, with gray made only by how densely the black pixels sit.
- **ASCII**: one monospace character per cell; brighter areas get denser characters.
- **Binary**: only `0`, `1` and empty space.
- **X's and O's**: drawn crosses and rings that grow and thicken in brighter areas.

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
- **Effects tray** (caret, bottom-right): pick an effect and adjust Scale and Intensity. The circular arrow resets to defaults. Tap the active tile again to see the unprocessed source.
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
| Photo export | PNG at the processed resolution (about 1280 px on the long edge). |
| Video export | MP4 where the browser can record it (Safari, recent Chrome), otherwise WebM. 30 fps, no audio, no length limit. |
| Saving on phones | Uses the share sheet when available, so the result can go to the camera roll. Desktop downloads the file. |
| Glyph effects | ASCII, Binary and X's and O's are white glyphs on black, snapped to pure black and white. Glyphs are ordered by measured ink coverage and dithered between neighbors. Scale sets the cell size (6–24 px, default 12 px). These looks are first interpretations, not from the PRD. |
| Canvas fit | The whole frame is shown (contained) with black around it. Nothing is cropped or stretched. |

## Project layout

```
index.html            page structure
css/magi.css          interface shell
js/effects/config.js  effect names, order and parameters
js/effects/shared.js  tone sampling, dithering, glyph renderer
js/effects/*.js       one renderer per effect
js/app.js             camera, upload, tray, capture, review, save
docs/                 PRD, design file, project guidance (v0.1)
```
