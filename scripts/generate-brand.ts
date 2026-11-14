/** Regenerate install, browser, site and Android marks from the reviewed SVG masters. Run with Bun. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { brandChromium } from "./lib/brand-chromium.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const logo = await readFile(`${root}assets/brand/logo.svg`, "utf8");
const mono = await readFile(`${root}assets/brand/logo-mark-mono.svg`, "utf8");
const content = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
/** Centre the original 695-unit-tall drawing in a square; retain breathing room. */
function square(svg: string, height: number, background?: string): string {
	const scale = height / 695;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${background ? `<path fill="${background}" d="M0 0H512V512H0Z"/>` : ""}<g transform="translate(256 256) scale(${scale}) translate(-512 -512.5)">${content(svg)}</g></svg>`;
}
async function save(path: string, data: string | Uint8Array) {
	await mkdir(`${root}${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
	await writeFile(`${root}${path}`, data);
}
const browser = await brandChromium();
try {
	async function png(svg: string, width: number, height = width): Promise<Buffer> {
		const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		const bytes = await browser.evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(source)};await image.decode();const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};canvas.getContext('2d').drawImage(image,0,0,${width},${height});return canvas.toDataURL('image/png').split(',')[1]})()`);
		return Buffer.from(bytes, "base64");
	}
	const favicon = square(logo, 472);
	const normal = square(logo, 410, "#f0edff");
	// The entire mark fits within the central 80% diameter safe circle.
	const maskable = square(logo, 340, "#6366f1");
	for (const base of ["apps/web/static", "site/assets"]) {
		await save(`${base}/logo.svg`, logo);
		await save(`${base}/favicon.svg`, favicon);
		for (const size of [16, 32]) await save(`${base}/favicon-${size}.png`, await png(favicon, size));
		await save(`${base}/apple-touch-icon.png`, await png(normal, 180));
	}
	for (const size of [192, 512]) {
		await save(`apps/web/static/icons/icon-${size}.png`, await png(normal, size));
		await save(`apps/web/static/icons/icon-maskable-${size}.png`, await png(maskable, size));
	}
	await save("apps/web/static/icons/badge-96.png", await png(square(mono.replace("currentColor", "#fff"), 430), 96));
	await save("site/assets/icon.png", await png(normal, 192));
	const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#09090f"/><g transform="translate(-125 -7) scale(.6)">${content(logo)}</g><text x="450" y="310" fill="#faf9ff" font-family="sans-serif" font-size="106" font-weight="700">Kemiri</text><text x="455" y="382" fill="#c4bfe0" font-family="sans-serif" font-size="32">Your personal AI workbench</text></svg>`;
	await save("site/assets/og.png", await png(social, 1200, 630));
} finally { await browser.close(); }

// Android vectors use the exact master paths and linear gradients, not a raster approximation.
const gradients = new Map([...logo.matchAll(/<linearGradient id="([^"]+)" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*>([\s\S]*?)<\/linearGradient>/g)].map((match) => [match[1]!, match]));
function vector(svg: string, adaptive: boolean, mascotPart = false) {
	const paths = [...svg.matchAll(/<path fill="([^"]+)"(?: fill-rule="([^"]+)")? d="([^"]+)"\/>/g)].map((match) => {
		const fill = match[1]!;
		const gradient = gradients.get(/url\(#(.*)\)/.exec(fill)?.[1] ?? "");
		const attrs = `android:pathData="${match[3]}"${match[2] ? ' android:fillType="evenOdd"' : ""}`;
		if (!gradient) return `    <path ${attrs} android:fillColor="${fill === "currentColor" ? "#FFFFFFFF" : fill}"/>`;
		const stops = [...gradient[6]!.matchAll(/<stop(?: offset="([^"]+)")? stop-color="([^"]+)"\/>/g)];
		return `    <path ${attrs}><aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="${gradient[2]}" android:startY="${gradient[3]}" android:endX="${gradient[4]}" android:endY="${gradient[5]}">${stops.map((stop) => `<item android:offset="${stop[1] ?? "0"}" android:color="${stop[2]}"/>`).join("")}</gradient></aapt:attr></path>`;
	}).join("\n");
	// 0.088 * 695 = 61.16 dp: inside the 66 dp adaptive foreground safe zone.
	const group = mascotPart ? 'android:translateX="-122" android:translateY="-115"' : adaptive ? 'android:scaleX=".088" android:scaleY=".088" android:translateX="8.944" android:translateY="8.9"' : 'android:scaleX=".028" android:scaleY=".028" android:translateX="-2.336" android:translateY="-2.35"';
	return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from assets/brand by bun scripts/generate-brand.ts. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="${mascotPart ? 26 : adaptive ? 108 : 24}dp" android:height="${mascotPart ? 26 : adaptive ? 108 : 24}dp" android:viewportWidth="${mascotPart ? 780 : adaptive ? 108 : 24}" android:viewportHeight="${mascotPart ? 780 : adaptive ? 108 : 24}">\n  <group ${group}>\n${paths}\n  </group>\n</vector>\n`;
}
for (const [name, svg, adaptive] of [["ic_launcher_foreground", logo, true], ["ic_launcher_monochrome", mono, true], ["ic_brand", logo, false], ["ic_notification", mono, false]] as const) {
	await save(`apps/android/app/src/main/res/drawable/${name}.xml`, vector(svg, adaptive));
}
console.log("Generated Kemiri web, site and Android brand assets.");

// Shared animatable parts: preserve the master's path coordinates and gradients.
const brandPaths = [...logo.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)];
const faceContours = brandPaths[5]![2]!.match(/M[^M]+Z/g)!;
const partPaths = {
	body: brandPaths.slice(2, 5).map(match => match[0]).join(""),
	leaf: brandPaths.slice(0, 2).map(match => match[0]).join(""),
	eye_left: `<path fill="${brandPaths[5]![1]}" d="${faceContours[0]}"/>`,
	eye_right: `<path fill="${brandPaths[5]![1]}" d="${faceContours[1]}"/>`,
	mouth: `<path fill="${brandPaths[5]![1]}" d="${faceContours[2]}"/>`,
};
for (const [name, paths] of Object.entries(partPaths)) await save(`apps/android/app/src/main/res/drawable/ic_mascot_${name}.xml`, vector(`<svg>${paths}</svg>`, false, true));
const definitions = /<defs>[\s\S]*?<\/defs>/.exec(logo)![0];
const geometry = `${definitions}<g class="mascot-pose"><g class="mascot-leaf">${partPaths.leaf}</g><g class="mascot-body">${partPaths.body}<g class="mascot-eyes-gaze"><g class="mascot-eye mascot-eye-left">${partPaths.eye_left}</g><g class="mascot-eye mascot-eye-right">${partPaths.eye_right}</g></g><g class="mascot-mouth">${partPaths.mouth}</g></g></g>`
	.replace(/id="([^"]+)"/g, `id={id + '-$1'}`).replace(/fill="url\(#([^)]*)\)"/g, `fill={'url(#' + id + '-$1)'}`);
await save("apps/web/src/lib/components/mascot-motion.css", await readFile(`${root}assets/brand/mascot-motion.css`, "utf8"));
await save("apps/web/src/lib/components/AgentMascot.svelte", `<script lang="ts">\n// Generated from assets/brand by bun scripts/generate-brand.ts.\nimport './mascot-motion.css';\nimport type { AgentMotion } from '../agent-activity.js';\nlet { state = 'idle', size = 40 }: { state?: AgentMotion; size?: number } = $props();\nconst id = $props.id();\n</script>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="122 115 780 780" fill="none" width={size} height={size} class="mascot-motion shrink-0" data-state={state === 'waiting' ? 'thinking' : state} data-size={size <= 32 ? 'small' : undefined} data-play={state === 'done' ? '' : undefined} style={\`--size:\${size}px\`} aria-hidden="true">${geometry}</svg>\n`);
