import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiProvider } from "../../app/ApiContext";
import { createMockApi } from "../../api";
import { AudioPlayer } from "./AudioPlayer";
import { PlayerProvider, usePlayer } from "./PlayerContext";

function SeekButton() {
  const p = usePlayer();
  return (
    <button type="button" onClick={() => p.seek(4500)}>
      saltar
    </button>
  );
}

import type { MeetingAudio } from "../../api";
const audio: MeetingAudio = { mic: "/m/mic.wav", system: "/m/system.wav", mix: "/m/mix.wav" };

function setup(a: MeetingAudio = audio) {
  const { api } = createMockApi();
  return render(
    <ApiProvider api={api}>
      <PlayerProvider audio={a}>
        <AudioPlayer />
        <SeekButton />
      </PlayerProvider>
    </ApiProvider>,
  );
}

describe("AudioPlayer", () => {
  it("usa la mezcla por defecto y salta a un instante", async () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    expect(el.getAttribute("src")).toBe("file:///m/mix.wav");
    await userEvent.click(screen.getByRole("button", { name: "saltar" }));
    expect(el.currentTime).toBeCloseTo(4.5);
  });

  it("permite elegir pista: Yo / Otros", async () => {
    const { container } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Pista"), "mic");
    expect(container.querySelector("audio")!.getAttribute("src")).toBe("file:///m/mic.wav");
  });

  it("refleja el tiempo actual", () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    el.currentTime = 12;
    act(() => {
      fireEvent.timeUpdate(el);
    });
    expect(screen.getByText("00:12")).toBeInTheDocument();
  });

  it("sin audio avisa en vez de romper", () => {
    setup({ mic: null, system: null, mix: null });
    expect(screen.getByText("Esta reunión no tiene audio")).toBeInTheDocument();
  });
});
