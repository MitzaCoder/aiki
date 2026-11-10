/** Framework-free client for the aiki protocol. */
export { HarnessClient } from "./client.ts";
export { TerminalSession } from "./terminal.ts";
export type { TerminalHostApi, TerminalOpenOptions, TerminalState, TerminalStatus } from "./terminal.ts";
export type {
	ClientRequest,
	ClientState,
	HarnessClientOptions,
	MemoryQuery,
	MemorySearchOptions,
	MemoryStatusSnapshot,
	PageOptions,
	ProjectChange,
	SubmitOptions,
	WorkersSnapshot,
} from "./client.ts";
export {
	activeWorkers,
	defaultsSetUnsupported,
	isCheckInMessage,
	isWorkerReport,
	isWorkerRunning,
	parseWorkerReport,
	shouldSendWorkerDefaults,
	workerSpawnedByCall,
	workerWorkspace,
} from "./workers.ts";
export type { WorkerDefaultsSupport } from "./workers.ts";
export {
	BOARD_CONFLICT_CODE,
	boardConflict,
	boardStateIsFor,
	parseTaskReference,
	withTaskReference,
	formatMinutes,
	inProgressText,
	isBoardMessage,
} from "./board.ts";
export type { BoardSnapshot } from "./board.ts";
export {
	DISK_TIGHT_FREE_SHARE,
	diskLevel,
	lowDisks,
	removableStorage,
	serverDisks,
	withoutRemoved,
} from "./storage.ts";
export type { DiskLevel, ProjectStorage, StorageCleanResult } from "./storage.ts";
export {
	ARTIFACT_URL_MIN_REFRESH_MS,
	ARTIFACT_URL_REFRESH_MARGIN_MS,
	applyArtifactChange,
	artifactMatches,
	artifactsChangedIsFor,
	artifactUrlRefreshIn,
	artifactUrlUsable,
	compareArtifactsNewestFirst,
} from "./artifacts.ts";
export type { ArtifactFilter, ArtifactUrl } from "./artifacts.ts";
export { latestScheduleRun, runHasWorker, schedulesStateIsFor } from "./schedules.ts";
export type { SchedulesSnapshot } from "./schedules.ts";
export {
	NOTIFICATION_DEVICE_STORAGE_KEY,
	NOTIFICATION_DEFAULTS_VERSION,
	migrateDefaultKinds,
	NOTIFICATION_KINDS,
	NOTIFICATION_SETTINGS_STORAGE_KEY,
	applicationServerKey,
	browserNameFromUserAgent,
	defaultDeviceSettings,
	deviceIdFromStorage,
	deviceLabel,
	deviceLabelFromUserAgent,
	deviceNameFromUserAgent,
	deviceTimezone,
	isNotificationFailure,
	isProjectMuted,
	loadDeviceSettings,
	mutedProjectEntries,
	newDeviceId,
	notificationRenotify,
	notificationUrl,
	parseDeviceSettings,
	parseNotificationPayload,
	preferencesForBackend,
	quietHoursActive,
	quietHoursSummary,
	samePublicKey,
	saveDeviceSettings,
	scheduleAnchor,
	subscriptionServerKey,
	threadAnchor,
	threadFromAnchor,
	timeOfDayIn,
	wantsKind,
	withKind,
	withMutedProject,
} from "./notifications.ts";
export type { DeviceNotificationSettings, NotificationTarget, QuietHours } from "./notifications.ts";
export { contextIsFor, contextTarget } from "./context.ts";
export type { ContextTarget } from "./context.ts";
export {
	MEMORY_CONFLICT_CODE,
	MEMORY_MATCH_END,
	MEMORY_MATCH_START,
	memoryChangedIsFor,
	memorySnippetParts,
	memoryTargetOf,
	memoryUndoConflict,
} from "./memory.ts";
export type { MemorySnippetPart, MemoryTarget } from "./memory.ts";
export {
	DEPLOY_PROBLEM_KINDS,
	SHORT_COMMIT_LENGTH,
	deployAttemptKey,
	deployProblem,
	shortCommit,
} from "./server-status.ts";
export type { DeployProblem, DeployProblemKind } from "./server-status.ts";
export {
	AHEAD_OF_PACE_RATIO,
	BEHIND_PACE_RATIO,
	SETTLED_PACE_SHARE,
	projectedUsedPercent,
	tightestWindow,
	windowElapsedShare,
	windowPace,
	windowStart,
} from "./subscription-usage.ts";
export type { PaceKind, TightestWindow, WindowPace } from "./subscription-usage.ts";
export { ClientError, errorFromResponse, errorMessage } from "./errors.ts";
export type { ClientErrorCode } from "./errors.ts";
export { backoffDelay, canRetry, DEFAULT_BACKOFF } from "./backoff.ts";
export type { BackoffOptions } from "./backoff.ts";
export { ConversationWatch } from "./watch.ts";
export type {
	ClientConnectionStatus,
	ConversationWatchOptions,
	WatchClientState,
	WatchStatus,
} from "./watch.ts";
export { defaultWebSocketFactory } from "./websocket.ts";
export type { HarnessWebSocket, WebSocketFactory } from "./websocket.ts";
export {
	backgroundThreads,
	isMainThread,
	isThreadActive,
	isThreadInput,
	parseThreadInput,
	threadField,
	threadsStateIsFor,
} from "./threads.ts";
export type { ThreadInput, ThreadsSnapshot } from "./threads.ts";
