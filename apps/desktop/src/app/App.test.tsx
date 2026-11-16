import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../api";
import { App } from "./App";

function setup() {
  const mock = createMockApi();
  render(<App api={mock.api} />);
  return mock;
}

describe("App", () => {
  it("abre en la lista de reuniones y entra al detalle", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /Daily del equipo/ }));
    expect(await screen.findByRole("heading", { name: "Daily del equipo" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByRole("searchbox", { name: "Buscar reuniones" })).toBeInTheDocument();
  });

  it("navega a grupos, preguntar y ajustes", async () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    await userEvent.click(within(nav).getByRole("button", { name: "Grupos" }));
    expect(await screen.findByText("Elige un grupo")).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "Preguntar" }));
    expect(await screen.findByRole("textbox", { name: "Pregunta" })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "Ajustes" }));
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
  });

  it("permite empezar a grabar a mano y refleja el estado", async () => {
    const { api } = setup();
    const spy = vi.spyOn(api, "sessionStart");
    await userEvent.click(await screen.findByRole("button", { name: "Grabar ahora" }));
    expect(spy).toHaveBeenCalled();
    expect(await screen.findByText(/Grabando/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Grabar ahora" })).not.toBeInTheDocument());
  });

  it("una cita de otra pantalla abre la reunión", async () => {
    const mock = setup();
    const d = mock.controls.state.meetings[0]!;
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    await userEvent.click(within(nav).getByRole("button", { name: "Preguntar" }));
    const t = await mock.api.chatThreadCreate({ kind: "all" });
    mock.controls.state.messages.push({
      id: "a",
      threadId: t.id,
      role: "assistant",
      content: "Mira [1]",
      citations: [{ n: 1, meetingId: d.meeting.id, meetingTitle: "Daily del equipo", at: 4_500, end: 9_000, snippet: "" }],
      provider: null,
      createdAt: 0,
    });
    await userEvent.click(within(nav).getByRole("button", { name: "Reuniones" }));
    await userEvent.click(within(nav).getByRole("button", { name: "Preguntar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Daily del equipo, 00:04" }));
    expect(await screen.findByRole("heading", { name: "Daily del equipo" })).toBeInTheDocument();
  });
});
