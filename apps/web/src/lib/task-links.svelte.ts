/**
 * What the chat's components need to name a task: whether it is on the board, its title, where it opens. A screen
 * that has the board offers them with `provideTaskLinks`; without them (a worker's transcript, a server without the
 * `task-reports` feature) the chat shows no task links and every line still reads on its own.
 */
import { getContext, setContext } from "svelte";
import type { BoardTaskStatus } from "@kemiri/protocol";
import { taskHref } from "./task-chat.ts";

export type TaskLinks = {
	/** The title of a task on the board; undefined for a task the board does not hold (or has not loaded). */
	title: (taskId: string) => string | undefined;
	/** The status of a task on the board, so its chip wears the same colour as its row. */
	status: (taskId: string) => BoardTaskStatus | undefined;
	href: (taskId: string) => string;
};

const KEY = Symbol("task-links");

export function provideTaskLinks(links: () => TaskLinks | undefined): void {
	setContext(KEY, links);
}

/** Call while a component initialises; the returned function reads the links as they change (undefined outside a screen that offers them). */
export function useTaskLinks(): () => TaskLinks | undefined {
	return getContext<(() => TaskLinks | undefined) | undefined>(KEY) ?? (() => undefined);
}

export function boardTaskLinks(
	tasks: () => readonly { id: string; title: string; status: BoardTaskStatus }[],
): TaskLinks {
	return {
		title: (taskId) => tasks().find((task) => task.id === taskId)?.title,
		status: (taskId) => tasks().find((task) => task.id === taskId)?.status,
		href: taskHref,
	};
}
