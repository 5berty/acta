import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type MeetingDetail } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { MeetingListContainer } from "./MeetingListContainer";
import { ProcessingStatus } from "./ProcessingStatus";

function setup(extra: MeetingDetail[] = []) {
  const { api, controls } = createMockApi();
  controls.state.meetings.push(...extra);
  const onOpen = vi.fn();
  render(
    <ApiProvider api={api}>
      <MeetingListContainer onOpen={onOpen} />
    </ApiProvider>,
  );
  return { api, controls, onOpen };
}

describe("MeetingListContainer", () => {
  it("lista las reuniones y abre una al hacer clic", async () => {
    const { onOpen, controls } = setup();
    const row = await screen.findByRole("button", { name: /Daily del equipo/ });
    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(controls.state.meetings[0]!.meeting.id);
  });

  it("filtra por texto", async () => {
    const other = sampleMeeting();
    other.meeting.title = "Revisión de presupuesto";
    setup([other]);
    await screen.findByText("Revisión de presupuesto");
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar reuniones" }), "presupuesto");
    await waitFor(() => expect(screen.queryByText("Daily del equipo")).not.toBeInTheDocument());
    expect(screen.getByText("Revisión de presupuesto")).toBeInTheDocument();
  });

  it("filtra por grupo", async () => {
    const { api, controls } = createMockApi();
    const other = sampleMeeting();
    other.meeting.title = "Sin grupo";
    controls.state.meetings.push(other);
    const g = await api.groupCreate("Producto");
    await api.groupAddMeeting(g.id, controls.state.meetings[0]!.meeting.id);
    render(
      <ApiProvider api={api}>
        <MeetingListContainer onOpen={() => {}} />
      </ApiProvider>,
    );
    await screen.findByText("Sin grupo");
    fireEvent.change(await screen.findByLabelText("Grupo"), { target: { value: g.id } });
    await waitFor(() => expect(screen.queryByText("Sin grupo")).not.toBeInTheDocument());
    expect(screen.getByText("Daily del equipo")).toBeInTheDocument();
  });

  it("muestra el progreso de procesado en vivo", async () => {
    const proc = sampleMeeting();
    proc.meeting.title = "Procesando ahora";
    proc.meeting.status = "processing";
    const { controls } = setup([proc]);
    await screen.findByText("Procesando ahora");
    act(() => controls.emit("processing:progress", { meetingId: proc.meeting.id, step: "diarizing", fraction: 0.4 }));
    expect(await screen.findByText(/Diarizando/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  it("agrupa por día: hoy, ayer y meses anteriores", async () => {
    const yesterday = sampleMeeting();
    yesterday.meeting.title = "Retro de ayer";
    yesterday.meeting.startedAt = Date.now() - 86_400_000 - 3_600_000;
    const old = sampleMeeting();
    old.meeting.title = "Kickoff antiguo";
    old.meeting.startedAt = new Date(2025, 2, 10, 10).getTime();
    setup([yesterday, old]);
    const march = await screen.findByRole("region", { name: "Marzo de 2025" });
    expect(within(march).getByText("Kickoff antiguo")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ayer" })).getByText("Retro de ayer")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Hoy" })).getByText("Daily del equipo")).toBeInTheDocument();
  });

  it("una reunión fallida se puede reintentar desde la lista", async () => {
    const failed = sampleMeeting();
    failed.meeting.title = "Se torció";
    failed.meeting.status = "failed";
    const { api } = setup([failed]);
    const spy = vi.spyOn(api, "meetingReprocess");
    await screen.findByText("Se torció");
    expect(screen.getByText("Acta sin terminar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ meetingId: failed.meeting.id }));
  });

  it("resume tus tareas pendientes en la fila", async () => {
    setup();
    expect(await screen.findByText("1 tarea tuya")).toBeInTheDocument();
  });

  it("sin reuniones enseña cómo funciona y deja empezar a grabar", async () => {
    const { api } = createMockApi({ meetings: [] });
    const spy = vi.spyOn(api, "sessionStart");
    render(
      <ApiProvider api={api}>
        <MeetingListContainer onOpen={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByText("Se transcribe en tu Mac")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Empezar a grabar" }));
    expect(spy).toHaveBeenCalledWith(null);
  });

  it("si un filtro deja la lista vacía, lo dice", async () => {
    setup();
    await userEvent.type(await screen.findByRole("searchbox", { name: "Buscar reuniones" }), "zzz");
    expect(await screen.findByText("Ninguna reunión coincide")).toBeInTheDocument();
  });

  it("muestra estado vacío", async () => {
    const { api } = createMockApi({ meetings: [] });
    render(
      <ApiProvider api={api}>
        <MeetingListContainer onOpen={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByText("Todavía no hay reuniones")).toBeInTheDocument();
  });
});

describe("ProcessingStatus", () => {
  it("ofrece reintentar cuando falla", async () => {
    const onRetry = vi.fn();
    render(<ProcessingStatus status="failed" error="sin red" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("explica el fallo en cristiano y deja ver el detalle técnico", async () => {
    render(<ProcessingStatus status="failed" error="error: connection refused (sin red)" onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No hay conexión con la IA");
    expect(screen.queryByText(/connection refused/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver detalle" }));
    expect(screen.getByText(/connection refused \(sin red\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ocultar detalle" }));
    expect(screen.queryByText(/connection refused/)).not.toBeInTheDocument();
  });
  it("sin mensaje de error no ofrece detalle, pero sí tranquiliza", () => {
    render(<ProcessingStatus status="failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("El audio está a salvo");
    expect(screen.queryByRole("button", { name: "Ver detalle" })).not.toBeInTheDocument();
  });
  it("cuenta el paso del procesado", () => {
    render(<ProcessingStatus status="processing" step="diarizing" fraction={0.25} />);
    expect(screen.getByText("3 de 7")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Diarizando" })).toHaveAttribute("aria-valuenow", "25");
  });
  it("en cola, sin paso todavía", () => {
    render(<ProcessingStatus status="processing" />);
    expect(screen.getByText(/En cola/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("no pinta nada si está lista", () => {
    const { container } = render(<ProcessingStatus status="ready" />);
    expect(container).toBeEmptyDOMElement();
  });
});
