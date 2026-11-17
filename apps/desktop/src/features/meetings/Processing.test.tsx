import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type AvailableProvider } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { humanizeError } from "../../shared/format";
import { MeetingDetailContainer } from "./MeetingDetailContainer";
import { ProcessingStatus } from "./ProcessingStatus";
import { RetryMenu } from "./RetryMenu";
import { trackProgress, type StepTimings } from "./useProcessingTimeline";

const PROVIDERS: AvailableProvider[] = [
  { providerId: "claude-cli", label: "Claude Code (CLI)", kind: "claudeCli", models: ["sonnet", "opus"], defaultModel: "sonnet", isDefault: true, defaultFor: ["minutes", "chat"] },
  { providerId: "codex", label: "Codex", kind: "codexCli", models: [], defaultModel: null, isDefault: false, defaultFor: [] },
];

describe("RetryMenu", () => {
  it("el botón principal reintenta con lo de siempre", async () => {
    const onRetry = vi.fn();
    render(<RetryMenu onRetry={onRetry} loadProviders={async () => PROVIDERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("la flecha abre «Reintentar con…» con los proveedores y sus modelos", async () => {
    const onRetry = vi.fn();
    render(<RetryMenu onRetry={onRetry} loadProviders={async () => PROVIDERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar con…" }));
    const menu = await screen.findByRole("menu", { name: "Reintentar con…" });
    expect(await within(menu).findByText("Claude Code (CLI)")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Claude Code (CLI) · sonnet" })).toHaveTextContent("por defecto");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Claude Code (CLI) · opus" }));
    expect(onRetry).toHaveBeenCalledWith({ providerId: "claude-cli", model: "opus" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("un proveedor sin lista de modelos se elige entero", async () => {
    const onRetry = vi.fn();
    render(<RetryMenu onRetry={onRetry} loadProviders={async () => PROVIDERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar con…" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Codex" }));
    expect(onRetry).toHaveBeenCalledWith({ providerId: "codex", model: null });
  });

  it("se maneja con el teclado y Esc lo cierra", async () => {
    const onRetry = vi.fn();
    render(<RetryMenu onRetry={onRetry} loadProviders={async () => PROVIDERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar con…" }));
    await screen.findByRole("menuitem", { name: "Codex" });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onRetry).toHaveBeenCalledWith({ providerId: "claude-cli", model: "opus" });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar con…" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("modo discreto: un solo botón cuyo menú empieza por el proveedor por defecto", async () => {
    const onRetry = vi.fn();
    render(<RetryMenu quiet label="Regenerar el acta" menuLabel="Regenerar con…" onRetry={onRetry} loadProviders={async () => PROVIDERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerar el acta" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Proveedor por defecto" }));
    expect(onRetry).toHaveBeenCalledWith(null);
  });

  it("sin proveedores lo dice", async () => {
    render(<RetryMenu onRetry={() => {}} loadProviders={async () => []} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar con…" }));
    expect(await screen.findByText("No hay proveedores de IA activados.")).toBeInTheDocument();
  });
});

describe("error del acta con proveedor y modelo", () => {
  it("dice qué proveedor y modelo respondieron mal", () => {
    const h = humanizeError("invalid JSON: expected value at line 1", { provider: "Claude Code (CLI)", model: "sonnet" });
    expect(h.title).toBe("Claude Code (CLI) ha respondido con un formato que acta no entiende");
    expect(h.hint).toContain("sonnet");
    expect(h.hint).toContain("Reintentar con…");
  });

  it("si el propio error trae proveedor y modelo, manda el error", () => {
    const h = humanizeError("El modelo devolvió un JSON que no cumple el esquema (proveedor: NaN Builders, modelo: qwen3.6)", { provider: "Claude Code (CLI)", model: null });
    expect(h.title).toBe("NaN Builders ha respondido con un formato que acta no entiende");
    expect(h.hint).toContain("qwen3.6");
  });

  it("sin contexto sigue siendo comprensible", () => {
    expect(humanizeError("schema mismatch").title).toBe("La IA ha respondido con un formato que acta no entiende");
  });

  it("el aviso enseña el proveedor en los fallos de la IA", () => {
    render(<ProcessingStatus status="failed" error="timeout tras 600 s" llm={{ provider: "Claude Code (CLI)", model: "opus" }} onRetry={() => {}} />);
    expect(screen.getByText("La IA ha tardado demasiado")).toBeInTheDocument();
    expect(screen.getByText("Claude Code (CLI) · opus")).toBeInTheDocument();
  });
});

describe("pasos del procesado", () => {
  it("trackProgress apunta cuándo empieza y acaba cada paso", () => {
    let t: StepTimings = {};
    t = trackProgress(t, "transcribing", 1_000);
    t = trackProgress(t, "transcribing", 2_000);
    t = trackProgress(t, "diarizing", 43_000);
    expect(t).toEqual({ transcribing: { startedAt: 1_000, endedAt: 43_000 }, diarizing: { startedAt: 43_000 } });
  });

  it("enseña cada paso con su estado y su tiempo", () => {
    const timings: StepTimings = { concatenating: { startedAt: 0, endedAt: 3_000 }, transcribing: { startedAt: 3_000, endedAt: 45_000 }, diarizing: { startedAt: 45_000 } };
    render(<ProcessingStatus status="processing" step="diarizing" fraction={0.25} timings={timings} now={52_000} />);
    const steps = within(screen.getByRole("list", { name: "Pasos del procesado" })).getAllByRole("listitem");
    expect(steps).toHaveLength(7);
    expect(steps[1]).toHaveTextContent("Transcribiendo");
    expect(steps[1]).toHaveTextContent("00:42");
    expect(steps[1]).toHaveAttribute("data-state", "done");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).toHaveTextContent("Separando hablantes");
    expect(steps[2]).toHaveTextContent("00:07");
    expect(steps[4]).toHaveAttribute("data-state", "pending");
    expect(steps[4]).toHaveTextContent("Resumiendo");
    expect(screen.getByText("3 de 7")).toBeInTheDocument();
  });

  it("los pasos anteriores al primero que se vio cuentan como hechos, sin tiempo", () => {
    render(<ProcessingStatus status="processing" step="summarizing" timings={{ summarizing: { startedAt: 10_000 } }} now={12_000} />);
    const steps = within(screen.getByRole("list", { name: "Pasos del procesado" })).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("data-state", "done");
    expect(steps[0]).not.toHaveTextContent(/\d\d:\d\d/);
    expect(steps[4]).toHaveTextContent("00:02");
  });

  it("la fila de la lista sigue siendo compacta", () => {
    render(<ProcessingStatus variant="row" status="processing" step="diarizing" fraction={0.25} />);
    expect(screen.queryByRole("list", { name: "Pasos del procesado" })).not.toBeInTheDocument();
  });
});

function mount(mutate: (d: ReturnType<typeof sampleMeeting>) => void = () => {}) {
  const { api, controls } = createMockApi();
  const d = controls.state.meetings[0]!;
  mutate(d);
  render(
    <ApiProvider api={api}>
      <MeetingDetailContainer meetingId={d.meeting.id} onBack={() => {}} onOpenMeeting={() => {}} />
    </ApiProvider>,
  );
  return { api, controls, d };
}

describe("reintentar desde la reunión", () => {
  const failed = (d: ReturnType<typeof sampleMeeting>) => {
    d.meeting.status = "failed";
    d.meeting.error = "invalid JSON: expected value";
    d.minutes = null;
  };

  it("el aviso nombra al proveedor del acta y Reintentar no repite la transcripción si ya existe", async () => {
    const { controls, d } = mount(failed);
    expect(await screen.findByText("Claude Code (CLI) ha respondido con un formato que acta no entiende")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(controls.state.retries).toEqual([{ meetingId: d.meeting.id, steps: ["summarizing", "indexing", "pruningCaptures"], llm: null }]));
  });

  it("sin transcripción, reintenta desde el principio", async () => {
    const { controls } = mount((d) => {
      failed(d);
      d.transcript.utterances = [];
    });
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(controls.state.retries[0]?.steps).toEqual([]));
  });

  it("«Reintentar con…» manda el proveedor y el modelo elegidos", async () => {
    const { controls } = mount(failed);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar con…" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Claude Code (CLI) · opus" }));
    await waitFor(() => expect(controls.state.retries[0]?.llm).toEqual({ providerId: "claude-cli", model: "opus" }));
  });

  it("con acta, «Regenerar con…» en la cabecera del resumen rehace solo el acta", async () => {
    const { controls } = mount();
    const summary = await screen.findByRole("region", { name: "Resumen" });
    expect(await within(summary).findByText("Claude Code (CLI)")).toBeInTheDocument();
    await userEvent.click(within(summary).getByRole("button", { name: "Regenerar el acta" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Claude Code (CLI) · haiku" }));
    await waitFor(() => expect(controls.state.retries).toEqual([expect.objectContaining({ steps: ["summarizing", "indexing"], llm: { providerId: "claude-cli", model: "haiku" } })]));
  });
});

describe("mientras se procesa", () => {
  const processing = (d: ReturnType<typeof sampleMeeting>) => {
    d.meeting.status = "processing";
    d.minutes = null;
    d.transcript.utterances = [];
  };

  it("enseña los pasos según llegan", async () => {
    const { controls, d } = mount(processing);
    await screen.findByRole("heading", { name: "Daily del equipo" });
    act(() => controls.emit("processing:progress", { meetingId: d.meeting.id, step: "transcribing", fraction: 0.2 }));
    act(() => controls.emit("processing:progress", { meetingId: d.meeting.id, step: "diarizing", fraction: 0 }));
    const steps = within(await screen.findByRole("list", { name: "Pasos del procesado" })).getAllByRole("listitem");
    expect(steps[1]).toHaveAttribute("data-state", "done");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
  });

  it("si hubo transcripción en directo, se puede leer ya mientras llega el acta", async () => {
    const { api, controls } = createMockApi();
    const d = controls.state.meetings[0]!;
    processing(d);
    controls.pushLive(d.meeting.id, [
      { id: "s1", speaker: "otros", text: "Hablemos de las subcuentas.", startMs: 1_000, endMs: 3_000, final: true },
      { id: "s2", speaker: "yo", text: "Me parece bien.", startMs: 4_000, endMs: 5_000, final: true },
    ]);
    render(
      <ApiProvider api={api}>
        <MeetingDetailContainer meetingId={d.meeting.id} onBack={() => {}} onOpenMeeting={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByText("Hablemos de las subcuentas.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Transcripción provisional/)).toBeInTheDocument();
    expect(screen.getByText("Otros")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Resumen" }));
    expect(screen.getByText("Generando el acta…")).toBeInTheDocument();
  });
});
