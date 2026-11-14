import type { BoardQuestion } from '@kemiri/protocol';
export type AgentMotion = 'idle' | 'working' | 'waiting' | 'done';

/** Only explicit blocking asks in this conversation count; retries, queues and warnings do not. */
export function agentWaitingForUser(questions: readonly BoardQuestion[], threadId?: string, workerTaskId?: string | null, worker = false): boolean {
	return questions.some(question => question.status === 'open'
		&& (question.blocksWork ?? question.kind !== 'warning')
		&& (question.threadId ?? 'main') === (threadId ?? 'main')
		&& (!worker || (workerTaskId != null && question.taskId === workerTaskId)));
}

/** A live tool slot still belongs to the current reply after its model message has been stored. */
export function agentTurnWorking(turn: { live?: boolean; parts: readonly { type: string; live?: boolean; streaming?: boolean }[] }, running: boolean): boolean {
	return running && (turn.live === true || turn.parts.some(part => part.live === true || part.streaming === true));
}

/** A question is the waiting cue: never append a mascot-only activity row for it. */
export function showsAgentActivityRow(waiting: boolean, working: boolean, completed: boolean): boolean {
	return !waiting && (working || completed);
}

/** Never celebrate initial history, a disconnect, a failed/stopped run or just clearing a question. */
export function agentFinished(previousRunning: boolean, running: boolean, waiting: boolean, connected: boolean, failed: boolean): boolean {
	return previousRunning && !running && !waiting && connected && !failed;
}
