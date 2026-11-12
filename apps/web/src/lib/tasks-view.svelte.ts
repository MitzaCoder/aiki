/**
 * The full-width Tasks view's List | Board | Graph choice, scoped per backend/project on this device and kept in `localStorage`
 * (`kanban.ts` reads and writes it). The narrow sidebar always shows the list.
 */
import { loadTasksViewMode, saveTasksViewMode, type TasksViewMode } from "./kanban.ts";
import type { TaskFilter } from "./task-relations.ts";

class TasksViewChoice {
	mode = $state<TasksViewMode>(loadTasksViewMode());

	#scope: string | undefined;

	useProject(scope: string): void {
		if (this.#scope === scope) return;
		this.#scope = scope;
		this.mode = loadTasksViewMode(undefined, scope);
	}

	set(mode: TasksViewMode): void {
		this.mode = mode;
		saveTasksViewMode(mode, undefined, this.#scope);
	}
}

export const tasksView = new TasksViewChoice();

/** Shared focus on a task and its links, until cleared or the page reloads. */
class TaskFilterChoice {
	focus = $state<string | null>(null);

	get current(): TaskFilter {
		return { focus: this.focus };
	}

	focusOn(taskId: string): void {
		this.focus = taskId;
	}

	clearFocus(): void {
		this.focus = null;
	}
}

export const taskFilter = new TaskFilterChoice();
