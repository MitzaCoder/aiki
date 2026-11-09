/**
 * A Svelte action that reports when its element comes near the viewport, once, so thumbnails ask for their URL only when
 * someone could see them.
 */
export function inView(node: Element, onvisible: () => void): { destroy(): void } {
	if (typeof IntersectionObserver === "undefined") {
		onvisible();
		return { destroy() {} };
	}
	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			onvisible();
		},
		{ rootMargin: "200px" },
	);
	observer.observe(node);
	return { destroy: () => observer.disconnect() };
}
