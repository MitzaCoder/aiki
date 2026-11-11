/** Keep the task reply above mobile keyboards that resize only the visual viewport, not `dvh`. */
export function taskSheetViewport(element: HTMLElement): { destroy(): void } {
	const viewport = window.visualViewport;
	if (!viewport) return { destroy() {} };
	const update = () => {
		// Leave pinch zoom alone; it must still allow panning around the sheet.
		if (viewport.scale !== 1) return;
		element.style.height = `${viewport.height}px`;
		element.style.setProperty('--task-viewport-height', `${viewport.height}px`);
		element.style.top = `${viewport.offsetTop}px`;
	};
	viewport.addEventListener('resize', update);
	viewport.addEventListener('scroll', update);
	update();
	return { destroy() {
		viewport.removeEventListener('resize', update);
		viewport.removeEventListener('scroll', update);
	} };
}
