# README image sources

The [homepage](../../../README.md) uses only these four screenshots:

| Files | Real UI shown | Size each |
| --- | --- | --- |
| `graph-light.webp`, `graph-dark.webp` | Bubble club with task clusters, relationship lines and worker/thread creatures, 1440 × 1000 | Under 60 KiB |
| `board-light.webp`, `board-dark.webp` | Task board with the earlier synthetic busy fixture, 1440 × 900 | Under 70 KiB |

The homepage icon reuses `apps/web/static/icons/icon-192.png` directly. The graph pair uses quality-88 WebP; the unchanged board pair uses lossless WebP. There is no externally hosted image, animation or additional copied logo.

All product content is synthetic. Captures use the real web client and the [task graph demo seed](../../../packages/server/scripts/task-graph-demo.ts) with its default 25-task bubble scenario. The unchanged board images used the earlier busy scenario. That seed starts the server only through `createSetup` in `packages/server/test/support.ts`, allocates fresh temporary data/config/agent/Claude directories, and prints its data/config/project paths and PID before use. The faux provider never calls a model service or runs host tools. Fixture worker records drive the real client watches; they do not represent agents completing real work.

## Repeat the capture

From the repository root, install dependencies with Bun and start a dedicated Vite dev server on an unused port. Start the seed with the matching origin, for example:

```sh
GRAPH_WEB_ORIGIN=http://localhost:5187 bun packages/server/scripts/task-graph-demo.ts
```

`GRAPH_DEMO_OUTPUT` optionally selects the temporary connection-details file. Keep that file, its generated identifiers, browser storage and logs out of source. Read the printed paths to confirm isolation; never use an installed backend or a personal browser profile.

Add the scratch backend as `Synthetic studio` in a dedicated headless Chromium profile, open the demo project, then choose Tasks → expanded view → Graph. Use the default Jarvis theme, keep the projects sidebar visible and use Fit at 1440 × 1000. Capture light and dark states after finite UI transitions finish. No UI text was replaced in post-processing. The board images are unchanged from the earlier capture.

Convert the graph PNG captures:

```sh
ffmpeg -i capture.png -quality 88 capture.webp
```

Stop only the owned PIDs after capture. No installed backend data, provider credentials, live inference, native Android screenshot or physical device is involved.
