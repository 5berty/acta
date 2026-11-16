// Implementación en memoria de `ActaApi` para tests (vitest) y para
// desarrollar la UI en el navegador sin Tauri. Comportamiento mínimo pero
// coherente con el contrato. `controls.emit` simula eventos del backend.

import type { ActaApi, EventName, EventPayloads, Unsubscribe } from "./contract";
import type * as T from "./types";

export interface MockControls {
  emit<E extends EventName>(event: E, payload: EventPayloads[E]): void;
  /** Estado interno, para aserciones. */
  state: MockState;
}

export interface MockState {
  snapshot: T.SessionSnapshot;
  meetings: T.MeetingDetail[];
  groups: T.Group[];
  suggestions: T.GroupSuggestion[];
  threads: T.ChatThread[];
  messages: T.ChatMessage[];
  voiceprints: T.VoiceprintSummary[];
  settings: T.Settings;
  models: T.ModelStatus[];
  permissions: T.PermissionState[];
  /** Servidores locales de modelos que «hay» en este Mac. */
  local: T.LocalDetection;
  /** Modelos por URL base (sin barra final) para `llmListModels`. */
  remoteModels: Record<string, string[]>;
  /** Enlaces que se han pedido abrir en el navegador. */
  opened: string[];
}

export function noLocalRuntimes(): T.LocalDetection {
  return {
    ollama: { running: false, baseUrl: "http://127.0.0.1:11434/v1", models: [] },
    lmStudio: { running: false, baseUrl: "http://127.0.0.1:1234/v1", models: [] },
  };
}

let counter = 0;
const newId = (): string => {
  counter += 1;
  return `00000000-0000-7000-8000-${counter.toString().padStart(12, "0")}`;
};

const now = (): number => Date.now();

export function defaultSettings(): T.Settings {
  return {
    user: { displayName: "Edu", aliases: ["Eduardo", "Edu Navajas"] },
    recording: { segmentSeconds: 30, frameMs: 100, micDeviceUid: null, deleteSegmentsAfterConcat: false },
    autoStop: {
      silenceThresholdDbfs: -50,
      silencePromptAfterMs: 180_000,
      autoStopAfterUnansweredMs: 120_000,
      maxDurationMs: 14_400_000,
    },
    health: { stallMs: 3_000, zerosMs: 10_000, segmentGraceMs: 10_000, minFreeBytes: 1_000_000_000 },
    detection: {
      enabled: true,
      rules: [{ bundleId: "com.microsoft.teams2", platform: "teams", isBrowser: false }],
      denylist: [],
      meetUrlPatterns: ["meet.google.com/"],
      startPromptTimeoutS: 90,
      pollMs: 1_000,
      debounceMs: 3_000,
    },
    screen: {
      enabled: false,
      fps: 1,
      phashThreshold: 10,
      stableFrames: 2,
      candidateEveryS: 30,
      ringSeconds: 20,
      maxWidth: 1920,
      keywords: ["importante", "apuntad", "esto es clave", "deadline", "fecha"],
      pruneCandidates: true,
    },
    transcription: { language: "es", diarization: true, livePreview: false, voiceprintMinSimilarityPct: 75 },
    llm: {
      providers: [
        {
          id: "claude-cli",
          label: "Claude Code (CLI)",
          enabled: true,
          kind: { type: "claudeCli", binaryPath: "/opt/homebrew/bin/claude", model: null, effort: null, extraEnv: {} },
          timeoutS: 600,
        },
      ],
      minutesProvider: "claude-cli",
      chatProvider: "claude-cli",
      namingProvider: "claude-cli",
    },
    embeddings: { model: "intfloat/multilingual-e5-small" },
    // En los tests la bienvenida ya está vista; los suyos la reabren.
    onboarding: { completed: true },
  };
}

export function sampleMeeting(): T.MeetingDetail {
  const id = newId();
  const me = newId();
  const ana = newId();
  const t0 = now() - 3_600_000;
  return {
    meeting: {
      id,
      title: "Daily del equipo",
      platform: "teams",
      appBundleId: "com.microsoft.teams2",
      startedAt: t0,
      endedAt: t0 + 900_000,
      duration: 900_000,
      status: "ready",
      recovered: false,
      error: null,
      language: "es",
      createdAt: t0,
      updatedAt: t0,
    },
    transcript: {
      meetingId: id,
      speakers: [
        {
          id: me,
          meetingId: id,
          label: "Yo",
          displayName: "Edu",
          isMe: true,
          track: "mic",
          diarizationLabel: null,
          nameSource: "me",
          confirmed: true,
          voiceprintId: null,
        },
        {
          id: ana,
          meetingId: id,
          label: "Speaker 1",
          displayName: "Ana",
          isMe: false,
          track: "system",
          diarizationLabel: "S0",
          nameSource: "appUi",
          confirmed: false,
          voiceprintId: null,
        },
      ],
      utterances: [
        { idx: 0, speakerId: ana, track: "system", start: 0, end: 4_000, text: "Empezamos con el plan.", confidence: 0.92 },
        { idx: 1, speakerId: me, track: "mic", start: 4_500, end: 9_000, text: "Yo envío el presupuesto el viernes.", confidence: 0.95 },
      ],
    },
    minutes: {
      meetingId: id,
      summaryMd: "- Se revisó el plan del trimestre.",
      decisions: [{ id: newId(), text: "Lanzar el lunes", at: 60_000 }],
      actionItems: [
        {
          id: newId(),
          meetingId: id,
          text: "Enviar presupuesto",
          ownerName: "Edu",
          ownerSpeakerId: me,
          isMine: true,
          due: "viernes",
          done: false,
          at: 4_500,
          captureIds: [],
        },
      ],
      provider: "claude-cli",
      model: null,
      generatedAt: t0 + 960_000,
    },
    escaleta: {
      temas: [{ titulo: "Plan", resumen: "Revisión del plan", inicio_ms: 0, fin_ms: 900_000, subtemas: [], capturas: [] }],
    },
    captures: [],
    timeline: [{ at: 0, end: 900_000, kind: "topic", label: "Plan", refId: null }],
    groups: [],
    audio: { mic: null, system: null, mix: null },
  };
}

function snapshot(state: T.SessionState, extra: Partial<T.SessionSnapshot> = {}): T.SessionSnapshot {
  return { state, elapsedMs: 0, warnings: [], screenSharing: false, captureCount: 0, at: now(), ...extra };
}

function summaryOf(d: T.MeetingDetail): T.MeetingSummary {
  return {
    id: d.meeting.id,
    title: d.meeting.title,
    platform: d.meeting.platform,
    startedAt: d.meeting.startedAt,
    duration: d.meeting.duration,
    status: d.meeting.status,
    speakerNames: d.transcript.speakers.map((s) => s.displayName ?? s.label),
    myOpenTasks: d.minutes?.actionItems.filter((a) => a.isMine && !a.done).length ?? 0,
    groupIds: d.groups.map((g) => g.id),
    captureCount: d.captures.length,
    snippet: null,
  };
}

const notFound = (what: string): T.ApiError => ({ code: "notFound", message: `No encontrado: ${what}` });
const invalidState = (message: string): T.ApiError => ({ code: "invalidState", message });

export function createMockApi(seed: Partial<MockState> = {}): { api: ActaApi; controls: MockControls } {
  const state: MockState = {
    snapshot: snapshot({ state: "idle" }),
    meetings: [sampleMeeting()],
    groups: [],
    suggestions: [],
    threads: [],
    messages: [],
    voiceprints: [],
    settings: defaultSettings(),
    models: [
      { name: "asr", downloaded: true, bytes: 600_000_000 },
      { name: "diarizer", downloaded: false, bytes: null },
      { name: "vad", downloaded: false, bytes: null },
    ],
    permissions: [
      { kind: "microphone", status: "granted", target: null },
      { kind: "systemAudio", status: "unknown", target: null },
      { kind: "screenRecording", status: "notDetermined", target: null },
      { kind: "accessibility", status: "notDetermined", target: null },
      { kind: "automation", status: "notDetermined", target: "com.google.Chrome" },
    ],
    local: noLocalRuntimes(),
    remoteModels: {},
    opened: [],
    ...seed,
  };

  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = <E extends EventName>(event: E, payload: EventPayloads[E]) => {
    listeners.get(event)?.forEach((h) => h(payload));
  };
  const setState = (s: T.SessionState): T.SessionSnapshot => {
    state.snapshot = snapshot(s);
    emit("session:state", state.snapshot);
    return state.snapshot;
  };
  const findMeeting = (id: string): T.MeetingDetail => {
    const m = state.meetings.find((x) => x.meeting.id === id);
    if (!m) throw notFound(`reunión ${id}`);
    return m;
  };
  const findGroup = (id: string): T.Group => {
    const g = state.groups.find((x) => x.id === id);
    if (!g) throw notFound(`grupo ${id}`);
    return g;
  };

  const api: ActaApi = {
    async sessionGetState() {
      return state.snapshot;
    },
    async sessionStart(app) {
      const s = state.snapshot.state.state;
      if (s === "recording" || s === "paused" || s === "stopping") throw invalidState("Ya hay una grabación en curso");
      return setState({ state: "recording", meetingId: newId(), app: app ?? null, startedAt: now(), stopPrompt: null });
    },
    async sessionPause() {
      const s = state.snapshot.state;
      if (s.state !== "recording") throw invalidState("No se está grabando");
      const { state: _ignored, ...rec } = s;
      return setState({ ...rec, state: "paused", pausedAt: now() });
    },
    async sessionResume() {
      const s = state.snapshot.state;
      if (s.state !== "paused") throw invalidState("No está en pausa");
      const { state: _ignored, pausedAt: _p, ...rec } = s;
      return setState({ ...rec, state: "recording" });
    },
    async sessionStop() {
      const s = state.snapshot.state;
      if (s.state !== "recording" && s.state !== "paused") throw invalidState("No se está grabando");
      return setState({ state: "stopping", meetingId: s.meetingId, reason: "user" });
    },
    async sessionDismiss() {
      return setState({ state: "idle" });
    },
    async promptAnswer(promptId, answer) {
      const s = state.snapshot.state;
      if (s.state === "detected" && s.prompt.id === promptId) {
        return answer === "accept"
          ? setState({ state: "recording", meetingId: newId(), app: s.app, startedAt: now(), stopPrompt: null })
          : setState({ state: "idle" });
      }
      if ((s.state === "recording" || s.state === "paused") && s.stopPrompt?.id === promptId) {
        return answer === "accept"
          ? setState({ state: "stopping", meetingId: s.meetingId, reason: "meetingEndedConfirmed" })
          : setState({ ...s, stopPrompt: null });
      }
      throw invalidState("Pregunta caducada");
    },
    async captureManual() {
      return null;
    },

    async meetingsList(query) {
      const text = query.text?.toLowerCase();
      const items = state.meetings
        .filter((m) => !text || m.meeting.title.toLowerCase().includes(text))
        .filter((m) => !query.groupId || m.groups.some((g) => g.id === query.groupId))
        .map(summaryOf);
      return { items: items.slice(0, query.limit ?? 50), nextCursor: null };
    },
    async meetingGet(id) {
      return findMeeting(id);
    },
    async meetingUpdate(id, title) {
      const m = findMeeting(id);
      m.meeting = { ...m.meeting, title, updatedAt: now() };
      return m.meeting;
    },
    async meetingDelete(id) {
      state.meetings = state.meetings.filter((m) => m.meeting.id !== id);
    },
    async meetingReprocess(request) {
      findMeeting(request.meetingId);
    },
    async speakerRename(meetingId, speakerId, displayName) {
      const m = findMeeting(meetingId);
      const sp = m.transcript.speakers.find((s) => s.id === speakerId);
      if (!sp) throw notFound(`hablante ${speakerId}`);
      sp.displayName = displayName;
      sp.nameSource = "user";
      sp.confirmed = true;
    },
    async actionItemSetDone(id, done) {
      for (const m of state.meetings) {
        const item = m.minutes?.actionItems.find((a) => a.id === id);
        if (item) {
          item.done = done;
          return;
        }
      }
      throw notFound(`tarea ${id}`);
    },
    async captureDelete(id) {
      for (const m of state.meetings) m.captures = m.captures.filter((c) => c.id !== id);
    },

    async groupsList() {
      return state.groups;
    },
    async groupCreate(name, description) {
      const g: T.Group = {
        id: newId(),
        name,
        description: description ?? null,
        kind: "manual",
        meetingCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      state.groups.push(g);
      return g;
    },
    async groupUpdate(id, name, description) {
      const g = findGroup(id);
      if (name != null) g.name = name;
      if (description != null) g.description = description;
      g.updatedAt = now();
      return g;
    },
    async groupDelete(id) {
      state.groups = state.groups.filter((g) => g.id !== id);
      for (const m of state.meetings) m.groups = m.groups.filter((g) => g.id !== id);
    },
    async groupAddMeeting(groupId, meetingId) {
      const g = findGroup(groupId);
      const m = findMeeting(meetingId);
      if (!m.groups.some((x) => x.id === groupId)) {
        m.groups.push(g);
        g.meetingCount += 1;
      }
    },
    async groupRemoveMeeting(groupId, meetingId) {
      const g = findGroup(groupId);
      const m = findMeeting(meetingId);
      const before = m.groups.length;
      m.groups = m.groups.filter((x) => x.id !== groupId);
      if (m.groups.length < before) g.meetingCount -= 1;
    },
    async groupSuggestionsList() {
      return state.suggestions;
    },
    async groupSuggestionsRefresh() {
      return state.suggestions;
    },
    async groupSuggestionAccept(id, name) {
      const s = state.suggestions.find((x) => x.id === id);
      if (!s) throw notFound(`sugerencia ${id}`);
      state.suggestions = state.suggestions.filter((x) => x.id !== id);
      const g: T.Group = {
        id: s.id,
        name: name ?? s.name ?? "Grupo",
        description: s.description,
        kind: "suggested",
        meetingCount: s.meetingIds.length,
        createdAt: now(),
        updatedAt: now(),
      };
      state.groups.push(g);
      return g;
    },
    async groupSuggestionDismiss(id) {
      state.suggestions = state.suggestions.filter((x) => x.id !== id);
    },

    async search(query) {
      const q = query.text.toLowerCase();
      return state.meetings.flatMap((m) =>
        m.transcript.utterances
          .filter((u) => u.text.toLowerCase().includes(q))
          .map((u) => ({
            meetingId: m.meeting.id,
            meetingTitle: m.meeting.title,
            startedAt: m.meeting.startedAt,
            at: u.start,
            end: u.end,
            speaker: m.transcript.speakers.find((s) => s.id === u.speakerId)?.displayName ?? null,
            snippet: u.text,
            score: 1,
          })),
      );
    },
    async chatThreadsList(scope) {
      return scope ? state.threads.filter((t) => JSON.stringify(t.scope) === JSON.stringify(scope)) : state.threads;
    },
    async chatThreadCreate(scope) {
      const t: T.ChatThread = { id: newId(), scope, title: "Nueva conversación", createdAt: now(), updatedAt: now() };
      state.threads.push(t);
      return t;
    },
    async chatThreadDelete(threadId) {
      state.threads = state.threads.filter((t) => t.id !== threadId);
      state.messages = state.messages.filter((m) => m.threadId !== threadId);
    },
    async chatMessagesList(threadId) {
      return state.messages.filter((m) => m.threadId === threadId);
    },
    async chatSend(threadId, text) {
      const userMessage: T.ChatMessage = {
        id: newId(),
        threadId,
        role: "user",
        content: text,
        citations: [],
        provider: null,
        createdAt: now(),
      };
      state.messages.push(userMessage);
      const assistantMessageId = newId();
      const reply = "Respuesta simulada.";
      state.messages.push({
        id: assistantMessageId,
        threadId,
        role: "assistant",
        content: reply,
        citations: [],
        provider: "mock",
        createdAt: now(),
      });
      queueMicrotask(() =>
        emit("chat:delta", { threadId, messageId: assistantMessageId, delta: reply, done: true, citations: [], error: null }),
      );
      return { userMessage, assistantMessageId };
    },

    async voiceprintsList() {
      return state.voiceprints;
    },
    async voiceprintDelete(id) {
      state.voiceprints = state.voiceprints.filter((v) => v.id !== id);
    },

    async settingsGet() {
      return state.settings;
    },
    async settingsUpdate(settings) {
      state.settings = settings;
      return settings;
    },
    async llmProviderTest() {
      return { ok: true, message: "OK (mock)", latencyMs: 1 };
    },
    async llmCliDetect() {
      return { claude: "/opt/homebrew/bin/claude", codex: null, claudeEnv: {}, codexEnv: {} };
    },
    async llmListModels(baseUrl) {
      const key = baseUrl.trim().replace(/\/+$/, "");
      const local = [state.local.ollama, state.local.lmStudio].find((r) => r.running && r.baseUrl === key);
      const models = state.remoteModels[key] ?? local?.models;
      if (!models) throw { code: "unavailable", message: `no se pudo conectar con ${key}/models: ¿está el servidor en marcha?` } satisfies T.ApiError;
      return [...models];
    },
    async llmDetectLocal() {
      return structuredClone(state.local);
    },
    async secretSet(providerId) {
      return { service: "acta", account: `provider:${providerId}` };
    },
    async secretDelete() {},
    async modelsStatus() {
      return state.models.map((m) => ({ ...m }));
    },
    async audioInputsList() {
      return [
        { uid: "BuiltInMicrophoneDevice", name: "Micrófono del MacBook Pro", isDefault: true, transport: "builtin" },
        { uid: "AirPods-input", name: "AirPods", isDefault: false, transport: "bluetooth" },
      ];
    },
    async modelsDownload(name) {
      const model = state.models.find((m) => m.name === name);
      if (!model) throw notFound(`modelo ${name}`);
      for (const fraction of [0.4, 0.8]) emit("model:download", { name, fraction, done: false, error: null });
      model.downloaded = true;
      model.bytes = model.bytes ?? 100_000_000;
      emit("model:download", { name, fraction: 1, done: true, error: null });
    },
    async permissionsStatus() {
      return state.permissions;
    },
    async permissionsRequest(kind) {
      return state.permissions.find((p) => p.kind === kind)?.status ?? "unknown";
    },
    async openSystemSettings() {},
    async healthGet() {
      return state.snapshot.warnings;
    },
    async appInfo() {
      return { version: "0.1.0-mock", dataDir: "/tmp/acta", sidecarVersion: null, macosVersion: null };
    },

    async openExternalUrl(url) {
      state.opened.push(url);
    },

    async overlaySetExpanded() {},
    async mainWindowShow(meetingId) {
      if (meetingId) emit("main:navigate", { meetingId });
    },

    async on(event, handler): Promise<Unsubscribe> {
      const set = listeners.get(event) ?? new Set();
      const h = handler as (p: unknown) => void;
      set.add(h);
      listeners.set(event, set);
      return () => {
        set.delete(h);
      };
    },
    fileUrl: (absolutePath) => `file://${absolutePath}`,
  };

  return { api, controls: { emit, state } };
}
