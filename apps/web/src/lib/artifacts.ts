/**
 * Artifact logic outside the components: labels and sizes, the kind filter, what an `artifact_save` call in the chat
 * names, and the image lightbox's zoom and pan maths.
 */
import type { Artifact, ArtifactKind } from "@kemiri/protocol";

/** The tool a thread or worker saves an artifact with. */
export const ARTIFACT_SAVE_TOOL = "artifact_save";

/** Keep same-origin capabilities relative; never rewrite a genuinely remote backend or
 * treat localhost and 127.0.0.1 as the same browser/credential origin.
 */
export function artifactBrowserUrl(url: string, pageOrigin: string): string {
	const parsed = new URL(url, pageOrigin);
	return parsed.origin === pageOrigin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
}

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["video", "image", "audio", "text", "file"];

const KIND_LABELS: Record<ArtifactKind, { one: string; many: string }> = {
	video: { one: "Video", many: "Videos" },
	image: { one: "Image", many: "Images" },
	audio: { one: "Audio", many: "Audio" },
	text: { one: "Text", many: "Text" },
	file: { one: "File", many: "Files" },
};

export function kindLabel(kind: ArtifactKind, plural = false): string {
	return plural ? KIND_LABELS[kind].many : KIND_LABELS[kind].one;
}

/** What a card calls an artifact: its title, else its file name. */
export function artifactTitle(artifact: Pick<Artifact, "title" | "name">): string {
	const title = artifact.title?.trim();
	return title === undefined || title === "" ? artifact.name : title;
}

/** Bytes as "820 B", "14 KB", "3.2 MB", "1.1 GB". */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1000) return `${Math.round(bytes)} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1000;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

/** A media length as "0:07", "12:30", "1:02:03"; empty when unknown. */
export function formatMediaDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
	const total = Math.round(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Who saved it: main, a background thread, or one of their workers. */
export function savedByLabel(artifact: Pick<Artifact, "threadId" | "workerId">): string {
	if (artifact.workerId === null) return artifact.threadId === "main" ? "Main" : `Thread ${artifact.threadId}`;
	return `Worker ${artifact.workerId} of ${artifact.threadId === "main" ? "main" : `thread ${artifact.threadId}`}`;
}

/** The kind of a file from its name alone, for an artifact the chat names before its record is read. */
export function kindFromName(name: string): ArtifactKind {
	const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
	if (["webm", "mp4", "m4v", "mov", "ogv", "mkv"].includes(extension)) return "video";
	if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].includes(extension)) return "image";
	if (["mp3", "wav", "ogg", "oga", "m4a", "flac", "opus", "aac"].includes(extension)) return "audio";
	if (["txt", "log", "md", "json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "html", "diff", "patch"].includes(extension)) {
		return "text";
	}
	return "file";
}

/** How many of each kind a list holds, in the kinds' order, leaving out the absent ones. */
export function kindCounts(artifacts: readonly Pick<Artifact, "kind">[]): { kind: ArtifactKind; count: number }[] {
	return ARTIFACT_KINDS.map((kind) => ({ kind, count: artifacts.filter((artifact) => artifact.kind === kind).length })).filter(
		(entry) => entry.count > 0,
	);
}

/** The list narrowed to one kind, or whole for `"all"`. */
export function filterByKind<T extends Pick<Artifact, "kind">>(artifacts: readonly T[], kind: ArtifactKind | "all"): readonly T[] {
	return kind === "all" ? artifacts : artifacts.filter((artifact) => artifact.kind === kind);
}

/** A list grouped by the board task each is evidence for, keeping its order; those for no task are left out. */
export function artifactsByTask<T extends Pick<Artifact, "taskId">>(artifacts: readonly T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const artifact of artifacts) {
		if (artifact.taskId === null) continue;
		const group = groups.get(artifact.taskId);
		if (group === undefined) groups.set(artifact.taskId, [artifact]);
		else group.push(artifact);
	}
	return groups;
}

/** A file name from a path, either separator. */
export function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed;
}

/** What an `artifact_save` call asked for and, once its result is in, the artifact it saved. */
export type ArtifactSaveCall = {
	artifactId: string | undefined;
	path: string | undefined;
	title: string | undefined;
	note: string | undefined;
	taskId: string | undefined;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function idIn(value: unknown): string | undefined {
	const object = record(value);
	if (object === undefined) return undefined;
	return text(record(object.artifact)?.id) ?? text(object.artifactId) ?? text(object.id);
}

/**
 * The artifact ID in a tool result: in its details or a JSON output (`artifact.id`, `artifactId`, `id`), else in its text
 * ("artifact id: a1b2", "Saved artifact a1b2 …", an ID with at least one digit).
 */
export function artifactIdFromResult(output: string | undefined, details?: unknown): string | undefined {
	const fromDetails = idIn(details);
	if (fromDetails !== undefined) return fromDetails;
	if (output === undefined) return undefined;
	const trimmed = output.trim();
	if (trimmed.startsWith("{")) {
		try {
			const fromJson = idIn(JSON.parse(trimmed));
			if (fromJson !== undefined) return fromJson;
		} catch {
			// Not JSON after all; read the text.
		}
	}
	const named = /\b(?:artifact[_ ]?id|id)\s*[:=]\s*["'`]?([A-Za-z0-9][\w-]*)/i.exec(trimmed)?.[1];
	if (named !== undefined) return named;
	return /\bartifact\s+["'`]?([A-Za-z0-9][\w-]*\d[\w-]*)/i.exec(trimmed)?.[1];
}

/** An `artifact_save` call as the chat card shows it. */
export function artifactSaveCall(call: { arguments?: unknown; output?: string; isError?: boolean; details?: unknown }): ArtifactSaveCall {
	const args = record(call.arguments) ?? {};
	return {
		artifactId: call.isError === true ? undefined : artifactIdFromResult(call.output, call.details),
		path: text(args.path),
		title: text(args.title),
		note: text(args.note),
		taskId: text(args.taskId),
	};
}

/**
 * A stand-in record for an artifact the chat names but no list read holds (older than the newest few hundred, or not
 * read yet): enough to show and play it, since its URL is asked for by ID.
 */
export function artifactFromCall(projectId: string, artifactId: string, call: ArtifactSaveCall): Artifact {
	const name = call.path === undefined ? artifactId : baseName(call.path);
	return {
		id: artifactId,
		projectId,
		name,
		title: call.title ?? null,
		note: call.note ?? null,
		kind: kindFromName(name),
		mimeType: "",
		size: -1,
		durationSeconds: null,
		threadId: "main",
		workerId: null,
		taskId: call.taskId ?? null,
		sourcePath: call.path ?? "",
		createdAt: "",
	};
}

/** Whether a text artifact is Markdown, by its type or its name, so the viewer renders it instead of showing the source. */
export function isMarkdownArtifact(artifact: Pick<Artifact, "name" | "mimeType">): boolean {
	const mimeType = artifact.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (mimeType === "text/markdown" || mimeType === "text/x-markdown") return true;
	return /\.(md|markdown|mdx)$/i.test(artifact.name);
}

/** How much of a text artifact the viewer reads; the rest is a download. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;

/** How many times a media element that failed to load asks for a fresh URL before it shows the error. */
export const MEDIA_RETRY_LIMIT = 2;

// --- the image lightbox -------------------------------------------------------------------------------------------

/** The image's scale and offset from the centre of the viewport, in screen pixels. */
export type Zoom = { scale: number; x: number; y: number };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
/** What a double click or double tap zooms to. */
export const ZOOM_STEP = 2.5;
export const ZOOM_FIT: Zoom = { scale: 1, x: 0, y: 0 };

type Size = { width: number; height: number };

/** The image's size fitted into the viewport at scale 1, never larger than its own pixels. */
export function fittedSize(natural: Size, viewport: Size): Size {
	if (natural.width <= 0 || natural.height <= 0) return { width: 0, height: 0 };
	const ratio = Math.min(viewport.width / natural.width, viewport.height / natural.height, 1);
	return { width: natural.width * ratio, height: natural.height * ratio };
}

/** The offset kept within the edges: a zoomed image can be panned until its edge meets the viewport's, no further. */
export function clampZoom(zoom: Zoom, fitted: Size, viewport: Size): Zoom {
	const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.scale));
	const limitX = Math.max(0, (fitted.width * scale - viewport.width) / 2);
	const limitY = Math.max(0, (fitted.height * scale - viewport.height) / 2);
	const clamp = (value: number, limit: number): number => Math.min(limit, Math.max(-limit, value)) || 0;
	return { scale, x: clamp(zoom.x, limitX), y: clamp(zoom.y, limitY) };
}

/**
 * Zoom to `scale` keeping the image point under `point` (screen pixels from the viewport's centre) where it is, the way
 * a wheel or a pinch should feel.
 */
export function zoomAround(zoom: Zoom, scale: number, point: { x: number; y: number }, fitted: Size, viewport: Size): Zoom {
	const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
	const ratio = next / zoom.scale;
	return clampZoom({ scale: next, x: point.x - (point.x - zoom.x) * ratio, y: point.y - (point.y - zoom.y) * ratio }, fitted, viewport);
}

/** A double click or tap: zoom in at that point, or back to fit when already zoomed. */
export function toggleZoom(zoom: Zoom, point: { x: number; y: number }, fitted: Size, viewport: Size): Zoom {
	return zoom.scale > ZOOM_MIN + 0.01 ? ZOOM_FIT : zoomAround(zoom, ZOOM_STEP, point, fitted, viewport);
}

/** The wheel's zoom factor for one event: smooth for trackpads, a fixed step for mouse notches. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
	const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
	return Math.exp(-Math.max(-100, Math.min(100, pixels)) / 300);
}

/** A swipe that should close the lightbox: mostly down, far enough, at fit. */
export function isDismissSwipe(zoom: Zoom, dx: number, dy: number): boolean {
	return zoom.scale <= ZOOM_MIN + 0.01 && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5;
}
