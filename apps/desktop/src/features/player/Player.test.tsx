import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiProvider } from "../../app/ApiContext";
import { createMockApi } from "../../api";
import { AudioPlayer, voiceActivity } from "./AudioPlayer";
import { PlayerProvider, usePlayer } from "./PlayerContext";

function SeekButton() {
  const p = usePlayer();
  return (
    <>
      <button type="button" onClick={() => p.seek(4500)}>
        saltar
      </button>
      <button type="button" onClick={() => p.seek(Number.NaN)}>
        saltar a nada
      </button>
      <button type="button" onClick={() => p.seek(-3000)}>
        saltar antes del inicio
      </button>
    </>
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

describe("onda de voz", () => {
  it("reparte la voz del transcript en tramos", () => {
    expect(voiceActivity([{ start: 0, end: 500 }, { start: 1000, end: 2000 }], 4000, 4)).toEqual([0.5, 1, 0, 0]);
    expect(voiceActivity([{ start: 0, end: 4000 }], 4000, 4)).toEqual([1, 1, 1, 1]);
    expect(voiceActivity([{ start: 0, end: 10 }], 0, 3)).toEqual([0, 0, 0]);
  });

  it("dibuja la onda y marca lo ya reproducido", () => {
    const { api } = createMockApi();
    const { container } = render(
      <ApiProvider api={api}>
        <PlayerProvider audio={audio}>
          <AudioPlayer activity={[{ start: 0, end: 60_000 }]} durationMs={60_000} />
        </PlayerProvider>
      </ApiProvider>,
    );
    expect(container.querySelectorAll(".wave-bar")).toHaveLength(64);
    expect(container.querySelectorAll(".wave-bar-played")).toHaveLength(0);
    const el = container.querySelector("audio")!;
    el.currentTime = 30;
    act(() => {
      fireEvent.timeUpdate(el);
    });
    expect(container.querySelectorAll(".wave-bar-played")).toHaveLength(32);
    expect(screen.getByText("01:00")).toBeInTheDocument();
  });

  it("la onda sirve para saltar en el audio", () => {
    const { api } = createMockApi();
    const { container } = render(
      <ApiProvider api={api}>
        <PlayerProvider audio={audio}>
          <AudioPlayer durationMs={60_000} />
        </PlayerProvider>
      </ApiProvider>,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Posición" }), { target: { value: "15000" } });
    expect(container.querySelector("audio")!.currentTime).toBeCloseTo(15);
  });

  it("con una sola pista no ofrece elegir", () => {
    setup({ mic: null, system: null, mix: "/m/mix.wav" });
    expect(screen.queryByLabelText("Pista")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Velocidad")).toBeInTheDocument();
  });
});

describe("saltar a un instante", () => {
  const setReady = (el: HTMLAudioElement, state: number) => Object.defineProperty(el, "readyState", { configurable: true, value: state });

  it("si el audio aún no tiene metadatos, recuerda el salto y lo aplica al cargarlos", async () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    setReady(el, 0);
    const play = vi.fn(() => Promise.resolve());
    el.play = play;
    await userEvent.click(screen.getByRole("button", { name: "saltar" }));
    // El navegador descarta la posición pedida antes de conocer la duración.
    el.currentTime = 0;
    setReady(el, 1);
    play.mockClear();
    act(() => {
      fireEvent.loadedMetadata(el);
    });
    expect(el.currentTime).toBeCloseTo(4.5);
    expect(play).toHaveBeenCalled();
    expect(screen.getByText("00:04")).toBeInTheDocument();
  });

  it("un salto pendiente no se vuelve a aplicar en cargas posteriores", async () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    setReady(el, 0);
    await userEvent.click(screen.getByRole("button", { name: "saltar" }));
    setReady(el, 1);
    act(() => {
      fireEvent.loadedMetadata(el);
    });
    el.currentTime = 30;
    act(() => {
      fireEvent.loadedMetadata(el);
    });
    expect(el.currentTime).toBeCloseTo(30);
  });

  it("ignora NaN y no baja de cero", async () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    setReady(el, 1);
    el.currentTime = 7;
    await userEvent.click(screen.getByRole("button", { name: "saltar a nada" }));
    expect(el.currentTime).toBeCloseTo(7);
    await userEvent.click(screen.getByRole("button", { name: "saltar antes del inicio" }));
    expect(el.currentTime).toBe(0);
    expect(container.querySelector(".player-time")).toHaveTextContent("00:00");
  });

  it("un timeupdate anterior al seeked no devuelve la interfaz a la posición vieja", async () => {
    const { container } = setup();
    const el = container.querySelector("audio")!;
    setReady(el, 4);
    await userEvent.click(screen.getByRole("button", { name: "saltar" }));
    // El elemento todavía informa de la posición antigua mientras busca.
    Object.defineProperty(el, "currentTime", { configurable: true, writable: true, value: 12 });
    act(() => {
      fireEvent.timeUpdate(el);
    });
    expect(screen.getByText("00:04")).toBeInTheDocument();
    expect(screen.queryByText("00:12")).not.toBeInTheDocument();
    // Terminada la búsqueda, el audio vuelve a mandar.
    el.currentTime = 4.5;
    act(() => {
      fireEvent.seeked(el);
    });
    el.currentTime = 12;
    act(() => {
      fireEvent.timeUpdate(el);
    });
    expect(screen.getByText("00:12")).toBeInTheDocument();
  });
});
