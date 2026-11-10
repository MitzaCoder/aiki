// Generated — do not edit.
package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.protocol.*
import kotlinx.serialization.json.*

suspend fun HarnessClient.request(value: NotificationsRegisterRelayRequest, explicitNulls: Set<String> = emptySet()): NotificationsRegisterRelayResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsRegisterRelayRequest.serializer(), value).jsonObject, explicitNulls), NotificationsRegisterRelayResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsConfirmRelayRequest, explicitNulls: Set<String> = emptySet()): NotificationsConfirmRelayResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsConfirmRelayRequest.serializer(), value).jsonObject, explicitNulls), NotificationsConfirmRelayResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsSyncRelayRequest, explicitNulls: Set<String> = emptySet()): NotificationsSyncRelayResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsSyncRelayRequest.serializer(), value).jsonObject, explicitNulls), NotificationsSyncRelayResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthRenewRequest, explicitNulls: Set<String> = emptySet()): AuthRenewResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthRenewRequest.serializer(), value).jsonObject, explicitNulls), AuthRenewResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthDevicesListRequest, explicitNulls: Set<String> = emptySet()): AuthDevicesListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthDevicesListRequest.serializer(), value).jsonObject, explicitNulls), AuthDevicesListResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthDevicesRenameRequest, explicitNulls: Set<String> = emptySet()): AuthDevicesRenameResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthDevicesRenameRequest.serializer(), value).jsonObject, explicitNulls), AuthDevicesRenameResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthDevicesRevokeRequest, explicitNulls: Set<String> = emptySet()): AuthDevicesRevokeResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthDevicesRevokeRequest.serializer(), value).jsonObject, explicitNulls), AuthDevicesRevokeResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthPairingsCreateRequest, explicitNulls: Set<String> = emptySet()): AuthPairingsCreateResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthPairingsCreateRequest.serializer(), value).jsonObject, explicitNulls), AuthPairingsCreateResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthPairingsListRequest, explicitNulls: Set<String> = emptySet()): AuthPairingsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthPairingsListRequest.serializer(), value).jsonObject, explicitNulls), AuthPairingsListResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthPairingsCancelRequest, explicitNulls: Set<String> = emptySet()): AuthPairingsCancelResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthPairingsCancelRequest.serializer(), value).jsonObject, explicitNulls), AuthPairingsCancelResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthPairingsApproveRequest, explicitNulls: Set<String> = emptySet()): AuthPairingsApproveResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthPairingsApproveRequest.serializer(), value).jsonObject, explicitNulls), AuthPairingsApproveResponse.serializer()
)

suspend fun HarnessClient.request(value: AuthPairingsDenyRequest, explicitNulls: Set<String> = emptySet()): AuthPairingsDenyResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(AuthPairingsDenyRequest.serializer(), value).jsonObject, explicitNulls), AuthPairingsDenyResponse.serializer()
)

suspend fun HarnessClient.request(value: HelloRequest, explicitNulls: Set<String> = emptySet()): HelloResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(HelloRequest.serializer(), value).jsonObject, explicitNulls), HelloResponse.serializer()
)

suspend fun HarnessClient.request(value: ProjectsListRequest, explicitNulls: Set<String> = emptySet()): ProjectsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ProjectsListRequest.serializer(), value).jsonObject, explicitNulls), ProjectsListResponse.serializer()
)

suspend fun HarnessClient.request(value: FilesystemListRequest, explicitNulls: Set<String> = emptySet()): FilesystemListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(FilesystemListRequest.serializer(), value).jsonObject, explicitNulls), FilesystemListResponse.serializer()
)

suspend fun HarnessClient.request(value: FilesystemCompleteRequest, explicitNulls: Set<String> = emptySet()): FilesystemCompleteResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(FilesystemCompleteRequest.serializer(), value).jsonObject, explicitNulls), FilesystemCompleteResponse.serializer()
)

suspend fun HarnessClient.request(value: FilesystemCreateRequest, explicitNulls: Set<String> = emptySet()): FilesystemCreateResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(FilesystemCreateRequest.serializer(), value).jsonObject, explicitNulls), FilesystemCreateResponse.serializer()
)

suspend fun HarnessClient.request(value: FilesystemRenameRequest, explicitNulls: Set<String> = emptySet()): FilesystemRenameResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(FilesystemRenameRequest.serializer(), value).jsonObject, explicitNulls), FilesystemRenameResponse.serializer()
)

suspend fun HarnessClient.request(value: FilesystemDeleteRequest, explicitNulls: Set<String> = emptySet()): FilesystemDeleteResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(FilesystemDeleteRequest.serializer(), value).jsonObject, explicitNulls), FilesystemDeleteResponse.serializer()
)

suspend fun HarnessClient.request(value: ProjectsAddRequest, explicitNulls: Set<String> = emptySet()): ProjectsAddResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ProjectsAddRequest.serializer(), value).jsonObject, explicitNulls), ProjectsAddResponse.serializer()
)

suspend fun HarnessClient.request(value: ProjectsConfigureRequest, explicitNulls: Set<String> = emptySet()): ProjectsConfigureResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ProjectsConfigureRequest.serializer(), value).jsonObject, explicitNulls), ProjectsConfigureResponse.serializer()
)

suspend fun HarnessClient.request(value: ModelsListRequest, explicitNulls: Set<String> = emptySet()): ModelsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ModelsListRequest.serializer(), value).jsonObject, explicitNulls), ModelsListResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsLoginsRequest, explicitNulls: Set<String> = emptySet()): CredentialsLoginsResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsLoginsRequest.serializer(), value).jsonObject, explicitNulls), CredentialsLoginsResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsLoginStartRequest, explicitNulls: Set<String> = emptySet()): CredentialsLoginStartResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsLoginStartRequest.serializer(), value).jsonObject, explicitNulls), CredentialsLoginStartResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsLoginAnswerRequest, explicitNulls: Set<String> = emptySet()): CredentialsLoginAnswerResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsLoginAnswerRequest.serializer(), value).jsonObject, explicitNulls), CredentialsLoginAnswerResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsLoginCancelRequest, explicitNulls: Set<String> = emptySet()): CredentialsLoginCancelResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsLoginCancelRequest.serializer(), value).jsonObject, explicitNulls), CredentialsLoginCancelResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsListRequest, explicitNulls: Set<String> = emptySet()): CredentialsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsListRequest.serializer(), value).jsonObject, explicitNulls), CredentialsListResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsSetRequest, explicitNulls: Set<String> = emptySet()): CredentialsSetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsSetRequest.serializer(), value).jsonObject, explicitNulls), CredentialsSetResponse.serializer()
)

suspend fun HarnessClient.request(value: CredentialsDeleteRequest, explicitNulls: Set<String> = emptySet()): CredentialsDeleteResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CredentialsDeleteRequest.serializer(), value).jsonObject, explicitNulls), CredentialsDeleteResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationWatchRequest, explicitNulls: Set<String> = emptySet()): ConversationWatchResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationWatchRequest.serializer(), value).jsonObject, explicitNulls), ConversationWatchResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationUnwatchRequest, explicitNulls: Set<String> = emptySet()): ConversationUnwatchResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationUnwatchRequest.serializer(), value).jsonObject, explicitNulls), ConversationUnwatchResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationPageRequest, explicitNulls: Set<String> = emptySet()): ConversationPageResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationPageRequest.serializer(), value).jsonObject, explicitNulls), ConversationPageResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationSubmitRequest, explicitNulls: Set<String> = emptySet()): ConversationSubmitResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationSubmitRequest.serializer(), value).jsonObject, explicitNulls), ConversationSubmitResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationAbortRequest, explicitNulls: Set<String> = emptySet()): ConversationAbortResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationAbortRequest.serializer(), value).jsonObject, explicitNulls), ConversationAbortResponse.serializer()
)

suspend fun HarnessClient.request(value: WorkersListRequest, explicitNulls: Set<String> = emptySet()): WorkersListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(WorkersListRequest.serializer(), value).jsonObject, explicitNulls), WorkersListResponse.serializer()
)

suspend fun HarnessClient.request(value: WorkersDefaultsSetRequest, explicitNulls: Set<String> = emptySet()): WorkersDefaultsSetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(WorkersDefaultsSetRequest.serializer(), value).jsonObject, explicitNulls), WorkersDefaultsSetResponse.serializer()
)

suspend fun HarnessClient.request(value: ProjectsStorageRequest, explicitNulls: Set<String> = emptySet()): ProjectsStorageResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ProjectsStorageRequest.serializer(), value).jsonObject, explicitNulls), ProjectsStorageResponse.serializer()
)

suspend fun HarnessClient.request(value: ProjectsStorageCleanRequest, explicitNulls: Set<String> = emptySet()): ProjectsStorageCleanResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ProjectsStorageCleanRequest.serializer(), value).jsonObject, explicitNulls), ProjectsStorageCleanResponse.serializer()
)

suspend fun HarnessClient.request(value: ArtifactsListRequest, explicitNulls: Set<String> = emptySet()): ArtifactsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ArtifactsListRequest.serializer(), value).jsonObject, explicitNulls), ArtifactsListResponse.serializer()
)

suspend fun HarnessClient.request(value: ArtifactsUrlRequest, explicitNulls: Set<String> = emptySet()): ArtifactsUrlResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ArtifactsUrlRequest.serializer(), value).jsonObject, explicitNulls), ArtifactsUrlResponse.serializer()
)

suspend fun HarnessClient.request(value: ArtifactsDeleteRequest, explicitNulls: Set<String> = emptySet()): ArtifactsDeleteResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ArtifactsDeleteRequest.serializer(), value).jsonObject, explicitNulls), ArtifactsDeleteResponse.serializer()
)

suspend fun HarnessClient.request(value: ArtifactsUpdateRequest, explicitNulls: Set<String> = emptySet()): ArtifactsUpdateResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ArtifactsUpdateRequest.serializer(), value).jsonObject, explicitNulls), ArtifactsUpdateResponse.serializer()
)

suspend fun HarnessClient.request(value: ThreadsListRequest, explicitNulls: Set<String> = emptySet()): ThreadsListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ThreadsListRequest.serializer(), value).jsonObject, explicitNulls), ThreadsListResponse.serializer()
)

suspend fun HarnessClient.request(value: ThreadsStopRequest, explicitNulls: Set<String> = emptySet()): ThreadsStopResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ThreadsStopRequest.serializer(), value).jsonObject, explicitNulls), ThreadsStopResponse.serializer()
)

suspend fun HarnessClient.request(value: ThreadsArchiveRequest, explicitNulls: Set<String> = emptySet()): ThreadsArchiveResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ThreadsArchiveRequest.serializer(), value).jsonObject, explicitNulls), ThreadsArchiveResponse.serializer()
)

suspend fun HarnessClient.request(value: TerminalListRequest, explicitNulls: Set<String> = emptySet()): TerminalListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(TerminalListRequest.serializer(), value).jsonObject, explicitNulls), TerminalListResponse.serializer()
)

suspend fun HarnessClient.request(value: TerminalOpenRequest, explicitNulls: Set<String> = emptySet()): TerminalOpenResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(TerminalOpenRequest.serializer(), value).jsonObject, explicitNulls), TerminalOpenResponse.serializer()
)

suspend fun HarnessClient.request(value: TerminalResizeRequest, explicitNulls: Set<String> = emptySet()): TerminalResizeResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(TerminalResizeRequest.serializer(), value).jsonObject, explicitNulls), TerminalResizeResponse.serializer()
)

suspend fun HarnessClient.request(value: TerminalCloseRequest, explicitNulls: Set<String> = emptySet()): TerminalCloseResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(TerminalCloseRequest.serializer(), value).jsonObject, explicitNulls), TerminalCloseResponse.serializer()
)

suspend fun HarnessClient.request(value: TerminalKillRequest, explicitNulls: Set<String> = emptySet()): TerminalKillResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(TerminalKillRequest.serializer(), value).jsonObject, explicitNulls), TerminalKillResponse.serializer()
)

suspend fun HarnessClient.request(value: DraftsGetRequest, explicitNulls: Set<String> = emptySet()): DraftsGetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(DraftsGetRequest.serializer(), value).jsonObject, explicitNulls), DraftsGetResponse.serializer()
)

suspend fun HarnessClient.request(value: DraftsSetRequest, explicitNulls: Set<String> = emptySet()): DraftsSetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(DraftsSetRequest.serializer(), value).jsonObject, explicitNulls), DraftsSetResponse.serializer()
)

suspend fun HarnessClient.request(value: DraftsAttachmentPutRequest, explicitNulls: Set<String> = emptySet()): DraftsAttachmentPutResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(DraftsAttachmentPutRequest.serializer(), value).jsonObject, explicitNulls), DraftsAttachmentPutResponse.serializer()
)

suspend fun HarnessClient.request(value: DraftsAttachmentGetRequest, explicitNulls: Set<String> = emptySet()): DraftsAttachmentGetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(DraftsAttachmentGetRequest.serializer(), value).jsonObject, explicitNulls), DraftsAttachmentGetResponse.serializer()
)

suspend fun HarnessClient.request(value: SubscriptionsResetRequest, explicitNulls: Set<String> = emptySet()): SubscriptionsResetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SubscriptionsResetRequest.serializer(), value).jsonObject, explicitNulls), SubscriptionsResetResponse.serializer()
)

suspend fun HarnessClient.request(value: SubscriptionsUsageRequest, explicitNulls: Set<String> = emptySet()): SubscriptionsUsageResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SubscriptionsUsageRequest.serializer(), value).jsonObject, explicitNulls), SubscriptionsUsageResponse.serializer()
)

suspend fun HarnessClient.request(value: CacheStatsRequest, explicitNulls: Set<String> = emptySet()): CacheStatsResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(CacheStatsRequest.serializer(), value).jsonObject, explicitNulls), CacheStatsResponse.serializer()
)

suspend fun HarnessClient.request(value: RefsStatusRequest, explicitNulls: Set<String> = emptySet()): RefsStatusResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(RefsStatusRequest.serializer(), value).jsonObject, explicitNulls), RefsStatusResponse.serializer()
)

suspend fun HarnessClient.request(value: RefsDetailsRequest, explicitNulls: Set<String> = emptySet()): RefsDetailsResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(RefsDetailsRequest.serializer(), value).jsonObject, explicitNulls), RefsDetailsResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardGetRequest, explicitNulls: Set<String> = emptySet()): BoardGetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardGetRequest.serializer(), value).jsonObject, explicitNulls), BoardGetResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardTaskSaveRequest, explicitNulls: Set<String> = emptySet()): BoardTaskSaveResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardTaskSaveRequest.serializer(), value).jsonObject, explicitNulls), BoardTaskSaveResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardTasksReorderRequest, explicitNulls: Set<String> = emptySet()): BoardTasksReorderResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardTasksReorderRequest.serializer(), value).jsonObject, explicitNulls), BoardTasksReorderResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardQuestionAnswerRequest, explicitNulls: Set<String> = emptySet()): BoardQuestionAnswerResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardQuestionAnswerRequest.serializer(), value).jsonObject, explicitNulls), BoardQuestionAnswerResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardTaskHistoryRequest, explicitNulls: Set<String> = emptySet()): BoardTaskHistoryResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardTaskHistoryRequest.serializer(), value).jsonObject, explicitNulls), BoardTaskHistoryResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardTaskTimelineRequest, explicitNulls: Set<String> = emptySet()): BoardTaskTimelineResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardTaskTimelineRequest.serializer(), value).jsonObject, explicitNulls), BoardTaskTimelineResponse.serializer()
)

suspend fun HarnessClient.request(value: BoardFeedbackSetRequest, explicitNulls: Set<String> = emptySet()): BoardFeedbackSetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(BoardFeedbackSetRequest.serializer(), value).jsonObject, explicitNulls), BoardFeedbackSetResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsConfigRequest, explicitNulls: Set<String> = emptySet()): NotificationsConfigResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsConfigRequest.serializer(), value).jsonObject, explicitNulls), NotificationsConfigResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsRegisterRequest, explicitNulls: Set<String> = emptySet()): NotificationsRegisterResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsRegisterRequest.serializer(), value).jsonObject, explicitNulls), NotificationsRegisterResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsRegisterFcmRequest, explicitNulls: Set<String> = emptySet()): NotificationsRegisterFcmResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsRegisterFcmRequest.serializer(), value).jsonObject, explicitNulls), NotificationsRegisterFcmResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsUnregisterRequest, explicitNulls: Set<String> = emptySet()): NotificationsUnregisterResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsUnregisterRequest.serializer(), value).jsonObject, explicitNulls), NotificationsUnregisterResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsDeviceRequest, explicitNulls: Set<String> = emptySet()): NotificationsDeviceResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsDeviceRequest.serializer(), value).jsonObject, explicitNulls), NotificationsDeviceResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsTestRequest, explicitNulls: Set<String> = emptySet()): NotificationsTestResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsTestRequest.serializer(), value).jsonObject, explicitNulls), NotificationsTestResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsInteractionRequest, explicitNulls: Set<String> = emptySet()): NotificationsInteractionResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsInteractionRequest.serializer(), value).jsonObject, explicitNulls), NotificationsInteractionResponse.serializer()
)

suspend fun HarnessClient.request(value: NotificationsPresenceRequest, explicitNulls: Set<String> = emptySet()): NotificationsPresenceResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(NotificationsPresenceRequest.serializer(), value).jsonObject, explicitNulls), NotificationsPresenceResponse.serializer()
)

suspend fun HarnessClient.request(value: SchedulesListRequest, explicitNulls: Set<String> = emptySet()): SchedulesListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SchedulesListRequest.serializer(), value).jsonObject, explicitNulls), SchedulesListResponse.serializer()
)

suspend fun HarnessClient.request(value: SchedulesSaveRequest, explicitNulls: Set<String> = emptySet()): SchedulesSaveResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SchedulesSaveRequest.serializer(), value).jsonObject, explicitNulls), SchedulesSaveResponse.serializer()
)

suspend fun HarnessClient.request(value: SchedulesDeleteRequest, explicitNulls: Set<String> = emptySet()): SchedulesDeleteResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SchedulesDeleteRequest.serializer(), value).jsonObject, explicitNulls), SchedulesDeleteResponse.serializer()
)

suspend fun HarnessClient.request(value: SchedulesRunRequest, explicitNulls: Set<String> = emptySet()): SchedulesRunResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(SchedulesRunRequest.serializer(), value).jsonObject, explicitNulls), SchedulesRunResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationCompactRequest, explicitNulls: Set<String> = emptySet()): ConversationCompactResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationCompactRequest.serializer(), value).jsonObject, explicitNulls), ConversationCompactResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationWithdrawRequest, explicitNulls: Set<String> = emptySet()): ConversationWithdrawResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationWithdrawRequest.serializer(), value).jsonObject, explicitNulls), ConversationWithdrawResponse.serializer()
)

suspend fun HarnessClient.request(value: ConversationContextRequest, explicitNulls: Set<String> = emptySet()): ConversationContextResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ConversationContextRequest.serializer(), value).jsonObject, explicitNulls), ConversationContextResponse.serializer()
)

suspend fun HarnessClient.request(value: ServerStatusRequest, explicitNulls: Set<String> = emptySet()): ServerStatusResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ServerStatusRequest.serializer(), value).jsonObject, explicitNulls), ServerStatusResponse.serializer()
)

suspend fun HarnessClient.request(value: ServerDrainRequest, explicitNulls: Set<String> = emptySet()): ServerDrainResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(ServerDrainRequest.serializer(), value).jsonObject, explicitNulls), ServerDrainResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryUndoRequest, explicitNulls: Set<String> = emptySet()): MemoryUndoResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryUndoRequest.serializer(), value).jsonObject, explicitNulls), MemoryUndoResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryStatusRequest, explicitNulls: Set<String> = emptySet()): MemoryStatusResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryStatusRequest.serializer(), value).jsonObject, explicitNulls), MemoryStatusResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryMaintainRequest, explicitNulls: Set<String> = emptySet()): MemoryMaintainResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryMaintainRequest.serializer(), value).jsonObject, explicitNulls), MemoryMaintainResponse.serializer()
)

suspend fun HarnessClient.request(value: MemorySettingsSetRequest, explicitNulls: Set<String> = emptySet()): MemorySettingsSetResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemorySettingsSetRequest.serializer(), value).jsonObject, explicitNulls), MemorySettingsSetResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryListRequest, explicitNulls: Set<String> = emptySet()): MemoryListResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryListRequest.serializer(), value).jsonObject, explicitNulls), MemoryListResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryReadRequest, explicitNulls: Set<String> = emptySet()): MemoryReadResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryReadRequest.serializer(), value).jsonObject, explicitNulls), MemoryReadResponse.serializer()
)

suspend fun HarnessClient.request(value: MemorySearchRequest, explicitNulls: Set<String> = emptySet()): MemorySearchResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemorySearchRequest.serializer(), value).jsonObject, explicitNulls), MemorySearchResponse.serializer()
)

suspend fun HarnessClient.request(value: MemoryHistoryRequest, explicitNulls: Set<String> = emptySet()): MemoryHistoryResponse = exchange(
    value.id, withExplicitNulls(wireJson.encodeToJsonElement(MemoryHistoryRequest.serializer(), value).jsonObject, explicitNulls), MemoryHistoryResponse.serializer()
)
