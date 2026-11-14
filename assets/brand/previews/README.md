# Mascot animation previews

Open `mascot-animations.html` directly, or open its T177 HTML artifact. It is
self-contained and works in an opaque-origin artifact frame. Nothing is wired
into the app. The static logo master is unchanged.

- **A · Working:** 3 s breathing bob, subtle tip-anchored stretch, delayed leaf
  sway, simultaneous eye blink every second loop.
- **B · Done:** one 1.3 s squash/hop/flutter/soft landing. Replay is explicit.
- **C · Thinking / waiting:** 3.5 s loop. The body stays still; eyes look left,
  up, right and centre with half-second holds, then blink as the leaf twitches.

Every state appears at 24, 32 and 128 px on light and #09090f, and at 26 px in
mock assistant rows matching the existing working indicator. The controls pause
motion, replay Done and switch the surrounding page theme. Reduced motion is
static, including after replay; print is static on white paper.

## Edit and regenerate

Keep geometry in `../logo.svg`, motion in `../mascot-motion.css`, and layout in
`mascot-animations.template.html`. From the repository root:

```sh
bun scripts/generate-mascot-preview.ts
bun test scripts/mascot-preview.test.ts
```

The generator writes `../mascot-motion.svg` and this HTML. It never rewrites the
static logo or app files. The SVG embeds its own CSS and defaults to Working.
Its `data-state` accepts `working`, `done`, `thinking` and `static`; Done also
uses `data-play`. `data-size="small"` reduces movement for 20–32 px footprints.
The preview prefixes gradient IDs for each inline instance.

The current web/Android indicators remain gradient orbs with a soft white glint
and active glow: 1.6 s spin while working. Web's idle orb rotates over 9 s;
Android's current chat calls animate only active orbs. The pending-work row uses
a 26 px/dp orb beside shimmering “Working…”. Web gaps are 12 px on phone and
16 px on desktop; Android uses 14 dp. Streaming reply gutters hide below
640 px/dp. The owner chooses which variant, if any, belongs in each place.
