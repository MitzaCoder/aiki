<script lang="ts">
	import { taskStatusToneClass, taskStatusWords } from '#lib/tasks.js';
	import type { BoardTaskStatus } from '@mihai-harness/protocol';

	/** A task's status as a pill in its own colour (see `base.css`), the same one its row's edge and its chip's dot wear. */
	let {
		status,
		class: className = ''
	}: {
		status: BoardTaskStatus;
		class?: string;
	} = $props();
</script>

<span class="task-status-badge {taskStatusToneClass(status)} {className}" data-task-status={status}>
	<span class="task-status-dot" aria-hidden="true"></span>{taskStatusWords(status)}
</span>
