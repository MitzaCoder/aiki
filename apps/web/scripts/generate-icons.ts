/**
 * Draws the app's install icons from the same look as the orb: a dark violet surface with the cyan → indigo → fuchsia →
 * orange conic gradient inside, and a white glint. No image library: the shapes are drawn by hand and encoded as PNG
 * with `node:zlib`, so the icons can be regenerated with `bun run icons` and reviewed as a diff.
 *
 *   icons/icon-192.png, icon-512.png              purpose "any" (rounded square)
 *   icons/icon-maskable-192.png, -512.png         purpose "maskable" (full bleed, mark inside the safe circle)
 *   icons/badge-96.png                            the monochrome badge Android shows in the status bar
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const icons = `${root}static/icons`;

// The jarvis theme's accents (light and dark agree on the hues) and its dark surface.
const ACCENTS = ["#22d3ee", "#818cf8", "#e879f9", "#fb923c"];
const SURFACE = "#09090f";
const GLOW = "#3b2a72";

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
	const value = Number.parseInt(hex.replace("#", ""), 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	const t = Math.min(1, Math.max(0, amount));
	return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/** The conic gradient the orb spins, sampled at an angle in turns (0 = up, clockwise). */
function conic(turn: number): Rgb {
	const stops = [...ACCENTS, ACCENTS[0] as string].map(rgb);
	const span = 1 / ACCENTS.length;
	const at = ((turn % 1) + 1) % 1;
	const index = Math.min(stops.length - 2, Math.floor(at / span));
	const fraction = (at - index * span) / span;
	return mix(stops[index] as Rgb, stops[index + 1] as Rgb, fraction);
}

function roundedSquare(x: number, y: number, size: number, radius: number): boolean {
	const inset = size * 0.02;
	const left = inset;
	const top = inset;
	const right = size - inset;
	const bottom = size - inset;
	const r = size * radius;
	if (x < left || x > right || y < top || y > bottom) return false;
	const cx = Math.min(Math.max(x, left + r), right - r);
	const cy = Math.min(Math.max(y, top + r), bottom - r);
	return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function draw(size: number, options: { maskable: boolean }): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	const surface = rgb(SURFACE);
	const glow = rgb(GLOW);
	const white: Rgb = [255, 255, 255];
	const center = size / 2;
	// A maskable icon must keep its mark inside the central 80% circle, so it shrinks a little.
	const radius = size * (options.maskable ? 0.235 : 0.3);
	const samples = 3;
	const sampleCount = samples * samples;

	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < samples; sy += 1) {
				for (let sx = 0; sx < samples; sx += 1) {
					const x = px + (sx + 0.5) / samples;
					const y = py + (sy + 0.5) / samples;
					const inside = options.maskable || roundedSquare(x, y, size, 0.22);
					if (!inside) continue;
					const dx = x - center;
					const dy = y - center;
					const distance = Math.hypot(dx, dy);
					// The surface, lifted by a soft violet glow around the mark.
					let color = mix(surface, glow, 0.55 * Math.max(0, 1 - distance / (size * 0.62)) ** 2);
					if (distance <= radius) {
						const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
						color = conic(turn);
						// The glint sits up and to the left of the orb, as in the component.
						const gx = x - (center - radius * 0.35);
						const gy = y - (center - radius * 0.3);
						const glint = Math.max(0, 1 - Math.hypot(gx, gy) / (radius * 0.95)) ** 2 * 0.8;
						color = mix(color, white, glint);
					} else if (distance <= radius * 1.18) {
						// A little halo so the mark does not end in a hard edge.
						const halo = (1 - (distance - radius) / (radius * 0.18)) * 0.45;
						const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
						color = mix(color, conic(turn), halo);
					}
					r += color[0];
					g += color[1];
					b += color[2];
					a += 255;
				}
			}
			const index = (py * size + px) * 4;
			if (a === 0) continue;
			const covered = a / 255;
			pixels[index] = Math.round(r / covered);
			pixels[index + 1] = Math.round(g / covered);
			pixels[index + 2] = Math.round(b / covered);
			pixels[index + 3] = Math.round(a / sampleCount);
		}
	}
	return pixels;
}

/** The status-bar badge: monochrome, transparent, so Android tints it. */
function drawBadge(size: number): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	const center = size / 2;
	const radius = size * 0.38;
	const samples = 3;
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			let covered = 0;
			for (let sy = 0; sy < samples; sy += 1) {
				for (let sx = 0; sx < samples; sx += 1) {
					const x = px + (sx + 0.5) / samples;
					const y = py + (sy + 0.5) / samples;
					if (Math.hypot(x - center, y - center) <= radius) covered += 1;
				}
			}
			const index = (py * size + px) * 4;
			pixels[index] = 255;
			pixels[index + 1] = 255;
			pixels[index + 2] = 255;
			pixels[index + 3] = Math.round((covered / (samples * samples)) * 255);
		}
	}
	return pixels;
}

// --- PNG encoding -----------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function png(size: number, pixels: Uint8Array): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // truecolour with alpha
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let row = 0; row < size; row += 1) {
		raw[row * (size * 4 + 1)] = 0; // filter: none
		Buffer.from(pixels.subarray(row * size * 4, (row + 1) * size * 4)).copy(raw, row * (size * 4 + 1) + 1);
	}
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return Buffer.concat([
		signature,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", new Uint8Array()),
	]);
}

mkdirSync(icons, { recursive: true });
for (const size of [192, 512]) {
	writeFileSync(`${icons}/icon-${size}.png`, png(size, draw(size, { maskable: false })));
	writeFileSync(`${icons}/icon-maskable-${size}.png`, png(size, draw(size, { maskable: true })));
}
writeFileSync(`${icons}/badge-96.png`, png(96, drawBadge(96)));
console.log(`wrote the icons to ${icons}`);
