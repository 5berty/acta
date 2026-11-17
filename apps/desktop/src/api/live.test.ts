import { describe, expect, it } from "vitest";
import { COMMANDS, EVENTS } from "./contract";
import { createMockApi, sampleMeeting } from "./mock";
import type * as T from "./types";

describe("wave 4 contract (mock)", () => {
  it("uses the Rust command and event names", () => {
    expect([
      COMMANDS.meetingRetry,
      COMMANDS.llmProvidersAvailable,
      COMMANDS.liveTranscriptGet,
      COMMANDS.liveAsk,
      COMMANDS.meetingSearchTranscript,
      COMMANDS.groupsSuggestTitle,
    ]).toEqual([
      "meeting_retry",
      "llm_providers_available",
      "live_transcript_get",
      "live_ask",
      "meeting_search_transcript",
      "groups_suggest_title",
    ]);
    expect([EVENTS.liveTranscript, EVENTS.liveAnswer, EVENTS.permissionsChanged]).toEqual(["live:transcript", "live:answer", "permissions:changed"]);
  });

  it("has live preview on and calendar titles off by default, like Rust", async () => {
    const { api } = createMockApi();
    const s = await api.settingsGet();
    expect(s.transcription.livePreview).toBe(true);
    expect(s.titles).toEqual({ calendar: false });
  });

  it("retries with a one-off provider without touching the defaults", async () => {
    const { api, controls } = createMockApi();
    const id = controls.state.meetings[0]!.meeting.id;
    await api.meetingRetry({ meetingId: id, providerId: "nan", model: "qwen3.6" });
    expect(controls.state.retries).toEqual([{ meetingId: id, steps: [], llm: { providerId: "nan", model: "qwen3.6" } }]);
    expect((await api.settingsGet()).llm.minutesProvider).toBe("claude-cli");
    await expect(api.meetingRetry({ meetingId: "nope" })).rejects.toMatchObject({ code: "notFound" });
  });

  it("lists only enabled providers with their models and roles", async () => {
    const { api } = createMockApi();
    const list = await api.llmProvidersAvailable();
    expect(list).toEqual([
      { providerId: "claude-cli", label: "Claude Code (CLI)", kind: "claudeCli", models: ["sonnet", "opus", "haiku"], defaultModel: null, isDefault: true, defaultFor: ["minutes", "chat", "naming"] },
    ]);
  });

  it("returns the live transcript and merges pushed segments by id", async () => {
    const { api, controls } = createMockApi();
    const sessionId = "s1";
    const seen: T.LiveTranscript[] = [];
    await api.on("live:transcript", (t) => seen.push(t));
    controls.pushLive(sessionId, [{ id: "mic-0", speaker: "yo", text: "Hola", startMs: 0, endMs: 900, final: false }]);
    controls.pushLive(sessionId, [{ id: "mic-0", speaker: "yo", text: "Hola a todos", startMs: 0, endMs: 1200, final: true }]);
    expect(seen).toHaveLength(2);
    const all = await api.liveTranscriptGet(sessionId);
    expect(all.segments).toEqual([{ id: "mic-0", speaker: "yo", text: "Hola a todos", startMs: 0, endMs: 1200, final: true }]);
  });

  it("answers a live question by streaming deltas and ends with citations", async () => {
    const { api, controls } = createMockApi();
    controls.pushLive("s1", [{ id: "sys-0", speaker: "otros", text: "Hablemos del presupuesto", startMs: 65_000, endMs: 67_000, final: true }]);
    const answers: T.LiveAnswer[] = [];
    await api.on("live:answer", (a) => answers.push(a));
    const requestId = await api.liveAsk({ sessionId: "s1", question: "¿Han hablado del presupuesto?" });
    await new Promise((r) => setTimeout(r, 0));
    expect(answers.every((a) => a.requestId === requestId)).toBe(true);
    const last = answers.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.citations).toEqual([{ startMs: 65_000 }]);
    expect(answers.filter((a) => a.delta).length).toBeGreaterThan(0);
  });

  it("searches the transcript ignoring accents and case, with UTF-16 ranges", async () => {
    const m = sampleMeeting();
    m.transcript.utterances.push({ idx: 2, speakerId: m.transcript.speakers[0]!.id, track: "mic", start: 10_000, end: 12_000, text: "La reunión de presupuesto y la REUNION final", confidence: null });
    const { api } = createMockApi({ meetings: [m] });
    const hits = await api.meetingSearchTranscript(m.meeting.id, "reunion");
    expect(hits).toEqual([{ utteranceId: 2, startMs: 10_000, snippet: "La reunión de presupuesto y la REUNION final", ranges: [[3, 10], [31, 38]] }]);
    expect(await api.meetingSearchTranscript(m.meeting.id, "  ")).toEqual([]);
  });

  it("cancels a chat answer and a live answer by request id", async () => {
    const { api, controls } = createMockApi();
    expect([COMMANDS.chatCancel, COMMANDS.liveCancel]).toEqual(["chat_cancel", "live_cancel"]);
    const answers: T.LiveAnswer[] = [];
    await api.on("live:answer", (a) => answers.push(a));
    await api.chatCancel("m1");
    await api.liveCancel("r1");
    expect(controls.state.cancelled).toEqual(["m1", "r1"]);
    expect(answers).toEqual([{ requestId: "r1", done: true }]);
  });

  it("suggests a group title from its meetings without renaming it", async () => {
    const { api } = createMockApi();
    const g = await api.groupCreate("test");
    const s = await api.groupsSuggestTitle(g.id);
    expect(s.name.length).toBeGreaterThan(0);
    expect((await api.groupsList()).find((x) => x.id === g.id)?.name).toBe("test");
  });
});
