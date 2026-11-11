import type { BoardReportStaleRequest } from '@aiki/protocol';

/** One tap asks the agent to decide what needs rewriting; no client section or reason selection. */
export function reportUpdateRequest(projectId: string, taskId: string): Omit<BoardReportStaleRequest, 'id'> {
	return { type: 'board.report.stale', projectId, taskId };
}
