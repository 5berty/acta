import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { MeetingDetailContainer } from "./MeetingDetailContainer";

function setup(mutate: (d: ReturnType<typeof sampleMeeting>) => void = () => {}, props: Partial<React.ComponentProps<typeof MeetingDetailContainer>> = {}) {
  const { api, controls } = createMockApi();
  const d = controls.state.meetings[0]!;
  d.audio = { mic: "/m/mic.wav", system: "/m/system.wav", mix: "/m/mix.wav" };
  mutate(d);
  const onBack = vi.fn();
  const view = render(
    <ApiProvider api={api}>
      <MeetingDetailContainer meetingId={d.meeting.id} onBack={onBack} onOpenMeeting={() => {}} {...props} />
    </ApiProvider>,
  );
  return { api, controls, d, onBack, ...view };
}

describe("MeetingDetailContainer", () => {
  it("carga la reunión y muestra el resumen", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Daily del equipo" })).toBeInTheDocument();
    expect(screen.getByText("Se revisó el plan del trimestre.")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Resumen", "Transcript", "Escaleta", "Timeline", "Capturas", "Chat"]);
  });

  it("marcar una tarea la persiste", async () => {
    const { controls } = setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Enviar presupuesto" }));
    await waitFor(() => expect(controls.state.meetings[0]!.minutes!.actionItems[0]!.done).toBe(true));
    expect(screen.getByRole("checkbox", { name: "Enviar presupuesto" })).toBeChecked();
  });

  it("pulsar una línea del transcript salta el audio", async () => {
    const { container } = setup();
    await userEvent.click(await screen.findByRole("tab", { name: "Transcript" }));
    await userEvent.click(screen.getByRole("button", { name: /Yo envío el presupuesto/ }));
    expect(container.querySelector("audio")!.currentTime).toBeCloseTo(4.5);
  });

  it("renombrar un hablante lo refleja", async () => {
    const { controls } = setup();
    await userEvent.click(await screen.findByRole("tab", { name: "Transcript" }));
    await userEvent.click(screen.getByRole("button", { name: "Renombrar a Ana" }));
    const input = screen.getByRole("combobox", { name: "Nombre del hablante" });
    await userEvent.clear(input);
    await userEvent.type(input, "Ana García");
    await userEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() => expect(screen.getAllByText("Ana García").length).toBeGreaterThan(0));
    expect(controls.state.meetings[0]!.transcript.speakers[1]!.confirmed).toBe(true);
  });

  it("edita el título", async () => {
    const { controls } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Editar título" }));
    const input = screen.getByRole("textbox", { name: "Título" });
    await userEvent.clear(input);
    await userEvent.type(input, "Plan Q4{Enter}");
    await waitFor(() => expect(controls.state.meetings[0]!.meeting.title).toBe("Plan Q4"));
    expect(await screen.findByRole("heading", { name: "Plan Q4" })).toBeInTheDocument();
  });

  it("si el procesado falló, permite reintentar", async () => {
    const { api } = setup((d) => {
      d.meeting.status = "failed";
      d.meeting.error = "claude no responde";
    });
    const spy = vi.spyOn(api, "meetingReprocess");
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ steps: expect.arrayContaining(["summarizing"]) }));
  });

  it("asigna la reunión a un grupo", async () => {
    const { api, controls } = setup();
    const g = await api.groupCreate("Producto");
    await userEvent.click(await screen.findByRole("button", { name: "Añadir a grupo" }));
    await userEvent.click(await screen.findByRole("option", { name: /Producto/ }));
    await userEvent.click(screen.getByRole("button", { name: "Añadir a 1 grupo" }));
    await waitFor(() => expect(controls.state.meetings[0]!.groups.map((x) => x.id)).toContain(g.id));
  });

  it("vuelve atrás", async () => {
    const { onBack } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Volver" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("elimina la reunión tras confirmar", async () => {
    const onBack = vi.fn();
    const { controls } = setup(() => {}, { onBack });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar reunión" }));
    await waitFor(() => expect(controls.state.meetings).toHaveLength(0));
    expect(onBack).toHaveBeenCalled();
  });
});
