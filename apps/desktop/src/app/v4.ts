// Contrato de la oleada v4 (reintento con proveedor, directo, búsqueda en el
// transcript). STUB LOCAL: el backend lo está añadiendo a `src/api/**`; cuando
// llegue, este fichero se reduce a reexportar. La UI solo habla con estas
// funciones, que comprueban si la implementación existe y, si no, degradan.

import type { ActaApi, Citation, MeetingId, ProcessingStep, ProviderId, Unsubscribe } from "../api";

export interface MeetingRetryRequest {
  meetingId: MeetingId;
  steps?: ProcessingStep[];
  providerId?: ProviderId | null;
  model?: string | null;
}

/** Un proveedor que se puede usar ahora mismo, con sus modelos. */
export interface LlmProviderOption {
  providerId: ProviderId;
  label: string;
  models: string[];
  defaultModel?: string | null;
  isDefault?: boolean;
}

export interface LiveSegment {
  id: string;
  /** «Yo», «Otros» o un nombre. */
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
}

export interface LiveTranscript {
  sessionId: string;
  segments: LiveSegment[];
}

export interface LiveAskRequest {
  sessionId: string;
  question: string;
  providerId?: ProviderId | null;
  model?: string | null;
}

export interface LiveCitation {
  n: number;
  startMs: number;
  endMs?: number | null;
  speaker?: string | null;
  snippet?: string | null;
  segmentId?: string | null;
}

export interface LiveAnswer {
  requestId: string;
  delta?: string | null;
  done: boolean;
  citations?: (LiveCitation | Citation)[] | null;
  error?: string | null;
}

export interface TranscriptMatch {
  utteranceId: number | string;
  startMs: number;
  snippet: string;
  ranges: [number, number][];
}

export interface PermissionChanged {
  kind: string;
  status: string;
}

export interface V4Api {
  meetingRetry(request: MeetingRetryRequest): Promise<void>;
  llmProvidersAvailable(): Promise<LlmProviderOption[]>;
  liveTranscriptGet(sessionId: string): Promise<LiveSegment[] | LiveTranscript>;
  liveAsk(request: LiveAskRequest): Promise<string | { requestId: string }>;
  meetingSearchTranscript(meetingId: MeetingId, query: string): Promise<TranscriptMatch[]>;
}

export interface V4Events {
  "live:transcript": LiveTranscript;
  "live:answer": LiveAnswer;
  "permissions:changed": PermissionChanged;
}

/** La función v4, enlazada, o `null` si esta implementación de la API aún no la tiene. */
function fn<K extends keyof V4Api>(api: ActaApi, k: K): V4Api[K] | null {
  const f = (api as ActaApi & Partial<V4Api>)[k];
  return typeof f === "function" ? (f.bind(api) as V4Api[K]) : null;
}

/** Reintenta el procesado; si el backend aún no sabe elegir proveedor, reprocesa con el de siempre. */
export function meetingRetry(api: ActaApi, request: MeetingRetryRequest, fallbackSteps: ProcessingStep[]): Promise<void> {
  const f = fn(api, "meetingRetry");
  if (f) return f(request);
  return api.meetingReprocess({ meetingId: request.meetingId, steps: request.steps ?? fallbackSteps });
}

/** Proveedores disponibles; vacío si el backend no lo ofrece (el menú «con…» no sale). */
export async function llmProvidersAvailable(api: ActaApi): Promise<LlmProviderOption[]> {
  const f = fn(api, "llmProvidersAvailable");
  return f ? [...(await f())] : [];
}

export async function liveTranscriptGet(api: ActaApi, sessionId: string): Promise<LiveSegment[]> {
  const f = fn(api, "liveTranscriptGet");
  if (!f) return [];
  const r = await f(sessionId);
  return Array.isArray(r) ? [...r] : [...(r?.segments ?? [])];
}

export const canLiveAsk = (api: ActaApi): boolean => fn(api, "liveAsk") !== null;

export async function liveAsk(api: ActaApi, request: LiveAskRequest): Promise<string> {
  const f = fn(api, "liveAsk");
  if (!f) throw { code: "unavailable", message: "Las preguntas en directo aún no están disponibles." };
  const r = await f(request);
  return typeof r === "string" ? r : r.requestId;
}

/** `null`: el backend no busca; el llamador filtra en cliente. */
export async function meetingSearchTranscript(api: ActaApi, meetingId: MeetingId, query: string): Promise<TranscriptMatch[] | null> {
  const f = fn(api, "meetingSearchTranscript");
  return f ? f(meetingId, query) : null;
}

/** Suscripción a un evento v4 (el tipo del contrato aún no los conoce). */
export function onV4<E extends keyof V4Events>(api: ActaApi, event: E, handler: (payload: V4Events[E]) => void): Promise<Unsubscribe> {
  const on = api.on as unknown as (event: string, handler: (payload: unknown) => void) => Promise<Unsubscribe>;
  return on.call(api, event, (p) => handler(p as V4Events[E]));
}
