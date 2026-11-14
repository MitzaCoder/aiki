/** Preview-only derivative. Never rewrites the static brand master or app components. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const master = await readFile(`${root}assets/brand/logo.svg`, "utf8");
const motion = await readFile(`${root}assets/brand/mascot-motion.css`, "utf8");
const template = await readFile(`${root}assets/brand/previews/mascot-animations.template.html`, "utf8");
const definitions = /<defs>[\s\S]*?<\/defs>/.exec(master)?.[0];
const paths = [...master.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)].map((match) => ({ fill: match[1]!, d: match[2]!, xml: match[0] }));
if (!definitions || paths.length !== 6) throw new Error("Review the mascot grouping after editing the master");
const face = paths[5]!;
const contours = face.d.match(/M[^M]+Z/g);
if (!contours || contours.length !== 3) throw new Error("Expected two eyes and a mouth");
const eye = (index: number, side: string) => `<g class="mascot-eye mascot-eye-${side}"><path fill="${face.fill}" d="${contours[index]}"/></g>`;
const geometry = `${definitions}\n<g class="mascot-pose">\n  <g class="mascot-leaf">${paths[0]!.xml}${paths[1]!.xml}</g>\n  <g class="mascot-body">${paths.slice(2, 5).map((path) => path.xml).join("")}\n    <g class="mascot-eyes-gaze">${eye(0, "left")}${eye(1, "right")}</g>\n    <path class="mascot-mouth" fill="${face.fill}" d="${contours[2]}"/>\n  </g>\n</g>`;
function svg(state: string, size: number, prefix: string, embedStyle = false) {
	const unique = geometry.replace(/id="([^"]+)"/g, `id="${prefix}-$1"`).replace(/url\(#([^)]*)\)/g, `url(#${prefix}-$1)`);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="122 115 780 780" fill="none" width="${size}" height="${size}" class="mascot-motion" data-state="${state}"${size <= 32 ? ' data-size="small"' : ""}${state === "done" ? " data-play" : ""} style="--size:${size}px" role="img" aria-label="Kemiri ${state} mascot">${embedStyle ? `<style>\n${motion}</style>\n` : ""}${unique}</svg>`;
}
await writeFile(`${root}assets/brand/mascot-motion.svg`, svg("working", 128, "mascot", true) + "\n");
const variants = [
	{ id: "A", state: "working", name: "Working", timing: "3 s loop", description: "A gentle breath, a delayed leaf sway. One blink every other loop." },
	{ id: "B", state: "done", name: "Done", timing: "1.3 s once", description: "Squash, a small hop, a leaf flutter. Soft landing, then still." },
	{ id: "C", state: "thinking", name: "Thinking / waiting", timing: "3.5 s loop", description: "Still body. Look left, up, right, centre. A blink and a leaf twitch." },
];
const cards = variants.map((variant) => `<article class="motion-card" aria-labelledby="variant-${variant.id}"><div class="variant-heading"><span class="tag">${variant.id} · ${variant.timing}</span><h2 id="variant-${variant.id}">${variant.name}</h2><p>${variant.description}</p></div>${["light", "dark"].map((theme) => `<div class="swatch swatch-${theme}"><p class="surface-label">${theme === "light" ? "Light surface" : "Dark · #09090f"}</p><div class="samples">${[24, 32, 128].map((size) => `<figure class="sample">${svg(variant.state, size, `${variant.id}-${theme}-${size}`)}<figcaption>${size} px</figcaption></figure>`).join("")}</div></div>`).join("")}</article>`).join("\n");
function mock(theme: string) {
	return `<article class="swatch swatch-${theme}" aria-label="${theme} mock assistant chat"><p class="surface-label">${theme === "light" ? "Light" : "Dark"} · assistant chat mock · 26 px</p><p class="user-message">Check the last change and tell me what needs attention.</p><div class="assistant-row"><span class="current-orb" aria-hidden="true"></span><span class="working-label">Working…</span><span class="row-caption">Current orb</span></div>${variants.map((variant) => `<div class="assistant-row">${svg(variant.state, 26, `chat-${theme}-${variant.id}`)}<span class="${variant.state === "working" ? "working-label" : "state-label"}">${variant.state === "working" ? "Working…" : variant.state === "done" ? "Done." : "Thinking…"}</span><span class="row-caption">${variant.id} · preview</span></div>`).join("")}<p class="mock-caption">Same alignment as the existing working row. On narrower screens the gap becomes 12 px; streaming-reply gutter avatars remain a separate choice.</p></article>`;
}
const page = template.replace("{{MOTION_CSS}}", motion).replace("{{VARIANTS}}", cards).replace("{{MOCK_LIGHT}}", mock("light")).replace("{{MOCK_DARK}}", mock("dark"));
await writeFile(`${root}assets/brand/previews/mascot-animations.html`, page);
console.log("Generated preview-only mascot SVG and self-contained HTML. Static logo and app untouched.");
