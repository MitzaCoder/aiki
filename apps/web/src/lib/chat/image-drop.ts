/**
 * A Svelte action that makes a box take images: a paste of images (not of text, see `pasteIsImages`) and a drop of files
 * attach them to `images`; `onover` says while a drag with files is over the box, so it can light up. Put it on the
 * element that holds the text field, so the paste event reaches it from the field.
 */
import type { MessageImages } from "./message-images.svelte.ts";
import { dragHasFiles, imageFilesOf, pasteIsImages } from "./images.ts";

export interface ImageDropOptions {
	images: MessageImages;
	onfiles?: (files: File[]) => Promise<void>;
	/** Nothing is taken while true (the box cannot send). */
	disabled?: boolean;
	onover?: (over: boolean) => void;
}

export function imageDrop(node: HTMLElement, initial: ImageDropOptions): { update(options: ImageDropOptions): void; destroy(): void } {
	let options = initial;
	let depth = 0;

	const paste = (event: ClipboardEvent): void => {
		if (options.disabled === true) return;
		const files = Array.from(event.clipboardData?.files ?? []);
		if (options.onfiles && files.length > 0) { event.preventDefault(); void options.onfiles(files); return; }
		if (!pasteIsImages(event.clipboardData)) return;
		event.preventDefault();
		void options.images.add(imageFilesOf(event.clipboardData));
	};
	const enter = (event: DragEvent): void => {
		if (options.disabled === true || !dragHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		depth += 1;
		options.onover?.(true);
	};
	const over = (event: DragEvent): void => {
		if (options.disabled === true || !dragHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
	};
	const leave = (event: DragEvent): void => {
		if (!dragHasFiles(event.dataTransfer)) return;
		depth = Math.max(0, depth - 1);
		if (depth === 0) options.onover?.(false);
	};
	const drop = (event: DragEvent): void => {
		if (options.disabled === true || !dragHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		depth = 0;
		options.onover?.(false);
		if (options.onfiles) { void options.onfiles(Array.from(event.dataTransfer?.files ?? [])); return; }
		const files = imageFilesOf(event.dataTransfer);
		if (files.length === 0) options.images.error = "Only images can be attached";
		else void options.images.add(files);
	};

	node.addEventListener("paste", paste);
	node.addEventListener("dragenter", enter);
	node.addEventListener("dragover", over);
	node.addEventListener("dragleave", leave);
	node.addEventListener("drop", drop);
	return {
		update(next) {
			options = next;
		},
		destroy() {
			node.removeEventListener("paste", paste);
			node.removeEventListener("dragenter", enter);
			node.removeEventListener("dragover", over);
			node.removeEventListener("dragleave", leave);
			node.removeEventListener("drop", drop);
		},
	};
}
