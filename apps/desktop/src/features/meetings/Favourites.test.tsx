import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type MeetingDetail } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { App } from "../../app/App";
import { GroupsContainer } from "../groups/GroupsContainer";
import { MeetingListContainer } from "./MeetingListContainer";

function meeting(title: string, text = "Hablamos del presupuesto anual."): MeetingDetail {
  const m = sampleMeeting();
  m.meeting.title = title;
  m.transcript.utterances[0]!.text = text;
  return m;
}
const rowOf = async (title: string | RegExp) => (await screen.findByRole("button", { name: title })).closest("li")!;

function list(extra: MeetingDetail[] = []) {
  const mock = createMockApi();
  mock.controls.state.meetings.push(...extra);
  render(
    <ApiProvider api={mock.api}>
      <MeetingListContainer onOpen={() => {}} />
    </ApiProvider>,
  );
  return mock;
}

describe("favoritas en la lista de reuniones", () => {
  it("la estrella de la fila marca y desmarca, y se guarda", async () => {
    const { controls } = list();
    const row = await rowOf(/Daily del equipo/);
    const star = within(row).getByRole("button", { name: "Marcar como favorita" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(star);
    expect(await within(row).findByRole("button", { name: "Quitar de favoritas" })).toHaveAttribute("aria-pressed", "true");
    expect(controls.state.meetings[0]!.meeting.favourite).toBe(true);
    await userEvent.click(within(row).getByRole("button", { name: "Quitar de favoritas" }));
    await waitFor(() => expect(controls.state.meetings[0]!.meeting.favourite).toBe(false));
  });

  it("marcar no abre la reunión", async () => {
    const mock = createMockApi();
    const onOpen = vi.fn();
    render(
      <ApiProvider api={mock.api}>
        <MeetingListContainer onOpen={onOpen} />
      </ApiProvider>,
    );
    await userEvent.click(within(await rowOf(/Daily del equipo/)).getByRole("button", { name: "Marcar como favorita" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("el filtro «Favoritas» deja solo las marcadas y las de grupos con estrella", async () => {
    const { api, controls } = list([meeting("Kickoff"), meeting("Retro")]);
    await screen.findByText("Retro");
    const g = await api.groupCreate("Proyecto");
    await api.groupAddMeeting(g.id, controls.state.meetings[2]!.meeting.id);
    await api.groupSetFavourite(g.id, true);
    await userEvent.click(within(await rowOf(/Daily del equipo/)).getByRole("button", { name: "Marcar como favorita" }));

    const filter = screen.getByRole("button", { name: "Favoritas" });
    expect(filter).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.queryByText("Kickoff")).not.toBeInTheDocument());
    expect(screen.getByText("Daily del equipo")).toBeInTheDocument();
    expect(screen.getByText("Retro")).toBeInTheDocument();
  });

  it("con el filtro puesto, la búsqueda solo mira en las favoritas", async () => {
    const { api, controls } = list([meeting("Presupuesto con estrella"), meeting("Presupuesto sin estrella")]);
    await screen.findByText("Presupuesto sin estrella");
    await api.meetingSetFavourite(controls.state.meetings[1]!.meeting.id, true);
    await userEvent.click(screen.getByRole("button", { name: "Favoritas" }));
    const box = screen.getByRole("searchbox", { name: "Buscar reuniones" });
    expect(box).toHaveAttribute("placeholder", "Buscar en tus favoritas");
    await userEvent.type(box, "presupuesto");
    await waitFor(() => expect(screen.queryByText("Presupuesto sin estrella")).not.toBeInTheDocument());
    expect(screen.getByText("Presupuesto con estrella")).toBeInTheDocument();
  });

  it("sin favoritas explica para qué sirven", async () => {
    list();
    await screen.findByText("Daily del equipo");
    await userEvent.click(screen.getByRole("button", { name: "Favoritas" }));
    expect(await screen.findByText("Todavía no tienes favoritas")).toBeInTheDocument();
    expect(screen.getByText(/Nunca se sugieren para borrar/)).toBeInTheDocument();
  });
});

describe("favoritas en el detalle de la reunión", () => {
  it("la cabecera tiene la estrella y refleja el estado guardado", async () => {
    const mock = createMockApi();
    render(<App api={mock.api} />);
    await userEvent.click(await screen.findByRole("button", { name: /Daily del equipo/ }));
    await screen.findByRole("heading", { name: "Daily del equipo" });
    await userEvent.click(screen.getByRole("button", { name: "Marcar como favorita" }));
    expect(await screen.findByRole("button", { name: "Quitar de favoritas" })).toHaveAttribute("aria-pressed", "true");
    expect(mock.controls.state.meetings[0]!.meeting.favourite).toBe(true);
    // Al volver, la fila ya sale marcada.
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    const row = (await screen.findByRole("button", { name: /Daily del equipo/ })).closest("li")!;
    expect(within(row).getByRole("button", { name: "Quitar de favoritas" })).toBeInTheDocument();
  });
});

describe("grupos favoritos", () => {
  async function groups() {
    const mock = createMockApi();
    await mock.api.groupCreate("Proyecto Atlas");
    await mock.api.groupCreate("Dailies");
    render(
      <ApiProvider api={mock.api}>
        <GroupsContainer onOpenMeeting={() => {}} />
      </ApiProvider>,
    );
    const listEl = await screen.findByRole("list", { name: "Tus grupos" });
    return { ...mock, listEl };
  }

  it("la estrella de la lista marca el grupo y el filtro «Favoritos» deja solo esos", async () => {
    const { controls, listEl } = await groups();
    const atlas = within(listEl).getByRole("button", { name: /Proyecto Atlas/ }).closest("li")!;
    await userEvent.click(within(atlas).getByRole("button", { name: "Marcar como favorito" }));
    await waitFor(() => expect(controls.state.groups[0]!.favourite).toBe(true));

    const filter = screen.getByRole("group", { name: "Qué grupos ver" });
    await userEvent.click(within(filter).getByRole("button", { name: "Favoritos" }));
    expect(within(listEl).queryByRole("button", { name: /Dailies/ })).not.toBeInTheDocument();
    expect(within(listEl).getByRole("button", { name: /Proyecto Atlas/ })).toBeInTheDocument();
    await userEvent.click(within(filter).getByRole("button", { name: "Todos" }));
    expect(within(listEl).getByRole("button", { name: /Dailies/ })).toBeInTheDocument();
  });

  it("sin grupos favoritos el filtro lo explica", async () => {
    await groups();
    await userEvent.click(within(screen.getByRole("group", { name: "Qué grupos ver" })).getByRole("button", { name: "Favoritos" }));
    expect(screen.getByText(/Aún no tienes grupos favoritos/)).toBeInTheDocument();
  });

  it("la vista del grupo tiene su estrella", async () => {
    const { controls, listEl } = await groups();
    await userEvent.click(within(listEl).getByRole("button", { name: /Dailies/ }));
    const detail = await screen.findByRole("region", { name: "Grupo Dailies" });
    await userEvent.click(within(detail).getByRole("button", { name: "Marcar como favorito" }));
    await waitFor(() => expect(controls.state.groups[1]!.favourite).toBe(true));
    expect(await within(detail).findByRole("button", { name: "Quitar de favoritos" })).toBeInTheDocument();
  });
});

describe("favoritas en la búsqueda rápida (⌘K)", () => {
  async function palette(extra: MeetingDetail[] = []) {
    const mock = createMockApi();
    mock.controls.state.meetings.push(...extra);
    render(<App api={mock.api} />);
    await screen.findByRole("searchbox", { name: "Buscar reuniones" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Búsqueda rápida" });
    return { ...mock, dialog };
  }

  it("⌘D marca como favorita la reunión resaltada, sin cerrar", async () => {
    const { controls, dialog } = await palette();
    const input = within(dialog).getByRole("combobox", { name: "Buscar en acta" });
    await within(dialog).findByRole("option", { name: /Daily del equipo/ });
    fireEvent.keyDown(input, { key: "d", metaKey: true });
    await waitFor(() => expect(controls.state.meetings[0]!.meeting.favourite).toBe(true));
    expect(screen.getByRole("dialog", { name: "Búsqueda rápida" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Quitar de favoritas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("la estrella de un resultado también marca, y no abre la reunión", async () => {
    const { controls, dialog } = await palette();
    const option = await within(dialog).findByRole("option", { name: /Daily del equipo/ });
    await userEvent.click(within(option).getByRole("button", { name: "Marcar como favorita" }));
    await waitFor(() => expect(controls.state.meetings[0]!.meeting.favourite).toBe(true));
    expect(screen.getByRole("dialog", { name: "Búsqueda rápida" })).toBeInTheDocument();
  });

  it("con «Favoritas» activado busca solo en reuniones con estrella y en sus transcripts", async () => {
    const starred = meeting("Con estrella", "Aprobamos el presupuesto anual.");
    starred.meeting.favourite = true;
    const { api, dialog } = await palette([starred, meeting("Sin estrella", "Otro presupuesto distinto.")]);
    const search = vi.spyOn(api, "search");
    const listSpy = vi.spyOn(api, "meetingsList");
    await userEvent.click(within(dialog).getByRole("button", { name: "Favoritas" }));
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Buscar en acta" }), "presupuesto");
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ text: "presupuesto", scope: { kind: "favourites" }, limit: 6 }));
    expect(listSpy).toHaveBeenLastCalledWith({ text: "presupuesto", favouritesOnly: true, limit: 6 });
    expect(await within(dialog).findByRole("option", { name: /Aprobamos el presupuesto anual/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /Otro presupuesto distinto/ })).not.toBeInTheDocument();
  });

  it("los grupos también salen, se pueden marcar y abrir", async () => {
    const mock = createMockApi();
    await mock.api.groupCreate("Proyecto Atlas");
    render(<App api={mock.api} />);
    await screen.findByRole("searchbox", { name: "Buscar reuniones" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Búsqueda rápida" });
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Buscar en acta" }), "atlas");
    const option = await within(dialog).findByRole("option", { name: /Proyecto Atlas/ });
    await userEvent.click(within(option).getByRole("button", { name: "Marcar como favorito" }));
    await waitFor(() => expect(mock.controls.state.groups[0]!.favourite).toBe(true));
    await userEvent.click(option);
    expect(await screen.findByRole("region", { name: "Grupo Proyecto Atlas" })).toBeInTheDocument();
  });
});
