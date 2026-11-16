import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText(/sin red/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("no pinta nada si está lista", () => {
    const { container } = render(<ProcessingStatus status="ready" />);
    expect(container).toBeEmptyDOMElement();
  });
});
