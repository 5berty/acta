// Contrato de la API que usa la UI. Implementaciones: `tauri.ts` (real) y
// `mock.ts` (tests y desarrollo en navegador). Nombres de comando/evento
// idénticos a `acta_core::api::{command_names, event_names}`.

import type * as T from "./types";

export const COMMANDS = {
  sessionGetState: "session_get_state",
  sessionStart: "session_start",
  sessionPause: "session_pause",
  sessionResume: "session_resume",
  sessionStop: "session_stop",
  sessionDismiss: "session_dismiss",
  promptAnswer: "prompt_answer",
  captureManual: "capture_manual",
  meetingsList: "meetings_list",
  meetingGet: "meeting_get",
  meetingUpdate: "meeting_update",
  meetingDelete: "meeting_delete",
  meetingReprocess: "meeting_reprocess",
  speakerRename: "speaker_rename",
  actionItemSetDone: "action_item_set_done",
  captureDelete: "capture_delete",
  groupsList: "groups_list",
  groupCreate: "group_create",
  groupUpdate: "group_update",
  groupDelete: "group_delete",
  groupAddMeeting: "group_add_meeting",
  groupRemoveMeeting: "group_remove_meeting",
  groupSuggestionsList: "group_suggestions_list",
  groupSuggestionsRefresh: "group_suggestions_refresh",
  groupSuggestionAccept: "group_suggestion_accept",
  groupSuggestionDismiss: "group_suggestion_dismiss",
  search: "search",
  chatThreadsList: "chat_threads_list",
  chatThreadCreate: "chat_thread_create",
  chatThreadDelete: "chat_thread_delete",
  chatMessagesList: "chat_messages_list",
  chatSend: "chat_send",
  voiceprintsList: "voiceprints_list",
  voiceprintDelete: "voiceprint_delete",
  settingsGet: "settings_get",
  settingsUpdate: "settings_update",
  llmProviderTest: "llm_provider_test",
  llmCliDetect: "llm_cli_detect",
  secretSet: "secret_set",
  secretDelete: "secret_delete",
  modelsStatus: "models_status",
  audioInputsList: "audio_inputs_list",
  modelsDownload: "models_download",
  permissionsStatus: "permissions_status",
  permissionsRequest: "permissions_request",
  openSystemSettings: "open_system_settings",
  healthGet: "health_get",
  appInfo: "app_info",
  overlaySetExpanded: "overlay_set_expanded",
  mainWindowShow: "main_window_show",
  // src-tauri/src/commands/providers_ui.rs
  llmListModels: "llm_list_models",
  llmDetectLocal: "llm_detect_local",
  openExternalUrl: "open_external_url",
} as const;

export const EVENTS = {
  sessionState: "session:state",
  sessionLevels: "session:levels",
  sessionHealth: "session:health",
  processingProgress: "processing:progress",
  meetingUpdated: "meeting:updated",
  captureSaved: "capture:saved",
  chatDelta: "chat:delta",
  livePartial: "live:partial",
  modelDownload: "model:download",
  mainNavigate: "main:navigate",
} as const;

/** Payload de cada evento. */
export interface EventPayloads {
  "session:state": T.SessionSnapshot;
  "session:levels": T.Levels;
  "session:health": T.HealthWarning;
  "processing:progress": T.ProcessingProgress;
  "meeting:updated": T.MeetingUpdated;
  "capture:saved": T.Capture;
  "chat:delta": T.ChatDelta;
  "live:partial": T.LivePartial;
  "model:download": T.ModelDownload;
  "main:navigate": T.MainNavigate;
}

export type EventName = keyof EventPayloads;
export type Unsubscribe = () => void;

export interface ActaApi {
  // sesión
  sessionGetState(): Promise<T.SessionSnapshot>;
  sessionStart(app?: T.MeetingApp | null): Promise<T.SessionSnapshot>;
  sessionPause(): Promise<T.SessionSnapshot>;
  sessionResume(): Promise<T.SessionSnapshot>;
  sessionStop(): Promise<T.SessionSnapshot>;
  sessionDismiss(): Promise<T.SessionSnapshot>;
  promptAnswer(promptId: T.PromptId, answer: T.PromptAnswer): Promise<T.SessionSnapshot>;
  captureManual(): Promise<T.Capture | null>;

  // reuniones
  meetingsList(query: T.MeetingQuery): Promise<T.Page<T.MeetingSummary>>;
  meetingGet(id: T.MeetingId): Promise<T.MeetingDetail>;
  meetingUpdate(id: T.MeetingId, title: string): Promise<T.Meeting>;
  meetingDelete(id: T.MeetingId): Promise<void>;
  meetingReprocess(request: T.ReprocessRequest): Promise<void>;
  speakerRename(
    meetingId: T.MeetingId,
    speakerId: T.SpeakerId,
    displayName: string,
    remember: boolean,
  ): Promise<void>;
  actionItemSetDone(id: T.ActionItemId, done: boolean): Promise<void>;
  captureDelete(id: T.CaptureId): Promise<void>;

  // grupos
  groupsList(): Promise<T.Group[]>;
  groupCreate(name: string, description?: string | null): Promise<T.Group>;
  groupUpdate(id: T.GroupId, name?: string | null, description?: string | null): Promise<T.Group>;
  groupDelete(id: T.GroupId): Promise<void>;
  groupAddMeeting(groupId: T.GroupId, meetingId: T.MeetingId): Promise<void>;
  groupRemoveMeeting(groupId: T.GroupId, meetingId: T.MeetingId): Promise<void>;
  groupSuggestionsList(): Promise<T.GroupSuggestion[]>;
  groupSuggestionsRefresh(): Promise<T.GroupSuggestion[]>;
  groupSuggestionAccept(id: T.GroupId, name?: string | null): Promise<T.Group>;
  groupSuggestionDismiss(id: T.GroupId): Promise<void>;

  // búsqueda y chat
  search(query: T.SearchQuery): Promise<T.SearchHit[]>;
  chatThreadsList(scope?: T.ChatScope | null): Promise<T.ChatThread[]>;
  chatThreadCreate(scope: T.ChatScope): Promise<T.ChatThread>;
  chatThreadDelete(threadId: T.ChatThreadId): Promise<void>;
  chatMessagesList(threadId: T.ChatThreadId): Promise<T.ChatMessage[]>;
  chatSend(threadId: T.ChatThreadId, text: string): Promise<T.ChatSendResult>;

  // huellas de voz
  voiceprintsList(): Promise<T.VoiceprintSummary[]>;
  voiceprintDelete(id: T.VoiceprintId): Promise<void>;

  // ajustes, permisos, diagnóstico
  settingsGet(): Promise<T.Settings>;
  settingsUpdate(settings: T.Settings): Promise<T.Settings>;
  llmProviderTest(providerId: T.ProviderId): Promise<T.ProviderTestResult>;
  llmCliDetect(): Promise<T.CliDetection>;
  /** Modelos de texto de un servidor compatible con OpenAI. Con `providerId`, usa su clave del Llavero. */
  llmListModels(baseUrl: string, providerId?: T.ProviderId | null): Promise<string[]>;
  /** Ollama y LM Studio en sus puertos por defecto. Que no estén no es un error. */
  llmDetectLocal(): Promise<T.LocalDetection>;
  secretSet(providerId: T.ProviderId, value: string): Promise<T.SecretRef>;
  secretDelete(providerId: T.ProviderId): Promise<void>;
  modelsStatus(): Promise<T.ModelStatus[]>;
  /** Micrófonos del sistema, para elegir `settings.recording.micDeviceUid`. */
  audioInputsList(): Promise<T.AudioInput[]>;
  modelsDownload(name: string): Promise<void>;
  permissionsStatus(): Promise<T.PermissionState[]>;
  permissionsRequest(kind: T.PermissionKind): Promise<T.PermissionStatus>;
  openSystemSettings(kind: T.PermissionKind): Promise<void>;
  healthGet(): Promise<T.HealthWarning[]>;
  appInfo(): Promise<T.AppInfo>;
  /** Abre un enlace web en el navegador por defecto (nunca dentro de acta). */
  openExternalUrl(url: string): Promise<void>;

  // ventanas
  overlaySetExpanded(expanded: boolean): Promise<void>;
  mainWindowShow(meetingId?: T.MeetingId | null): Promise<void>;

  /** Suscripción tipada a un evento del backend. */
  on<E extends EventName>(event: E, handler: (payload: EventPayloads[E]) => void): Promise<Unsubscribe>;

  /** URL reproducible/visualizable para una ruta absoluta local (audio, capturas). */
  fileUrl(absolutePath: string): string;
}
