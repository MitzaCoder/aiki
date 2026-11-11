/** The visual viewport excludes a mobile keyboard even when the layout viewport does not resize. */
export function questionDialogViewport(height: number, offsetTop: number): { height: number; center: number } {
	return { height, center: offsetTop + height / 2 };
}

/** Fit only this dialog to the visible viewport; do not scroll or resize the underlying task sheet. */
export function fitQuestionDialogToViewport(dialog: HTMLElement): () => void {
	const owner = dialog.ownerDocument.defaultView;
	if (owner === null) return () => {};
	const viewport = owner.visualViewport;
	const update = (): void => {
		const frame = questionDialogViewport(viewport?.height ?? owner.innerHeight, viewport?.offsetTop ?? 0);
		dialog.style.setProperty('--question-viewport-height', `${frame.height}px`);
		dialog.style.setProperty('--question-viewport-center', `${frame.center}px`);
	};
	update();
	owner.addEventListener('resize', update);
	viewport?.addEventListener('resize', update);
	viewport?.addEventListener('scroll', update);
	return () => {
		owner.removeEventListener('resize', update);
		viewport?.removeEventListener('resize', update);
		viewport?.removeEventListener('scroll', update);
	};
}
