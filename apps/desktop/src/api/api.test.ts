import { describe, expect, it } from "vitest";
import { COMMANDS, EVENTS } from "./contract";
import { createMockApi } from "./mock";

describe("mock api", () => {
  it("records a manual session and stops it", async () => {
    const { api } = createMockApi();
    const seen: string[] = [];
    await api.on("session:state", (s) => seen.push(s.state.state));

    expect((await api.sessionGetState()).state.state).toBe("idle");
    await api.sessionStart();
    await api.sessionPause();
    await api.sessionResume();
    const stopped = await api.sessionStop();

    expect(stopped.state.state).toBe("stopping");
    expect(seen).toEqual(["recording", "paused", "recording", "stopping"]);
  });

  it("rejects pausing when idle with an ApiError", async () => {
    const { api } = createMockApi();
    await expect(api.sessionPause()).rejects.toMatchObject({ code: "invalidState" });
  });

  it("stores a secret as a keychain ref and reports models", async () => {
    const { api } = createMockApi();
    expect(await api.secretSet("openrouter", "sk-x")).toEqual({ service: "acta", account: "provider:openrouter" });
    await api.secretDelete("openrouter");
    const status = await api.modelsStatus();
    expect(status.map((m) => m.name)).toEqual(["asr", "diarizer", "vad"]);
  });

  it("emits download progress then done and marks the model downloaded", async () => {
    const { api } = createMockApi();
    const seen: number[] = [];
    let done = false;
    await api.on("model:download", (d) => {
      seen.push(d.fraction);
      done = d.done;
    });
    await api.modelsDownload("vad");
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(done).toBe(true);
    expect((await api.modelsStatus()).find((m) => m.name === "vad")?.downloaded).toBe(true);
  });

  it("has Rust-equal defaults for effort and denylist", async () => {
    const { api } = createMockApi();
    const s = await api.settingsGet();
    expect(s.detection.denylist).toEqual([]);
    const k = s.llm.providers[0]!.kind;
    expect(k.type === "claudeCli" && k.effort).toBeNull();
  });

  it("lists the sample meeting with my open tasks", async () => {
    const { api } = createMockApi();
    const page = await api.meetingsList({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.myOpenTasks).toBe(1);
  });
});

describe("contract names", () => {
  it("uses snake_case commands and namespaced events like acta-core", () => {
    for (const name of Object.values(COMMANDS)) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    for (const name of Object.values(EVENTS)) expect(name).toMatch(/^[a-z]+:[a-z-]+$/);
  });
});
