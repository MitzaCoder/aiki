import { makeGraphFixture } from './task-graph-busy.ts';

/** Deterministic scale/overflow fixture: varied families, a 12-level chain and crowded crew/questions. */
export function makeLargeGraphFixture(count = 500) {
	if (!Number.isInteger(count) || count < 100 || count > 5000) throw new Error('Graph demo task count must be 100–5000');
	const fixture = makeGraphFixture();
	const templates = fixture.board.tasks;
	let root = 1;
	let family = 0;
	const sizes = [42, 16, 8, 25, 12];
	fixture.board.tasks = Array.from({ length: count }, (_, index) => {
		const number = index + 1;
		if (number >= root + sizes[family % sizes.length]!) { root = number; family++; }
		const slot = number - root;
		const template = templates[index % templates.length]!;
		const title = slot === 0 ? `Family ${family + 1}: ${'A carefully named release with many moving parts · '.repeat(4)}`
			: number === 3 ? `Check ${'unbroken'.repeat(45)} https://example.test/${'long-path-'.repeat(30)}`
			: `${template.title} · sample ${number}`;
		return { ...template, id: `T${number}`, title, parent: slot === 0 ? null : `T${slot <= 12 ? number - 1 : root}`,
			blockedBy: slot > 1 && slot % 5 === 0 ? [`T${number - 1}`, 'T3'] : [],
			foundWhile: slot > 2 && slot % 7 === 0 ? `T${number - 2}` : null,
			related: slot > 2 && slot % 6 === 0 ? [`T${number - 2}`] : [],
			subtaskCount: undefined, workerIds: [], order: index, ownerThreadId: 'main' };
	});
	fixture.board.questions = Array.from({ length: 36 }, (_, index) => ({ ...fixture.board.questions[0]!, id: `Q${index + 1}`, taskId: 'T3', text: `Question ${index + 1}: ${'Which sample should be checked? '.repeat(6)}` }));
	fixture.workers = Array.from({ length: 16 }, (_, index) => ({ ...fixture.workers[index % 9]!, id: index === 0 ? 'pip' : `sprout-${index}`, taskId: index < 12 ? 'T3' : `T${index + 1}` }));
	return fixture;
}
