import { describe, expect, test } from 'bun:test';
import { fitQuestionDialogToViewport, questionDialogViewport } from '../src/lib/question-dialog-viewport.ts';

describe('question dialog keyboard viewport', () => {
	test('fits the normal viewport and the reduced visible area above an overlay keyboard', () => {
		expect(questionDialogViewport(844, 0)).toEqual({ height: 844, center: 422 });
		expect(questionDialogViewport(400, 0)).toEqual({ height: 400, center: 200 });
	});
	test('accounts for browser panning while a field has focus', () => {
		expect(questionDialogViewport(400, 72)).toEqual({ height: 400, center: 272 });
	});
	test('updates only dialog geometry and cleans up all viewport listeners', () => {
		const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 72 });
		const owner = Object.assign(new EventTarget(), { visualViewport: viewport, innerHeight: 844 });
		const styles = new Map<string, string>();
		const dialog = { ownerDocument: { defaultView: owner }, style: { setProperty: (key: string, value: string) => styles.set(key, value) } } as unknown as HTMLElement;
		const cleanup = fitQuestionDialogToViewport(dialog);
		expect(styles.get('--question-viewport-height')).toBe('400px');
		expect(styles.get('--question-viewport-center')).toBe('272px');
		viewport.height = 300;
		viewport.dispatchEvent(new Event('resize'));
		expect(styles.get('--question-viewport-center')).toBe('222px');
		viewport.offsetTop = 100;
		viewport.dispatchEvent(new Event('scroll'));
		expect(styles.get('--question-viewport-center')).toBe('250px');
		cleanup();
		viewport.height = 900;
		viewport.dispatchEvent(new Event('resize'));
		owner.dispatchEvent(new Event('resize'));
		expect(styles.get('--question-viewport-height')).toBe('300px');
	});
	test('falls back to layout height where visual viewport is unavailable', () => {
		const owner = Object.assign(new EventTarget(), { visualViewport: null, innerHeight: 540 });
		const styles = new Map<string, string>();
		const cleanup = fitQuestionDialogToViewport({ ownerDocument: { defaultView: owner }, style: { setProperty: (key: string, value: string) => styles.set(key, value) } } as unknown as HTMLElement);
		expect(styles.get('--question-viewport-height')).toBe('540px');
		expect(styles.get('--question-viewport-center')).toBe('270px');
		cleanup();
	});
});
