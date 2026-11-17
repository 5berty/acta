import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type GroupSuggestion } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { GroupsContainer } from "./GroupsContainer";

function setup(seed: Parameters<typeof createMockApi>[0] = {}) {
  const mock = createMockApi(seed);
  const onOpenMeeting = vi.fn();
  render(
    <ApiProvider api={mock.api}>
      <GroupsContainer onOpenMeeting={onOpenMeeting} />
    </ApiProvider>,
  );
  return { ...mock, onOpenMeeting };
}

describe("GroupsContainer", () => {
  it("crea un grupo", async () => {
    const { controls } = setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Nombre del grupo nuevo" }), "Producto");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    expect(await screen.findByRole("button", { name: /Producto/ })).toBeInTheDocument();
    expect(controls.state.groups.map((g) => g.name)).toEqual(["Producto"]);
  });

  it("acepta una sugerencia con otro nombre", async () => {
    const sug: GroupSuggestion = { id: "s1", name: "Sprint planning", description: null, meetingIds: ["a", "b", "c"], cohesion: 0.9, createdAt: 0 };
    const { controls } = setup({ suggestions: [sug] });
    const box = await screen.findByRole("region", { name: "Grupos sugeridos" });
    const input = within(box).getByRole("textbox", { name: "Nombre de la sugerencia Sprint planning" });
    await userEvent.clear(input);
    await userEvent.type(input, "Planificación");
    await userEvent.click(within(box).getByRole("button", { name: "Aceptar Sprint planning" }));
    await waitFor(() => expect(controls.state.groups[0]?.name).toBe("Planificación"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Grupos sugeridos" })).not.toBeInTheDocument());
  });

  it("rechaza una sugerencia", async () => {
    const sug: GroupSuggestion = { id: "s1", name: "Ruido", description: null, meetingIds: [], cohesion: 0.8, createdAt: 0 };
    const { controls } = setup({ suggestions: [sug] });
    await userEvent.click(await screen.findByRole("button", { name: "Descartar Ruido" }));
    await waitFor(() => expect(controls.state.suggestions).toHaveLength(0));
  });

  it("abre un grupo, lista sus reuniones y permite añadir otra", async () => {
    const d = sampleMeeting();
    const { api, controls } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    controls.state.groups = [...controls.state.groups];
    // El contenedor ya cargó: forzamos recarga con el botón de actualizar.
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Otro");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Añadir reunión" }));
    await userEvent.click(await screen.findByRole("option", { name: /Daily del equipo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Añadir 1 reunión" }));
    expect(await screen.findByRole("button", { name: /^Daily del equipo/ })).toBeInTheDocument();
    expect(controls.state.groups.find((x) => x.id === g.id)!.meetingCount).toBe(1);
  });

  it("«Sugerir título» nombra el grupo por lo que se habló en sus reuniones", async () => {
    const d = sampleMeeting();
    const { api, controls } = setup({ meetings: [d] });
    const g = await api.groupCreate("test");
    await api.groupAddMeeting(g.id, d.meeting.id);
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Otro");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^test/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Sugerir título" }));
    await waitFor(() => expect(controls.state.groups.find((x) => x.id === g.id)!.name).toBe("Seguimiento: Daily del equipo"));
    expect(screen.getByRole("textbox", { name: "Nombre del grupo" })).toHaveValue("Seguimiento: Daily del equipo");
  });

  it("quita una reunión del grupo", async () => {
    const d = sampleMeeting();
    const { api } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    await api.groupAddMeeting(g.id, d.meeting.id);
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "X");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Quitar Daily del equipo del grupo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Daily del equipo/ })).not.toBeInTheDocument());
  });

  it("las citas del chat del grupo abren la reunión en su instante", async () => {
    const d = sampleMeeting();
    const { api, controls, onOpenMeeting } = setup({ meetings: [d] });
    const g = await api.groupCreate("Producto");
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "X");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    const t = await api.chatThreadCreate({ kind: "group", groupId: g.id });
    controls.state.messages.push({
      id: "a1",
      threadId: t.id,
      role: "assistant",
      content: "Se acordó [1]",
      citations: [{ n: 1, meetingId: d.meeting.id, meetingTitle: "Daily del equipo", at: 65_000, end: 70_000, snippet: "" }],
      provider: null,
      createdAt: 0,
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Producto/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Daily del equipo, 01:05" }));
    expect(onOpenMeeting).toHaveBeenCalledWith(d.meeting.id, 65_000);
  });

  it("elimina un grupo tras confirmar", async () => {
    const { api, controls } = setup();
    await api.groupCreate("Borrar");
    await userEvent.type(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), "Z");
    await userEvent.click(screen.getByRole("button", { name: "Crear grupo" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(await screen.findByRole("button", { name: /^Borrar/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar grupo" }));
    await waitFor(() => expect(controls.state.groups.map((g) => g.name)).toEqual(["Z"]));
  });
});
