// Datos de demostración para diseñar la UI sin backend (solo en desarrollo:
// `pnpm dev` en el navegador, o `VITE_ACTA_DEMO=1` dentro de Tauri).
// Envuelve el mock en memoria con reuniones, grupos y un chat creíbles.

import type { ActaApi } from "./contract";
import { createMockApi, defaultSettings, noLocalRuntimes, sampleMeeting, type MockControls } from "./mock";
import type * as T from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let n = 0;
const id = (prefix: string): string => {
  n += 1;
  return `${prefix}-${n.toString().padStart(4, "0")}`;
};

interface Draft {
  title: string;
  platform: T.Platform;
  ago: number;
  minutes: number;
  people: string[];
  status?: T.MeetingStatus;
  error?: string;
  rich?: boolean;
}

const LINES: [number, string][] = [
  [1, "Vale, empezamos. Hoy toca cerrar el alcance de la primera versión."],
  [0, "Por mi parte el grabador ya separa mi voz de la del resto, así que la diarización solo trabaja con vosotros."],
  [2, "Eso simplifica mucho. ¿Y las capturas de la pantalla compartida?"],
  [0, "Opt-in. Solo si lo activas, y solo de la ventana compartida."],
  [1, "Me parece bien. Lo importante es que el acta salga sola al colgar."],
  [3, "Yo me quedo con revisar los textos de la pantalla de permisos, que ahora asustan un poco."],
  [0, "Apuntado. Yo envío el presupuesto el viernes y preparo la demo para el lunes."],
  [2, "Entonces lanzamos el lunes con el grupo piloto, ¿no?"],
  [1, "Sí, decidido: lunes, grupo piloto de diez personas."],
  [3, "Una cosa más: el chat tiene que citar el minuto exacto, si no nadie se fía."],
  [0, "Ya lo hace. Cada respuesta lleva la cita y al pulsarla salta el audio."],
  [1, "Perfecto. Pues con esto cerramos."],
];

function slide(title: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 96%)"/><stop offset="1" stop-color="hsl(${hue + 30} 70% 88%)"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><rect x="90" y="110" width="12" height="90" rx="6" fill="hsl(${hue} 70% 50%)"/><text x="130" y="178" font-family="-apple-system,Helvetica" font-size="64" font-weight="700" fill="#1c1c1e">${title}</text><g fill="hsl(${hue} 30% 40%)" opacity=".55"><rect x="130" y="270" width="720" height="22" rx="11"/><rect x="130" y="320" width="610" height="22" rx="11"/><rect x="130" y="370" width="680" height="22" rx="11"/></g><g fill="hsl(${hue} 70% 50%)"><rect x="130" y="620" width="70" height="${90}" rx="8" transform="translate(0 -90)"/><rect x="220" y="620" width="70" height="150" rx="8" transform="translate(0 -150)"/><rect x="310" y="620" width="70" height="120" rx="8" transform="translate(0 -120)"/><rect x="400" y="620" width="70" height="200" rx="8" transform="translate(0 -200)"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SLIDES: Record<string, string> = {};

function build(d: Draft, now: number): T.MeetingDetail {
  const base = sampleMeeting();
  const meetingId = id("meeting");
  const startedAt = now - d.ago;
  const duration = d.minutes * MIN;
  const status = d.status ?? "ready";
  const speakers: T.Speaker[] = d.people.map((name, i) => ({
    id: id("speaker"),
    meetingId,
    label: i === 0 ? "Yo" : `Hablante ${i}`,
    displayName: name,
    isMe: i === 0,
    track: i === 0 ? "mic" : "system",
    diarizationLabel: i === 0 ? null : `S${i - 1}`,
    nameSource: i === 0 ? "me" : i === 2 ? "voiceprint" : "user",
    confirmed: i !== 2,
    voiceprintId: null,
  }));
  const ready = status === "ready";
  const step = duration / (LINES.length + 1);
  const utterances: T.Utterance[] = status === "processing" ? [] : LINES.map(([who, text], idx) => {
    const sp = speakers[who % speakers.length] ?? speakers[0]!;
    const start = Math.round(idx * step + 4_000);
    return { idx, speakerId: sp.id, track: sp.track, start, end: Math.round(start + step * 0.82), text, confidence: 0.93 };
  });
  const captures: T.Capture[] = d.rich
    ? ["Alcance de la v1", "Calendario", "Presupuesto", "Riesgos", "Piloto"].map((title, i) => {
        const path = `captures/${i}-slide.jpg`;
        SLIDES[`${meetingId}/${path}`] = slide(title, 230 + i * 34);
        return {
          id: id("capture"),
          meetingId,
          at: Math.round(duration * (0.08 + i * 0.18)),
          atWall: startedAt,
          path,
          reason: i === 2 ? "keyword" : "slideChange",
          phash: "0",
          width: 1280,
          height: 800,
          keyword: i === 2 ? "presupuesto" : null,
          topicPath: `${Math.min(3, i + 1)}`,
          actionItemIds: [],
        };
      })
    : [];
  const me = speakers[0]!;
  const minutes: T.Minutes | null = ready
    ? {
        meetingId,
        summaryMd:
          "Se cerró el alcance de la primera versión y se fijó el lanzamiento con un **grupo piloto**.\n\n- El grabador ya separa tu voz de la de los demás.\n- Las capturas de pantalla serán opcionales.\n- El chat citará siempre el minuto exacto.",
        decisions: [
          { id: id("decision"), text: "Lanzar el lunes con un grupo piloto de diez personas", at: Math.round(step * 8) },
          { id: id("decision"), text: "Las capturas de pantalla quedan como opción, apagadas por defecto", at: Math.round(step * 3) },
        ],
        actionItems: [
          { id: id("task"), meetingId, text: "Enviar el presupuesto", ownerName: me.displayName, ownerSpeakerId: me.id, isMine: true, due: "viernes", done: false, at: Math.round(step * 6), captureIds: [] },
          { id: id("task"), meetingId, text: "Preparar la demo para el lunes", ownerName: me.displayName, ownerSpeakerId: me.id, isMine: true, due: "lunes", done: false, at: Math.round(step * 6), captureIds: [] },
          { id: id("task"), meetingId, text: "Avisar al grupo piloto", ownerName: me.displayName, ownerSpeakerId: me.id, isMine: true, due: null, done: true, at: null, captureIds: [] },
          { id: id("task"), meetingId, text: "Revisar los textos de la pantalla de permisos", ownerName: d.people[3] ?? d.people[1] ?? null, ownerSpeakerId: null, isMine: false, due: "jueves", done: false, at: Math.round(step * 5), captureIds: [] },
          { id: id("task"), meetingId, text: "Probar la diarización con cuatro voces", ownerName: d.people[1] ?? null, ownerSpeakerId: null, isMine: false, due: null, done: false, at: null, captureIds: [] },
        ],
        provider: "claude-cli",
        model: null,
        generatedAt: startedAt + duration + MIN,
      }
    : null;
  const third = Math.round(duration / 3);
  const escaleta: T.Escaleta | null = ready
    ? {
        temas: [
          {
            titulo: "Alcance de la primera versión",
            resumen: "Qué entra y qué se queda fuera del lanzamiento.",
            inicio_ms: 0,
            fin_ms: third,
            capturas: [],
            subtemas: [
              { titulo: "Pistas de audio separadas", resumen: "Tu voz va aparte; solo se diariza a los demás.", inicio_ms: Math.round(step), fin_ms: Math.round(step * 2.5), subtemas: [], capturas: [] },
              { titulo: "Capturas opcionales", resumen: "Apagadas por defecto y solo de la ventana compartida.", inicio_ms: Math.round(step * 2.5), fin_ms: third, subtemas: [], capturas: [] },
            ],
          },
          {
            titulo: "Reparto de tareas",
            resumen: "Quién se lleva qué antes del lanzamiento.",
            inicio_ms: third,
            fin_ms: third * 2,
            capturas: [],
            subtemas: [
              { titulo: "Textos de permisos", resumen: "Hay que suavizarlos.", inicio_ms: Math.round(step * 5), fin_ms: Math.round(step * 6), subtemas: [], capturas: [] },
              { titulo: "Presupuesto y demo", resumen: "Presupuesto el viernes y demo el lunes.", inicio_ms: Math.round(step * 6), fin_ms: third * 2, subtemas: [], capturas: [] },
            ],
          },
          {
            titulo: "Lanzamiento",
            resumen: "Fecha y grupo piloto.",
            inicio_ms: third * 2,
            fin_ms: duration,
            capturas: [],
            subtemas: [{ titulo: "Citas en el chat", resumen: "Cada respuesta enlaza al minuto exacto.", inicio_ms: Math.round(step * 9), fin_ms: Math.round(step * 11), subtemas: [], capturas: [] }],
          },
        ],
      }
    : null;
  const timeline: T.TimelineEvent[] = ready
    ? [
        ...(escaleta?.temas.map((t): T.TimelineEvent => ({ at: t.inicio_ms, end: t.fin_ms, kind: "topic", label: t.titulo, refId: null })) ?? []),
        ...(d.rich ? [{ at: Math.round(duration * 0.06), end: Math.round(duration * 0.84), kind: "screenShare" as const, label: "Pantalla de Ana", refId: null }] : []),
        ...(minutes?.decisions.map((x): T.TimelineEvent => ({ at: x.at ?? 0, end: null, kind: "decision", label: x.text, refId: x.id })) ?? []),
        ...(minutes?.actionItems.filter((a) => a.at != null).map((a): T.TimelineEvent => ({ at: a.at ?? 0, end: null, kind: "actionItem", label: a.text, refId: a.id })) ?? []),
        ...captures.map((c): T.TimelineEvent => ({ at: c.at, end: null, kind: "capture", label: "Captura", refId: c.id })),
      ]
    : [];
  return {
    meeting: { ...base.meeting, id: meetingId, title: d.title, platform: d.platform, startedAt, endedAt: startedAt + duration, duration, status, error: d.error ?? null, createdAt: startedAt, updatedAt: startedAt },
    transcript: { meetingId, speakers, utterances },
    minutes,
    escaleta,
    captures,
    timeline,
    groups: [],
    audio: ready ? { mic: `/demo/${meetingId}/mic.wav`, system: `/demo/${meetingId}/system.wav`, mix: `/demo/${meetingId}/mix.wav` } : { mic: null, system: null, mix: null },
  };
}

/** WAV en silencio de la duración pedida (8 kHz, 8 bit): para que el reproductor tenga algo real. */
function silentWav(ms: number): string {
  const rate = 8_000;
  const samples = Math.round((ms / 1000) * rate);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  header.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate, true);
  header.setUint16(32, 1, true);
  header.setUint16(34, 8, true);
  ascii(36, "data");
  header.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([header, new Uint8Array(samples).fill(128)], { type: "audio/wav" }));
}

export type DemoOverlay = "idle" | "recording" | "detected" | "stop" | "warning" | "processing" | "ready";

export interface DemoOptions {
  /** Enseña la bienvenida como en un primer arranque. */
  onboarding?: boolean;
  /** Sin Ollama ni LM Studio, para ver la ayuda de instalación. */
  noLocal?: boolean;
}

export function createDemoApi(overlay: DemoOverlay = "idle", opts: DemoOptions = {}): { api: ActaApi; controls: MockControls } {
  const now = Date.now();
  const drafts: Draft[] = [
    { title: "Planificación del lanzamiento", platform: "teams", ago: 2 * HOUR, minutes: 47, people: ["Edu", "Ana García", "Luis Ortega", "Marta Ruiz"], rich: true },
    { title: "Uno a uno con Ana", platform: "meet", ago: 5 * HOUR, minutes: 28, people: ["Edu", "Ana García"] },
    { title: "Revisión de diseño", platform: "teams", ago: 40 * MIN, minutes: 31, people: ["Edu", "Marta Ruiz", "Pablo Sanz"], status: "processing" },
    { title: "Daily del equipo", platform: "teams", ago: DAY + 3 * HOUR, minutes: 15, people: ["Edu", "Ana García", "Luis Ortega", "Marta Ruiz", "Pablo Sanz", "Sara Gil"] },
    { title: "Demo para el cliente", platform: "zoom", ago: DAY + 6 * HOUR, minutes: 52, people: ["Edu", "Carla Vidal", "Íñigo Paz"], status: "failed", error: "claude: timeout tras 600 s (exit 124)" },
    { title: "Retrospectiva del sprint 14", platform: "teams", ago: 9 * DAY, minutes: 58, people: ["Edu", "Ana García", "Luis Ortega", "Marta Ruiz"] },
    { title: "Entrevista de producto", platform: "meet", ago: 12 * DAY, minutes: 36, people: ["Edu", "Jorge Leal"] },
    { title: "Kickoff del proyecto Atlas", platform: "slack", ago: 38 * DAY, minutes: 64, people: ["Edu", "Ana García", "Carla Vidal", "Luis Ortega"] },
  ];
  const meetings = drafts.map((d) => build(d, now)).sort((a, b) => b.meeting.startedAt - a.meeting.startedAt);
  const byTitle = (t: string) => meetings.find((m) => m.meeting.title === t)!;

  const atlas: T.Group = { id: id("group"), name: "Proyecto Atlas", description: "Todo lo del lanzamiento de la v1", kind: "manual", meetingCount: 0, createdAt: now, updatedAt: now, favourite: false };
  const oneOnOne: T.Group = { id: id("group"), name: "Uno a uno con Ana", description: null, kind: "manual", meetingCount: 0, createdAt: now, updatedAt: now, favourite: false };
  for (const [g, titles] of [
    [atlas, ["Planificación del lanzamiento", "Kickoff del proyecto Atlas", "Retrospectiva del sprint 14"]],
    [oneOnOne, ["Uno a uno con Ana"]],
  ] as const) {
    for (const t of titles) {
      byTitle(t).groups.push(g);
      g.meetingCount += 1;
    }
  }

  const plan = byTitle("Planificación del lanzamiento");
  const thread: T.ChatThread = { id: id("thread"), scope: { kind: "all" }, title: "Lanzamiento", createdAt: now, updatedAt: now };
  const cite = (k: number, at: number): T.Citation => ({ n: k, meetingId: plan.meeting.id, meetingTitle: plan.meeting.title, at, end: at + 20_000, snippet: "Sí, decidido: lunes, grupo piloto de diez personas." });
  const messages: T.ChatMessage[] = [
    { id: id("msg"), threadId: thread.id, role: "user", content: "¿Cuándo lanzamos y con quién?", citations: [], provider: null, createdAt: now - 3 * MIN },
    {
      id: id("msg"),
      threadId: thread.id,
      role: "assistant",
      content: "El lanzamiento quedó fijado para el lunes, con un grupo piloto de diez personas [1]. Antes tienes que enviar el presupuesto el viernes y preparar la demo [2].",
      citations: [cite(1, 31 * MIN), cite(2, 23 * MIN)],
      provider: "claude-cli",
      createdAt: now - 2 * MIN,
    },
  ];

  const rec = (extra: Partial<T.ActiveRecording> = {}): T.ActiveRecording => ({
    meetingId: id("meeting"),
    app: { platform: "teams", bundleId: "com.microsoft.teams2", pid: 1, audioPids: [1], name: "Microsoft Teams", title: "Planificación del lanzamiento", url: null },
    startedAt: now - 754_000,
    stopPrompt: null,
    ...extra,
  });
  const warning: T.HealthWarning = { issue: { kind: "trackAllZeros", track: "system" }, since: now, cleared: false, message: "No llega audio de Teams. Revisa el permiso de audio." };
  const session: Record<DemoOverlay, T.SessionState> = {
    idle: { state: "idle" },
    recording: { state: "recording", ...rec() },
    warning: { state: "recording", ...rec() },
    stop: { state: "recording", ...rec({ stopPrompt: { kind: "stopRecording", reason: "meetingEnded", id: "p-stop", createdAt: now - 14_000 } }) },
    detected: { state: "detected", prompt: { kind: "startRecording", app: rec().app!, id: "p-start", createdAt: now }, app: rec().app! },
    processing: { state: "processing", meetingId: plan.meeting.id, step: "summarizing" },
    ready: { state: "ready", meetingId: plan.meeting.id },
  };
  const live = overlay === "recording" || overlay === "warning" || overlay === "stop";

  const mock = createMockApi({
    meetings,
    groups: [atlas, oneOnOne],
    suggestions: [{ id: id("suggestion"), name: "Dailies del equipo", description: null, meetingIds: ["a", "b", "c", "d"], cohesion: 0.86, createdAt: now }],
    threads: [thread],
    messages,
    voiceprints: [
      { id: id("voice"), displayName: "Ana García", samples: 14, meetings: 9, updatedAt: now },
      { id: id("voice"), displayName: "Luis Ortega", samples: 6, meetings: 4, updatedAt: now },
    ],
    snapshot: { state: session[overlay], elapsedMs: live ? 754_000 : 0, warnings: overlay === "warning" ? [warning] : [], screenSharing: false, captureCount: 0, at: now },
    permissions: [
      { kind: "microphone", status: "granted", target: null },
      { kind: "systemAudio", status: "granted", target: null },
      { kind: "screenRecording", status: "notDetermined", target: null },
      { kind: "accessibility", status: "denied", target: null },
      { kind: "automation", status: "notDetermined", target: "com.google.Chrome" },
    ],
    settings: { ...defaultSettings(), onboarding: { completed: !opts.onboarding } },
    local: opts.noLocal
      ? noLocalRuntimes()
      : {
          ollama: { running: true, baseUrl: "http://127.0.0.1:11434/v1", models: ["qwen2.5:14b", "gemma3:12b", "llama3.2:latest"] },
          lmStudio: { running: false, baseUrl: "http://127.0.0.1:1234/v1", models: [] },
        },
    remoteModels: { "https://api.nan.builders/v1": ["deepseek-v4-flash", "glm5.3", "qwen3.8-flash", "kimi-k3.1-pro", "qwen3.6", "gemma4"] },
  });

  const processing = byTitle("Revisión de diseño");
  const wavs = new Map<string, string>();
  const api: ActaApi = {
    ...mock.api,
    appInfo: async () => ({ version: "0.1.0", dataDir: "/Users/tu/Library/Application Support/acta", sidecarVersion: "0.1.0", macosVersion: "26.5" }),
    fileUrl(path) {
      const capture = /meetings\/(.+\/captures\/.+)$/.exec(path)?.[1];
      if (capture && SLIDES[capture]) return SLIDES[capture];
      const owner = /\/demo\/([^/]+)\//.exec(path)?.[1];
      const m = meetings.find((x) => x.meeting.id === owner);
      if (!m) return mock.api.fileUrl(path);
      const cached = wavs.get(m.meeting.id) ?? silentWav(m.meeting.duration);
      wavs.set(m.meeting.id, cached);
      return cached;
    },
    async on(event, handler) {
      const off = await mock.api.on(event, handler);
      // Un poco de vida: progreso del procesado y niveles mientras «graba».
      if (event === "processing:progress") queueMicrotask(() => mock.controls.emit("processing:progress", { meetingId: processing.meeting.id, step: "diarizing", fraction: 0.62 }));
      return off;
    },
  };
  if (typeof window !== "undefined") {
    // Para el mando de desarrollo: cambiar el estado de la sesión al vuelo.
    (window as unknown as { __actaDemo?: unknown }).__actaDemo = {
      setOverlay(name: DemoOverlay) {
        const recording = name === "recording" || name === "warning" || name === "stop";
        mock.controls.state.snapshot = { state: session[name], elapsedMs: recording ? 754_000 : 0, warnings: name === "warning" ? [warning] : [], screenSharing: false, captureCount: 0, at: Date.now() };
        mock.controls.emit("session:state", mock.controls.state.snapshot);
      },
    };
    let t = 0;
    window.setInterval(() => {
      if (mock.controls.state.snapshot.state.state !== "recording") return;
      t += 1;
      const wave = (phase: number) => -46 + 30 * Math.abs(Math.sin(t / 3 + phase)) * (0.55 + 0.45 * Math.sin(t / 11 + phase));
      mock.controls.emit("session:levels", { mic: { rmsDbfs: wave(0), peakDbfs: -10, allZero: false }, system: { rmsDbfs: wave(1.7), peakDbfs: -10, allZero: false }, at: Date.now() });
    }, 100);
  }
  return { api, controls: mock.controls };
}
