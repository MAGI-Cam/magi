# Magi

A minimalist effects tool library. Apply a visual effect to your live camera or an uploaded photo or video, adjust it, capture, and save the result to your device.

The tray opens on **Normal** (the plain camera) and three parent tiles: Halftone, Gesture (Hand, Face and Body Tracking) and Facade. Tap a parent to see its effects; the back row returns. The tray reopens where you left it. Under each effect's controls, Advanced explains its gestures and parameters, and sliders move when a gesture changes them. Text drawn by effects is rendered at the screen's full resolution. A parent tile shows which of its effects is on.

**Halftone**: rebuild the image from a grid of marks and let their density carry the shading.

- **Bitmap**: square pixels in pure black and white.
- **ASCII**: one character per cell. Tap the active tile to switch mode: *Classic* (`.:-=+*#%@`), *Detailed* (Paul Bourke's 70-character ramp), *Blocks* (░ ▒ ▓ █), *Braille* (2×4 dots per cell, 8× finer), *Edges* (`- | / \` along edges).
- **Binary**: only `0`, `1` and space, in VT323 or Silkscreen.
- **XO**: x, o, X, O in Bodoni or Silkscreen.

Halftone controls: Scale, Intensity, Saturation (how much of the media's own color shows) and Color (ink: white at the far left, then the hue wheel). Glyphs are written straight into one pixel buffer per frame, so the smallest scales keep up with live video.

**Gesture**: effects driven by your body, in three groups.

**Hand Tracking** (MediaPipe Hand Landmarker, the same model TouchDesigner's MediaPipe plugin uses)

- **Landmarks**: the 21-point skeleton per hand. Switches: Readouts (handedness, score, rotation), Pinch (thumb–index distance over palm length), Distance (between two hands), Fingers (gaps between neighboring fingertips), Pairs (matching fingertips of your two hands), Signals (what MAGI reads from each hand: finger count, curl, spread, pinches, speed, the last swipe, flick or shake).
- **Pinch Frame**: modes Acid, Thermal, Invert and Blur: make an L with thumb and index finger on both hands; the four fingertips span a window where the camera shows in false color (Bands, default 1, and Speed) or blurred (Blur; Frosted for frosted glass); Line outlines the window.
  - *Print*: hold a printed sheet by its corners (index fingers top, thumbs bottom); twist and it folds, and a side that turns over shows the back (riso Blue and Yellow front, Bright Red halftone back). Sheets: 1 is this folding print; 2–4 give each finger its own sheet (index, middle, ring, pinky) in overprinting riso inks. Controls: Sheets, Dots, Grain, Shift.
  - *Code*: pinch with both hands to span a box read out as a 1-bit code (barcode bars when thin, a blocky image when tall), with guide lines and coordinates. Lock on: corners stay where you let go, and a fist frees that hand's corner to follow it until your next pinch; Lock off: the box follows your pinches. Outside codes everything but the box; Solid fills the area with one flat color instead. Controls: Cells, Color, Lock, Outside, Solid.
  - Skeleton draws the tracked hands (off at start).
- **Wisp**: moving your fingers stirs the video like smoke: the picture itself swirls, drags and curls where your hand passed, then settles back; pinch to suck it back to normal quickly. A real 2D fluid (Stam's Stable Fluids on the GPU, with vorticity confinement) carries a map of where each pixel's image comes from. A still hand does nothing. Needs WebGL2. Controls: Trail, Flow, Swirl, Rise.
- **Bubbles**: soap bubbles from your hands. Wave your fingers to stream them; pinch thumb and index and a bubble grows at your fingertips while you hold, floating off when you let go. Modes: Soap (lit like a real soap film: thin-film interference colors and a Fresnel rim), Inverse (each bubble inverts the video under it, with a crisp rim) and Electrokinetic (inside each bubble the video becomes dot glazing, dots sized by brightness). A bubble pops when its life runs out (2–5 s) or, with Pop on, when a fingertip touches it. Controls: Amount, Size, Float, Wind, Wand, Pop, Skeleton.
- **Web**: a digital spiderweb strung between your fingers, from the same lines Landmarks measures: palm to fingertips, fingertip to fingertip, matching fingertips across both hands, with rings like an orb web. Threads are Verlet ropes pinned to your fingers, so they sag and swing; particles run along them. A pinch draws a taut thumb–index thread, and letting go plucks the web. Controls: Rings, Sag, Particles, Glow, Color.
- **Claw**: the hand as a 3D armature. Every chain starts at one root in the palm; each link is an octahedral bone built in 3D from MediaPipe's depth, so the rig turns with your hand, drawn slightly ahead of the last detection (extrapolated by each joint's velocity) so it keeps up. Fingertips carry 3D wireframe cylinders, talons extend past each fingertip to a crosshair (and retract as the finger curls), HUD brackets orbit the palm, and everything glows. Controls: Talons, Size, X and Y (move the rig away from your hand), Glow, Glyphs, Color.
- **Fluid Cube**: a wireframe cube of particle fluid (Clavet et al. 2005 double density relaxation) that floats at your index fingertip and turns with your hand in 3D; bring the hand closer and it grows. With two hands it moves to whichever index fingertip comes clearly closer, gliding over. Gravity stays screen-down, so turning it pours the fluid. Flick to throw the fluid, shake to churn it. Each particle is drawn as a cluster of tiny glowing specks, with on-screen readouts like the reference. Controls: Size, Particles, Gravity, Viscosity, Orbit (keeps it turning), Spin, Color, Cube, Glow, Readouts.
- **Accordion**: a bellows of colored panels between your palms that unfolds as you pull apart and folds to two as you come together. The gradient starts at your left hand. Bring one hand clearly closer to the camera and the bellows stretches in depth toward it; roll your palms to tilt the panels; pinch and hold to drift the color (twice as fast with both hands pinching; the Color slider follows). Controls: Panels, Waist, Size, Color, Spread, Opacity, Outline, Line (off at start).
- **Tutting**: a volume of image tiles in the box between your palms; side by side it's a slab, one above the other a column, and it holds its shape when your hands come together. Flick a hand down or up and that side of the volume turns over like a Rubik's cube layer. Modes: Scatter (pieces of the room), Behind (what's behind each tile). Controls: Tiles, Size, Fan, Depth, Drift, Dim, Edges.
- **Chromatic**: the 949 names of the xkcd color survey (public domain), each placed at its color in Lab (perceptual), HSL or RGB space. Point to turn the space, spread thumb and index to zoom; the name nearest your fingertip lights up with its hex. Hold up 1, 2 or 3 fingers to switch to Lab, HSL or RGB; pinch to grab a name and pull it out of the space. Controls: Size, Labels, Text, Spin, Dim, Squares, Axes.
- **Mosh**: real datamoshing. Block motion vectors are measured with three-step search and applied, uncorrected, to a picture that never refreshes, inside the zone between thumb and index finger. Clap your hands to snap it clean. Controls: Scale (vector strength), Block (macroblock size), Hold (how long the smear lasts before it unwinds block by block, newest first), Reach (zone size).

**Face Tracking** (MediaPipe Face Landmarker: 478 points, 52 blendshapes, head pose)

- **Landmarks**: the full mesh with eye, iris, brow, lip and face-oval contours, head yaw/pitch/roll and the strongest expressions.
- **Token Cry**: your text (any language, emoji) pours from your lower eyelids along your face's own "down", following head movement. Tokens are Verlet-physics bodies: a symbol is a circle, a phrase a rigid stick, so they tumble, bounce slightly and pile up like objects in a jar. Controls: Text, Speed, Scale (relative to your eyes), Phrase (whole phrase per tear, or one symbol at a time), Pool (pile up, or fall through), Color.
- **Collage** (face and hand): a "source" box sits on your right eye; while your hand is up, numbered snapshots of your eyes, mouth and nose fill a sphere around your head. Pinch to size it, spread your fingers to space the copies. With your palm square to the camera nothing turns; turn your hand and hold, and the sphere keeps orbiting that way. Lower your hand and they fly back. Controls: Rate, Count (3–100, default 12), Size, X and Y (move the palm's wireframe sphere), Sphere (show it), Mono.

**Body Tracking** (MediaPipe Image Segmenter, selfie model: a mask of where a person is)

- **Glitch**: your whole body breaks up like corrupted video, only inside your outline. Modes: Split (two seams cross at your hand; each tile slips and splits its colors, with soft seams and edges and the photo still visible), Blocks (macroblocks decode as their mean color, copy from the wrong place, or swap channels; Overexposed adds blown-out 1-bit blocks), Dissolve (pieces of you land in the wrong place, up to Spread away; missing pieces decode as random bits). In Blocks and Dissolve, raise your hand to glitch harder. Profile: natural, neon, or two-ink looks (red/cyan, magenta/green, gold/blue, black/white). Depth makes blocks bigger the closer you are. A fist stops the glitch, a pinch freezes it until you let go, a swipe bursts. Controls: Amount, Block, Speed, Spread, Profile, Depth, Overexposed, Hand.

All landmarks are smoothed with a One Euro filter, which holds points steady at rest without adding lag to fast moves. Tracking runs once per camera frame and follows each hand by position, so a hand keeps its identity when the left/right guess flickers. A shared Interaction Engine turns the points into signals (fingers, pinches, spread, speed, swipes) that effects read the same way.

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

## Updates

Magi checks for a new release when it opens, when you switch back to it, and every 30 seconds while open, and reloads itself once you're not recording, reviewing or in the tray. A push to `main` is live in about 30 seconds once GitHub Pages finishes its deploy.

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
- **Effects tray** (caret, bottom-right; or swipe up with two fingers on a trackpad, and down to close; on a phone, swipe down on the tray to close it): pick an effect and adjust its sliders. The circular arrow resets the sliders to defaults (an ASCII mode stays as chosen). Tapping the active ASCII tile switches mode. **Normal** shows the camera without an effect.
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
| Tracking | Google MediaPipe (Hand Landmarker, Face Landmarker, Image Segmenter), loaded from jsDelivr and Google's model storage the first time a tracking effect is picked. It needs a connection then; a status line on the frame says when it is loading or failed. |
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
js/effects/color-names.js  xkcd color survey names (CC0), data for Chromatic
js/tracking.js        hand and face tracking (MediaPipe, loaded on demand)
js/app.js             camera, upload, tray, capture, review, save
docs/                 PRD, design file, project guidance (v0.1)
```
