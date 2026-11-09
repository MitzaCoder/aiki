/**
 * The full-width Tasks view's List | Board choice, shared by every project on this device and kept in `localStorage`
 * (`kanban.ts` reads and writes it). The narrow sidebar always shows the list.
 */
import { loadTasksViewMode, saveTasksViewMode, type TasksViewMode } from "./kanban.ts";
import { loadTopLevelOnly, saveTopLevelOnly, type TaskFilter } from "./task-relations.ts";

class TasksViewChoice {
	mode = $state<TasksViewMode>(loadTasksViewMode());

	set(mode: TasksViewMode): void {
		this.mode = mode;
		saveTasksViewMode(mode);
	}
}

export const tasksView = new TasksViewChoice();

/**
 * The filters on the task list, the board and the legacy panel, shared by all three: "only top-level tasks" is kept per
 * device, "this task and everything linked to it" (`focus`) lasts until it is cleared or the page reloads.
 */
class TaskFilterChoice {
	topLevelOnly = $state(loadTopLevelOnly());
	focus = $state<string | null>(null);

	get current(): TaskFilter {
		return { topLevelOnly: this.topLevelOnly, focus: this.focus };
	}

	setTopLevelOnly(on: boolean): void {
		this.topLevelOnly = on;
		saveTopLevelOnly(on);
	}

	focusOn(taskId: string): void {
		this.focus = taskId;
	}

	clearFocus(): void {
		this.focus = null;
	}
}

export const taskFilter = new TaskFilterChoice();
