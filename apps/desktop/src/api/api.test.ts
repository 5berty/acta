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
