# README image sources

The [homepage](../../../README.md) uses only these four screenshots:

| Files | Real UI shown | Size each |
| --- | --- | --- |
| `graph-light.webp`, `graph-dark.webp` | Task graph, cropped to its 1120 × 680 viewport: family cards, needs-you/status counters, search and worker/thread creatures | Under 110 KiB |
| `board-light.webp`, `board-dark.webp` | The same project in the task board, 1440 × 900 | Under 70 KiB |

The homepage icon reuses `apps/web/static/icons/icon-192.png` directly. Both screenshot pairs use lossless WebP compression. There is no externally hosted image, animation or additional copied logo.

All product content is synthetic. Captures use the real web client and the [task graph demo seed](../../../packages/server/scripts/task-graph-demo.ts) with `GRAPH_DEMO_SCENARIO=busy`. That seed starts the server only through `createSetup` in `packages/server/test/support.ts`, allocates fresh temporary data/config/agent/Claude directories, and prints its data/config paths and PID before use. The faux provider never calls a model service or runs host tools. Fixture worker records drive the real client watches; they do not represent agents completing real work.

## Repeat the capture

From the repository root, install dependencies with Bun and start a dedicated Vite dev server on an unused port. Start the seed with the matching origin, for example:

```sh
GRAPH_WEB_ORIGIN=http://localhost:5187 GRAPH_DEMO_SCENARIO=busy bun packages/server/scripts/task-graph-demo.ts
```

`GRAPH_DEMO_OUTPUT` optionally selects the temporary connection-details file. Keep that file, its generated identifiers, browser storage and logs out of source. Read the printed paths to confirm isolation; never use an installed backend or a personal browser profile.

Add the scratch backend as `Studio` in a dedicated headless Chromium profile, open the demo project, then choose Tasks → expanded view → Graph. Use the default Jarvis theme and collapse the projects sidebar. At 1177 × 725, capture only the graph viewport. This frames three families and their creatures without a clipped fourth family. For the board, switch to Board at 1440 × 900. Capture each under light and dark colour-scheme media emulation, waiting for finite UI transitions to finish. No UI text was replaced in post-processing.

Convert the PNG captures losslessly:

```sh
ffmpeg -i capture.png -c:v libwebp -lossless 1 -compression_level 6 capture.webp
```

Stop only the owned PIDs after capture. No installed backend data, provider credentials, live inference, native Android screenshot or physical device is involved.
