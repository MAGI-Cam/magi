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

- **Landmarks**: the 21-point skeleton per hand. Switches: Readouts (handedness, score, rotation), Pinch (thumb–index distance over palm length), Distance (between two hands), Fingers (gaps between neighboring fingertips), Pairs (matching fingertips of your two hands), Signals (what MAGI reads from each hand: finger count, curl, spread, pinches, speed, the last swipe, flick or shake). Modes (tap the tile): Skeleton (those switches), Controller (a circle spans thumb and index and slides along a ruler printing its value; an outline while the hand is open, filling as you pinch up to the Opacity slider; with only the index up it shrinks to a pointer dot; a second hand gets its own circle, value and ring stack; rings swell with openness; a node map redraws the hand small with fingertip trails as smooth curves in an eased frame; a sample-and-hold graph scrolls the value down as a staircase), Contour (points gather on the outlines of your hands and arms where the picture's edges are strongest, shown as dots with raw readouts, a looping nearest-neighbor path, or that path filled as a flat lime shape; a pinch steps through them), Filaments (bundles of glowing strands strung along your bones, between fingertips and across both hands, flexing as you move, with pulses running along them), Attention (your image library as a Mapper graph from topological data analysis: images that look alike gather into linked nodes; point to select a node and fan out its images, fist to pull the graph in, open palm to spread it; View switches to a PCA map; Feed takes a JSON feed or Are.na channel, grouping by the feed's embeddings when present and by color otherwise; camera snapshots stand in without a feed), Sequencer (three rings of Euclidean rhythms; grip and turn like a knob to change a ring's number of events: thumb and index out for red, add the middle finger for yellow, all five for blue; close your hand to randomize where events sit; Tempo, and Sound for kick, snare and hi-hat, recorded into videos), Rabinovich (thousands of points riding the Rabinovich–Fabrikant equations, integrated with RK4; open thumb and index to raise α from 0.1 to 1.3 and reshape the attractor, turn your hand to turn it; two hands get an attractor each; Strength sets how bright the trails are; the equations and α read on screen), Cohesion (a chord diagram of the 21 landmarks: pairs close together are joined, so a fist fills the circle and spread fingers thin it, with the hand's cohesion level and its history; two hands put all 42 landmarks on the circle, chords across the hands in white), Pollinate (concepts orbit in a spiral galaxy; point and a small pad follows your hand, your fingertip's place on it picks two concepts, and holding still pollinates them into "A + B = ?" and an idea from a seeded grammar that decodes on screen, marking the cell in red; fist clears the marks, open palm spins the galaxy) and Link (a line between both index fingertips with its distance at a green midpoint, h1/h2 tags and a radial scope of the fingertips around each palm).
- **Font**: a gestural font editor after the reference. A letter traced from a typeface (marching squares) is drawn as a dotted outline in an A–Z dial, inside a straight-edged envelope (the letter grown and simplified with Douglas–Peucker). Grip it like a knob and turn your hand: thumb and index out (an L) picks the letter; thumb, index and middle out sets Distortion (a smooth warp field); all five out sets Smoothness (Taubin smoothing). Controls: Letter, Distortion, Smoothness, Face (Literata by default, Bodoni, Inter, Silkscreen, VT323), Dim, Guide (the three grips on screen).
- **Line Art**: one continuous line drawn around your hands: points gather on the outlines of your hands and arms (Sobel edge strength, sampled in proportion), and a nearest-neighbor tour runs through them, redrawn as you move; a pinch freezes it. Close your palm to shrink the drawing and open it to expand. Controls: Size (the drawing's scale around each hand), Thickness, Texture (a layered dry brush), Spikiness (rounded curves through straight lines to sharp spikes), Rate, Points, Color, Dim, Connect (one line through both hands with strands between matching fingertips; off, a line per hand).
- **Particles**: a particle spring system. Every particle sits on a damped spring to its resting place (a = −k(x − x₀) − cv); your fingertips push particles away as they pass and the field springs back, moving particles lighting up in streaks. The field fills the whole screen; type into Text (any characters, any keyboard) and the particles form that text. Hide (on) shows only the particles your hand moves. Controls: Count, Stiffness, Damping, Push, Reach, Color, Glow, Dim, Hide, Pointer (red dot on the index fingertip), Text.
- **Particle Life**: colored particles that like or dislike each other by a hidden random table (Ventrella's Clusters; F(r) = r/β − 1 up close, then a tent of strength A[i][j]), organizing into cells and worms. Hold up 1–5 fingers to pick a color, pinch to turn nearby particles that color, point to pull, fist to scatter, clap for a new world. Modes: Worms and Glow (the worms as additive neon light, with a halo and a white-hot core). Controls: Count, Types, Radius, Force, Friction, Trail, Thickness, Glow, Dim.
- **Exhale**: spheres of particles that breathe with your hands. Each particle springs toward the breath at its own pace, so exhales bloom bristled. Open palm exhales; a fist inhales all the way and the sphere implodes into a bright core, blooming back out when you open. Two hands get a sphere each; the two pull on each other by gravity (a = G/d²) and merge into one when their shells touch, splitting again when you pull your hands apart. Pinch: the particles stream to the pinch, burst outward when they reach it and fall back into the sphere. Brush your hand across it to spin it like a ball, roll your hand to turn it, swipe to fling it; with no hand it breathes on its own (Rate). Controls: Count, Size, Bristles, Rate, Speed, Color, Dim.
- **Pinch Frame**: modes Acid, Thermal, Invert and Blur: make an L with thumb and index finger on both hands; the four fingertips span a window where the camera shows in false color (Bands, default 1, and Speed) or blurred (Blur; Frosted for frosted glass, Mosaic for glass blocks blurred one by one); Line outlines the window, or each print sheet; Border sets Print's white paper margin (off: full bleed).
  - *Print*: hold a printed sheet by its corners (index fingers top, thumbs bottom); twist and it folds, and a side that turns over shows the back (riso Blue and Yellow front, Bright Red halftone back). Sheets: 1 is this folding print; 2–4 give each finger its own sheet (index, middle, ring, pinky) in overprinting riso inks. Controls: Sheets, Dots, Grain, Shift.
  - *Code*: pinch with both hands to span a box read out as a 1-bit code (barcode bars when thin, a blocky image when tall), with guide lines and coordinates. Lock on: corners stay where you let go, and a fist frees that hand's corner to follow it until your next pinch; Lock off: the box follows your pinches. Outside codes everything but the box; Solid fills the area with one flat color instead. Controls: Cells, Color, Lock, Outside, Solid.
  - Skeleton draws the tracked hands (off at start).
- **Wisp**: moving your fingers stirs the video like smoke: the picture itself swirls, drags and curls where your hand passed, then settles back; pinch to suck it back to normal quickly. A real 2D fluid (Stam's Stable Fluids on the GPU, with vorticity confinement) carries a map of where each pixel's image comes from. A still hand does nothing. Needs WebGL2. Controls: Trail, Flow, Swirl, Rise. Watercolor mode (tap the tile): the same flow carries pigment instead of the picture, painted on paper as an abstract painting. Colors mix subtractively like glazes (Beer–Lambert), pool darker at their edges (edge darkening) and granulate with the paper. Colors runs continuously (0 the camera's own colors, then 23 palettes blended between neighbors: Rothko, Indigo, Spring, Sunset, Earth, Water Lilies, Great Wave, Gold Leaf, Cutouts, Stain, Neon, Ocean, Forest, Desert, Sumi, Fauve, Klein, Candy, Ember, Aurora, Pop, Lagoon, Blossom), its name shown briefly; pinching moves the colors on, twice as fast with two hands; Watercolor has its own Trail, Flow and Swirl (0, 0, 30 to start); Edges sets the pooling; Dark paints on black paper instead of white; 
- **Bubbles**: soap bubbles from your hands. Wave your fingers to stream them; pinch thumb and index and a bubble grows at your fingertips while you hold, floating off when you let go. Modes: Soap (lit like a real soap film: thin-film interference colors and a Fresnel rim), Inverse (each bubble inverts the video under it, with a crisp rim) and Electrokinetic (inside each bubble the video becomes dot glazing, dots sized by brightness). A bubble pops when its life runs out (2–5 s) or, with Pop on, when a fingertip touches it. Controls: Amount, Size, Float, Wind, Wand, Pop, Skeleton.
- **Web**: a digital spiderweb strung between your fingers, from the same lines Landmarks measures: palm to fingertips, fingertip to fingertip, matching fingertips across both hands, with rings like an orb web. Threads are Verlet ropes pinned to your fingers, so they sag and swing. A pinch draws a taut thumb–index thread, and letting go plucks the web. Flick and the web lets go of your fingers and floats away while a new one forms. Make the web-shooter sign (index and pinky out, middle and ring folded) and flick to throw a web line along your index finger: it sticks at the frame's edge with a small splat web, holds to your palm, and snaps back if you pull too far (up to five). Particles flow along the threads at an even speed, fading in and out at the ends. Controls: Rings, Sag, Particles, Glow, Color.
- **Claw**: the hand as a 3D armature. Every chain starts at one root in the palm; each link is a slender octahedral bone (widest a third of the way along, like a crystal) built in 3D from MediaPipe's depth, so the rig turns with your hand, drawn slightly ahead of the last detection (extrapolated by each joint's velocity) so it keeps up. The last segment of each finger is a hollow 3D wireframe cylinder about a finger wide instead of a bone; thin talons leave from its front to a small crosshair (and retract as the finger curls), HUD brackets orbit the palm, and everything glows. Controls: Talons, Size, X and Y (move the rig away from your hand), Glow, Glyphs, Color.
- **Fluid Cube**: a wireframe cube of particle fluid (Clavet et al. 2005 double density relaxation) that floats at your index fingertip and turns with your hand in 3D; bring the hand closer and it grows. With two hands it moves to whichever index fingertip comes clearly closer, gliding over. Gravity stays screen-down, so turning it pours the fluid. Flick to throw the fluid, shake to churn it. Each particle is drawn as a cluster of tiny glowing specks, with on-screen readouts like the reference. Controls: Size, Particles, Gravity, Viscosity, Orbit (keeps it turning), Spin, Color, Cube, Glow, Readouts.
- **Accordion**: a bellows of colored panels between your palms that unfolds as you pull apart and folds to two as you come together. The gradient starts at your left hand. Bring one hand clearly closer to the camera and the bellows stretches in depth toward it; roll your palms to tilt the panels; pinch and hold to drift the color (twice as fast with both hands pinching; the Color slider follows). Controls: Panels, Waist, Size, Color, Spread, Opacity, Outline, Line (off at start).
- **Tutting**: a volume of image tiles in the box between your palms; side by side it's a slab, one above the other a column, and it holds its shape when your hands come together. Flick a hand down or up (a quick snap is enough) and that side of the volume turns over like a Rubik's cube layer. Modes: Scatter (pieces of the room), Behind (what's behind each tile). Controls: Tiles, Size, Fan, Depth, Drift, Squish (packs the tiles closer together), Dim, Edges.
- **Chromatic**: the 949 names of the xkcd color survey (public domain), each placed at its color in Lab (perceptual), HSL or RGB space. The space is untethered: it stays put until you move it. Point to select the nearest color (highlighted with its hex); pinch and drag to turn it about its vertical and horizontal axes (it keeps turning when you let go; pinching on a color selects it too); open and close your second hand's thumb and index to zoom; swipe left or right to fling a spin, up or down for the next space (Lab, HSL, RGB). Controls: Size, Labels, Text, Spin, Dim, Squares, Axes.
- **Tendrils**: moving fingertips release particles that follow a curl-noise flow (the curl of a moving stream function, so it swirls without sources or sinks); each draws a thread through its recent path that tapers to a fine tail. Modes: Neon (colored tubes with a white-hot core and bloom) and Silk (fine pale threads). Pinch to pull them in; make a fist and open it for a burst from the palm. Controls: Count, Curl, Length, Glow, Color.
- **Cards**: a collection of images built into 3D structures: Ribbon (a fanned deck along a wave), Ring, or Lattice (a grid joined by a lime node graph). Make an L with thumb and index: the line between them is a zoom/rotate handle (turn it to turn the structure, open or close it to zoom, relative to where the L started); pinch and drag to tip and turn it; swipe to switch structure. The structure stays as you leave it, and a lime widget above it (a line, a ring of nodes or a cube graph) shows the structure. Images come from a feed you paste in Advanced: a JSON feed URL or a public Are.na channel (images must be served with CORS; others are skipped). Without a feed, the cards are snapshots of the camera. Inset puts the camera in a small window with a lime title bar over a flat background. Controls: Count, Size, Spin, Inset, Color, Text, Feed.
- **Mosh**: real datamoshing. Block motion vectors are measured with three-step search and applied, uncorrected, to a picture that never refreshes, inside the zone between thumb and index finger. Pinch to snap it clean. Controls: Scale (vector strength), Block (macroblock size), Hold (how long the smear lasts before it unwinds block by block, newest first), Reach (zone size).
- **Mosh 2.0**: real datamoshing over the whole picture. Pinch and the keyframes stop: each new frame's motion vectors (three-step block matching, as codecs do) keep moving the pixels of a picture that is gone, so it melts along the motion. Open your hand for a fresh keyframe. Swipe for Bloom, P-frame duplication: the same vectors repeat and the moving part balloons in the swipe's direction. Controls: Block, Scale, Bloom, Residual (how much real correction gets through), Keyframes (a clean picture every 1–10 s), Hand (off: always moshing).

**Face Tracking** (MediaPipe Face Landmarker: 478 points, 52 blendshapes, head pose)

- **Landmarks**: the full mesh with eye, iris, brow, lip and face-oval contours, head yaw/pitch/roll and the strongest expressions.
- **Token Cry**: your text (any language, emoji) pours from your lower eyelids along your face's own "down", following head movement. Tokens are Verlet-physics bodies: a symbol is a circle, a phrase a rigid stick, so they tumble, bounce slightly and pile up like objects in a jar. Controls: Text, Speed, Scale (relative to your eyes), Phrase (whole phrase per tear, or one symbol at a time), Pool (pile up, or fall through), Color.
- **Collage** (face and hand): a "source" box sits on your right eye; while your hand is up, numbered snapshots of your eyes, mouth and nose fill a sphere around your head. Pinch to size it, spread your fingers to space the copies. With your palm square to the camera nothing turns; turn your hand and hold, and the sphere keeps orbiting that way. Lower your hand and they fly back. Modes: Eye (every snapshot is your right eye) and Features (eye, eye, mouth, nose in turn). Controls: Rate, Count (3–100, default 12), Size, X and Y (move the palm's wireframe sphere), Sphere (show it), Mosaic (the camera behind in flat blocks; the snapshots stay sharp), Mono (how gray, with film grain).

**Body Tracking** (MediaPipe Image Segmenter, selfie model: a mask of where a person is)

- **Word Box** (body): your body filled with characters strung together by red threads, above a wireframe box. The characters hold their places on your body, head to toe, and move with you, and a share ride your hands (Hands); turning your hand turns the whole structure in depth. Text takes any keyboard (Japanese, Chinese, Korean, Arabic, emoji), split into whole characters; empty, Set picks Hiragana, Kanji, Latin, Hangul, Digits or Emoji (swipe to change). Spread thumb and index to zoom in, open palm loosens the figure, fist pulls it tight, turning your hand turns the box. Controls: Text, Set, Points, Links, Size, Hands, Zoom (how far the pinch-spread zooms), Rotation (how much a hand turn rotates), Glow, Box, Dim.
- **Glitch**: your whole body breaks up like corrupted video, only inside your outline. Modes: Split (two seams cross at your hand; each tile slips and splits its colors, with soft seams and edges and the photo still visible), Blocks (macroblocks decode as their mean color, copy from the wrong place, or swap channels; Overexposed adds blown-out 1-bit blocks), Dissolve (pieces of you land in the wrong place, up to Spread away; missing pieces decode as random bits). In Blocks and Dissolve, raise your hand to glitch harder. Profile: natural, neon, or two-ink looks (red/cyan, magenta/green, gold/blue, black/white). Depth makes blocks bigger the closer you are. A fist stops the glitch, a pinch freezes it until you let go, a swipe bursts. Controls: Amount, Block, Speed, Spread, Profile, Depth, Overexposed, Hand.

All landmarks are smoothed with a One Euro filter, which holds points steady at rest without adding lag to fast moves. Tracking runs once per camera frame and follows each hand by position, so a hand keeps its identity when the left/right guess flickers. A shared Interaction Engine turns the points into signals (fingers, pinches, spread, speed, swipes) that effects read the same way.

**Facade**: the camera is the sun behind an adaptive building envelope. Every module reads the light (Interactive: motion) behind it and moves with first-order lag, a → a* with time constant τ. Controls: Scale, Response, Speed, Shade (on: close against bright light; off: open toward it).

- *Interactive*: pivoting louvers that turn face-on where something moves. Opacity fades them over the camera; Saturation and Color tint them.
- *Electrokinetic*: pixel glazing; colored particles spread over each pixel, area ∝ signal. Modes: Circle, Square, Hexagon, Triangle, Diamond. Saturation scales the image's color saturation and Color rotates its hues. Shapes are anti-aliased and placed to the quarter pixel.
- *Quadtree*: quadtree × bokeh. A lens blur (thin-lens circle of confusion) keeps you in focus and blurs the room, using the body segmenter; pinch to move focus to what's under your pinch (blur also grows with distance from it), make a fist to return it to you. Then a quadtree splits squares while their brightness varies, readily in focus and only at strong edges out of focus, so what's sharp breaks into fine cells that keep the picture and the bokeh becomes big flat squares of its average color, outlined by faint lines. Controls: Detail, Min, Max, Blur, Lines, Color.

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
- **Camera menu** (bottom-right, shown when more than one camera is connected): pick a camera by name. MAGI remembers it, switches to a camera you plug in, and falls back to the default when one is unplugged. On phones, **double-tap the preview** to flip between front and back cameras.
- **Microphone** (bottom-right, video mode): off by default; turn it on to record sound with the video. MAGI asks for the microphone the first time.
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
