import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockApi, type LiveSegment, type SessionSnapshot } from "../../api";
import { ApiProvider } from "../../app/ApiContext";
import { App } from "../../app/App";
import { LiveContainer } from "./LiveContainer";

beforeEach(() => localStorage.clear());

const seg = (id: string, speaker: string, text: string, startMs: number, final = true): LiveSegment => ({ id, speaker, text, startMs, endMs: startMs + 2_000, final });
const SEGS = [seg("s1", "otros", "Empezamos con el plan.", 1_000), seg("s2", "yo", "Yo envío el presupuesto.", 4_000), seg("s3", "Ana García", "Hablemos de las subcuentas nuevas.", 65_000)];

function mount(segments: LiveSegment[] = SEGS, tweak: (m: ReturnType<typeof createMockApi>) => void = () => {}) {
  const mock = createMockApi();
  if (segments.length) mock.controls.pushLive("m1", segments);
  tweak(mock);
  render(
    <ApiProvider api={mock.api}>
      <LiveContainer sessionId="m1" elapsedMs={70_000} paused={false} app={null} />
    </ApiProvider>,
  );
  return mock;
}

describe("vista en directo", () => {
  it("enseña lo transcrito hasta ahora con quién habla", async () => {
    mount();
    expect(await screen.findByText("Empezamos con el plan.")).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Transcripción en directo" });
    expect(within(log).getByText("Otros")).toBeInTheDocument();
    expect(within(log).getByText("Yo")).toBeInTheDocument();
    expect(within(log).getByText("Ana García")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "En directo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tiempo grabado")).toHaveTextContent("01:10");
  });

  it("no roba el foco al aparecer", async () => {
    mount();
    await screen.findByText("Empezamos con el plan.");
    expect(document.body).toHaveFocus();
  });

  it("los segmentos nuevos se añaden y los provisionales se sustituyen por su versión final", async () => {
    const { controls } = mount();
    await screen.findByText("Empezamos con el plan.");
    act(() => controls.pushLive("m1", [seg("s4", "otros", "Y luego vemos", 70_000, false)]));
    const partial = await screen.findByText("Y luego vemos");
    expect(partial.closest(".line")).toHaveClass("line-partial");
    act(() => controls.pushLive("m1", [seg("s4", "otros", "Y luego vemos el calendario.", 70_000, true)]));
    expect(await screen.findByText("Y luego vemos el calendario.")).toBeInTheDocument();
    expect(screen.queryByText("Y luego vemos")).not.toBeInTheDocument();
    expect(screen.getByText("Y luego vemos el calendario.").closest(".line")).not.toHaveClass("line-partial");
  });

  it("ignora los segmentos de otra grabación", async () => {
    const { controls } = mount();
    await screen.findByText("Empezamos con el plan.");
    act(() => controls.pushLive("otra", [seg("x1", "otros", "Esto es de otra reunión", 0)]));
    expect(screen.queryByText("Esto es de otra reunión")).not.toBeInTheDocument();
  });

  it("busca en lo que se lleva dicho", async () => {
    mount();
    await screen.findByText("Empezamos con el plan.");
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar en el directo" }), "subcuentas");
    expect(await screen.findByText("1 de 1")).toBeInTheDocument();
    expect(document.querySelector("mark.hit")?.textContent).toBe("subcuentas");
  });

  it("sin nada todavía, espera con calma", async () => {
    mount([]);
    expect(await screen.findByText("Esperando a que alguien hable…")).toBeInTheDocument();
  });

  it("si la transcripción en vivo está apagada, lo explica", async () => {
    mount([], (m) => {
      m.controls.state.settings.transcription.livePreview = false;
    });
    expect(await screen.findByText("La transcripción en directo está desactivada")).toBeInTheDocument();
  });
});

describe("preguntar durante la reunión", () => {
  const ask = async (q: string) => {
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), `${q}{Enter}`);
  };

  it("responde en streaming con la cita del momento, que lleva a esa frase", async () => {
    mount();
    await screen.findByText("Empezamos con el plan.");
    expect(screen.getByText("Pregunta sobre la reunión")).toBeInTheDocument();
    await ask("¿Han hablado de las subcuentas?");
    expect(await screen.findByText("¿Han hablado de las subcuentas?")).toBeInTheDocument();
    expect(await screen.findByText(/Sí, se habló de ello/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Ir a 01:05" }));
    await waitFor(() => expect(document.querySelector('[data-seg="s3"] .line')).toHaveClass("line-flash"));
  });

  it("las citas del final también saltan", async () => {
    mount();
    await screen.findByText("Empezamos con el plan.");
    await ask("¿Algo del presupuesto?");
    const chip = await screen.findByRole("button", { name: "00:04" });
    await userEvent.click(chip);
    await waitFor(() => expect(document.querySelector('[data-seg="s2"] .line')).toHaveClass("line-flash"));
  });

  it("si no se ha hablado, lo dice sin citas", async () => {
    mount();
    await screen.findByText("Empezamos con el plan.");
    await ask("¿Han mencionado Zaragoza?");
    expect(await screen.findByText("No, todavía no se ha hablado de eso.")).toBeInTheDocument();
  });

  it("enseña el error que venga en la respuesta", async () => {
    const { api, controls } = mount();
    await screen.findByText("Empezamos con el plan.");
    api.liveAsk = async () => "r1";
    await ask("¿Qué tal?");
    await screen.findByRole("status", { name: "Pensando" });
    act(() => controls.emit("live:answer", { requestId: "r1", done: true, error: "La IA ha tardado demasiado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La IA ha tardado demasiado");
  });

  it("propone preguntas para empezar", async () => {
    mount();
    expect(await screen.findByRole("button", { name: "¿Qué se ha decidido hasta ahora?" })).toBeInTheDocument();
  });
});

describe("modelo del chat en directo", () => {
  const NAN = "https://api.nan.builders/v1";
  const withNan = (m: ReturnType<typeof createMockApi>) => {
    m.controls.state.settings.llm.providers.push({ id: "nan", label: "NaN Builders", enabled: true, kind: { type: "openAiCompatible", baseUrl: NAN, model: "deepseek-v4-pro", apiKey: null }, timeoutS: 600 });
    m.controls.state.remoteModels[NAN] = ["deepseek-v4-pro", "qwen-max"];
  };
  const ask = async (q: string) => {
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), `${q}{Enter}`);
  };

  it("sin elegir, pregunta con el proveedor de Ajustes", async () => {
    const { controls } = mount(SEGS, withNan);
    await screen.findByText("Empezamos con el plan.");
    const trigger = await screen.findByRole("button", { name: /^Modelo de IA/ });
    await waitFor(() => expect(trigger).toHaveTextContent("Claude Code (CLI)"));
    await ask("¿Han mencionado Zaragoza?");
    await screen.findByText("No, todavía no se ha hablado de eso.");
    expect(controls.state.liveLlm).toEqual([null]);
  });

  it("el modelo elegido va en la siguiente pregunta y se recuerda para esa grabación", async () => {
    const { controls } = mount(SEGS, withNan);
    await screen.findByText("Empezamos con el plan.");
    await userEvent.click(await screen.findByRole("button", { name: /^Modelo de IA/ }));
    await userEvent.click(await screen.findByRole("option", { name: "NaN Builders · qwen-max" }));
    expect(screen.getByRole("button", { name: /^Modelo de IA/ })).toHaveTextContent("NaN Builders · qwen-max");
    await ask("¿Han mencionado Zaragoza?");
    await screen.findByText("No, todavía no se ha hablado de eso.");
    expect(controls.state.liveLlm).toEqual([{ providerId: "nan", model: "qwen-max" }]);
    expect(JSON.parse(localStorage.getItem("acta.chat.llm.live:m1") ?? "null")).toEqual({ providerId: "nan", model: "qwen-max" });
  });

  it("Detener cancela la respuesta en el backend y conserva lo recibido", async () => {
    const { api, controls } = mount();
    await screen.findByText("Empezamos con el plan.");
    api.liveAsk = async () => "r1";
    await ask("¿Qué tal?");
    await screen.findByRole("status", { name: "Pensando" });
    act(() => controls.emit("live:answer", { requestId: "r1", delta: "A medias", done: false }));
    await userEvent.click(await screen.findByRole("button", { name: "Detener" }));
    expect(controls.state.cancelled).toEqual(["r1"]);
    expect(screen.getByText("A medias")).toBeInTheDocument();
    expect(screen.getByText("Respuesta detenida")).toBeInTheDocument();
    expect(screen.getAllByText("A medias")).toHaveLength(1);
  });
});

describe("directo en la ventana principal", () => {
  const recording = (): SessionSnapshot => ({
    state: { state: "recording", meetingId: "m1", app: null, startedAt: Date.now(), stopPrompt: null },
    elapsedMs: 5_000,
    warnings: [],
    screenSharing: false,
    captureCount: 0,
    at: Date.now(),
  });

  function setup() {
    const mock = createMockApi();
    mock.controls.state.snapshot = recording();
    mock.controls.pushLive("m1", SEGS);
    render(<App api={mock.api} />);
    return mock;
  }

  it("mientras graba, la barra lateral ofrece «En directo»", async () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    await userEvent.click(await within(nav).findByRole("button", { name: "En directo" }));
    expect(await screen.findByRole("heading", { name: "En directo" })).toBeInTheDocument();
    expect(await screen.findByText("Empezamos con el plan.")).toBeInTheDocument();
  });

  it("sin grabación no hay «En directo»", async () => {
    render(<App api={createMockApi().api} />);
    await screen.findByRole("button", { name: /Daily del equipo/ });
    expect(screen.queryByRole("button", { name: "En directo" })).not.toBeInTheDocument();
  });

  it("la pastilla abre el directo de la reunión que se está grabando", async () => {
    const { api } = setup();
    await within(screen.getByRole("navigation", { name: "Secciones" })).findByRole("button", { name: "En directo" });
    await act(() => api.mainWindowShow("m1"));
    expect(await screen.findByRole("heading", { name: "En directo" })).toBeInTheDocument();
  });

  it("al parar, pasa a la reunión", async () => {
    const { controls } = setup();
    const d = controls.state.meetings[0]!;
    d.meeting.id = "m1";
    await userEvent.click(await within(screen.getByRole("navigation", { name: "Secciones" })).findByRole("button", { name: "En directo" }));
    await screen.findByRole("heading", { name: "En directo" });
    act(() => controls.emit("session:state", { ...recording(), state: { state: "stopping", meetingId: "m1", reason: "user" } }));
    expect(await screen.findByRole("heading", { name: "Daily del equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "En directo" })).not.toBeInTheDocument();
  });
});
