<script lang="ts">
	import { untrack } from 'svelte';
	import { taskSectionIcons } from '#lib/task-section-icons.js';
	import { taskSectionIndex, taskSectionScrollTop, taskSectionSelection, type TaskSectionKind, type TaskSectionNavigationEvent, type TaskSectionSelection } from '#lib/task-sections.js';

	let { root }: { root: HTMLDivElement | null } = $props();
	let nav = $state<HTMLElement | null>(null);
	let sections = $state<{ kind: TaskSectionKind; title: string; count?: string; element: HTMLElement }[]>([]);
	let currentKind = $state<TaskSectionKind | undefined>(undefined);
	let navigate: ((kind: TaskSectionKind, element: HTMLElement) => void) | undefined;

	// Read the rendered cards, not a second set of visibility rules. This also tracks async files/feedback counts.
	$effect(() => {
		if (!root || !nav) return;
		const scrollRoot = root;
		const navigation = nav;
		let observer: IntersectionObserver | undefined;
		let observed: HTMLElement[] = [];
		const horizontal = () => getComputedStyle(navigation.querySelector('ul')!).flexDirection === 'row';
		// Sticky chips have a negative CSS top; their full height alone would land the card too low.
		const offset = () => horizontal() ? Math.max(0, parseFloat(getComputedStyle(navigation).top) + navigation.offsetHeight) + 12 : 16;
		let selection: TaskSectionSelection = { pinned: false, scrolling: false };
		let scrollTimeout: ReturnType<typeof setTimeout> | undefined;
		function dispatch(event: TaskSectionNavigationEvent) {
			selection = taskSectionSelection(selection, event);
			currentKind = selection.kind;
		}
		function updateCurrent() {
			const viewport = scrollRoot.getBoundingClientRect();
			const line = viewport.top + offset();
			const atEnd = scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 2;
			const index = taskSectionIndex(observed.map((section) => section.getBoundingClientRect().top), line, atEnd, viewport.bottom);
			dispatch({ type: 'spy', kind: observed[index]?.dataset.taskSection as TaskSectionKind | undefined });
		}
		function finishScroll() {
			clearTimeout(scrollTimeout);
			dispatch({ type: 'scroll-end' });
		}
		function onScroll() {
			if (selection.scrolling) {
				clearTimeout(scrollTimeout);
				scrollTimeout = setTimeout(finishScroll, 200); // Browsers without scrollend; also the no-distance case.
			}
			updateCurrent();
		}
		function userScroll() {
			clearTimeout(scrollTimeout);
			dispatch({ type: 'user-scroll' });
			updateCurrent();
		}
		function onWheel(event: WheelEvent) {
			if (event.deltaY && !navigation.contains(event.target as Node)) userScroll();
		}
		function onTouch(event: TouchEvent) {
			if (!navigation.contains(event.target as Node)) userScroll();
		}
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			if ((event.target as Element).closest('input, textarea, select, [contenteditable="true"]')) return;
			if (event.key === ' ' && (event.target as Element).closest('button, a')) return;
			if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userScroll();
		}
		function onPointer(event: PointerEvent) {
			const target = event.target as Element;
			const bounds = scrollRoot.getBoundingClientRect();
			// Overlay scrollbars live beside the viewport; native scrollbars target the viewport itself.
			if (target.closest('.os-scrollbar') || (target === scrollRoot && event.clientX >= bounds.left + scrollRoot.clientWidth)) userScroll();
		}
		navigate = (kind, element) => {
			dispatch({ type: 'select', kind });
			clearTimeout(scrollTimeout);
			scrollTimeout = setTimeout(finishScroll, 250);
			scrollRoot.scrollTo({
				top: taskSectionScrollTop(scrollRoot.scrollTop, element.getBoundingClientRect().top, scrollRoot.getBoundingClientRect().top, offset(), scrollRoot.scrollHeight - scrollRoot.clientHeight),
				behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
			});
		};
		function observe() {
			navigation.style.setProperty('--task-nav-height', `${Math.max(48, scrollRoot.clientHeight - 32)}px`);
			observer?.disconnect();
			const inset = Math.min(offset(), scrollRoot.clientHeight - 1);
			observer = new IntersectionObserver(updateCurrent, {
				root: scrollRoot,
				rootMargin: `-${inset}px 0px -${Math.max(0, scrollRoot.clientHeight - inset - 1)}px 0px`,
				threshold: 0
			});
			for (const section of observed) observer.observe(section);
			updateCurrent();
		}
		function collect() {
			const cards = Array.from(scrollRoot.querySelectorAll<HTMLElement>('[data-task-section]'));
			const next = cards.map((element) => ({
				kind: element.dataset.taskSection as TaskSectionKind,
				title: element.getAttribute('aria-label')!,
				count: element.dataset.sectionNavCount,
				element
			}));
			if (next.length === sections.length && next.every((section, i) => section.element === sections[i].element && section.count === sections[i].count)) return;
			sections = next;
			observed = cards;
			observe();
		}
		untrack(collect);
		const mutations = new MutationObserver(collect);
		mutations.observe(scrollRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-section-nav-count'] });
		const resize = new ResizeObserver(observe);
		resize.observe(scrollRoot);
		resize.observe(navigation);
		// End-of-scroll detection also handles short, folded cards at the bottom.
		scrollRoot.addEventListener('scroll', onScroll, { passive: true });
		scrollRoot.addEventListener('scrollend', finishScroll);
		scrollRoot.addEventListener('wheel', onWheel, { passive: true });
		scrollRoot.addEventListener('touchstart', onTouch, { passive: true });
		scrollRoot.addEventListener('keydown', onKey);
		const frame = scrollRoot.parentElement;
		frame?.addEventListener('pointerdown', onPointer);
		return () => {
			observer?.disconnect();
			mutations.disconnect();
			resize.disconnect();
			scrollRoot.removeEventListener('scroll', onScroll);
			scrollRoot.removeEventListener('scrollend', finishScroll);
			scrollRoot.removeEventListener('wheel', onWheel);
			scrollRoot.removeEventListener('touchstart', onTouch);
			scrollRoot.removeEventListener('keydown', onKey);
			frame?.removeEventListener('pointerdown', onPointer);
			clearTimeout(scrollTimeout);
			navigate = undefined;
		};
	});

	$effect(() => {
		const kind = currentKind;
		if (!nav || !kind) return;
		const row = nav.querySelector('ul');
		const chip = nav.querySelector<HTMLElement>(`[href="#task-section-${kind}"]`);
		if (!row || !chip) return;
		if (getComputedStyle(row).flexDirection !== 'row') {
			if (chip.offsetTop < nav.scrollTop || chip.offsetTop + chip.offsetHeight > nav.scrollTop + nav.clientHeight) {
				nav.scrollTop = chip.offsetTop;
			}
			return;
		}
		// Scroll only the chip row: scrollIntoView would also move the task body.
		const left = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2;
		row.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
	});

	function goTo(event: MouseEvent, kind: TaskSectionKind, element: HTMLElement) {
		event.preventDefault();
		navigate?.(kind, element);
	}
</script>

<nav bind:this={nav} aria-label="Task sections" class="task-section-nav" data-section-nav>
	<ul class="task-section-nav-list">
		{#each sections as section (section.kind)}
			{@const Icon = taskSectionIcons[section.kind]}
			<li>
				<a href="#task-section-{section.kind}" aria-current={currentKind === section.kind ? 'location' : undefined} onclick={(event) => goTo(event, section.kind, section.element)}>
					<Icon class="size-4 shrink-0" aria-hidden="true" />
					<span>{section.title}</span>
					{#if section.count !== undefined}<span class="task-nav-count">{section.count}</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
