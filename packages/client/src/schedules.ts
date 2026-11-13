/**
 * Helpers on top of the protocol's schedule types: the project a pushed list belongs to, and the newest run of a
 * schedule. Everything else (how a schedule reads, when it next runs) is the app's wording, not the wire format.
 */
import type { Schedule, ScheduleRun, SchedulesStateEvent } from "@kemiri/protocol";

/** A project's schedules and the backend's timezone, as `schedules.list` and `schedules.state` carry them. */
export type SchedulesSnapshot = {
	schedules: Schedule[];
	/** The backend's IANA timezone, e.g. "Europe/Bucharest"; every time in a schedule is read in it. */
	timezone: string;
};

/** Whether a pushed list belongs to the project this screen watches: one connection may watch several. */
export function schedulesStateIsFor(state: Pick<SchedulesStateEvent, "projectId">, projectId: string): boolean {
	return state.projectId === projectId;
}

/**
 * The newest run of a schedule, or undefined when it never ran. The server keeps the runs newest first, so this is
 * the first one; a client reads it to show what the last run did.
 */
export function latestScheduleRun(schedule: Pick<Schedule, "runs">): ScheduleRun | undefined {
	return schedule.runs[0];
}

/** Whether a run is still a worker that can be opened; a skipped or failed run has no transcript. */
export function runHasWorker(run: ScheduleRun): run is ScheduleRun & { workerId: string } {
	return run.outcome === "started" && run.workerId !== null;
}
