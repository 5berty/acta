import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type MeetingDetail } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { GroupPicker } from "./GroupPicker";
import { MeetingPicker } from "./MeetingPicker";

function meeting(title: string, line: string, patch: Partial<MeetingDetail["meeting"]> = {}): MeetingDetail {
  const d = sampleMeeting();
  d.meeting = { ...d.meeting, title, ...patch };
  d.transcript.utterances[0]!.text = line;
  return d;
}

function setupMeetings(exclude: string[] = []) {
  const a = meeting("Daily del equipo", "Empezamos con el plan.", { startedAt: new Date(2026, 10, 12, 10, 30).getTime(), duration: 45 * 60_000 });
  const b = meeting("Revisión de diseño", "Hay que revisar las subcuentas.");
  const c = meeting("Comité técnico", "Nada que señalar.");
  const { api, controls } = createMockApi({ meetings: [a, b, c] });
  const onAdd = vi.fn();
  const ids = [a, b, c].map((m) => m.meeting.id);
  render(
    <ApiProvider api={api}>
      <MeetingPicker excludeIds={exclude.length ? exclude : []} onAdd={onAdd} />
      <button type="button">fuera</button>
    </ApiProvider>,
  );
  return { api, controls, onAdd, ids, a, b, c };
}

const open = async (name = "Añadir reunión") => {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name });
};

describe("MeetingPicker", () => {
  it("abre un buscador con fecha, duración, app y participantes de cada reunión", async () => {
    setupMeetings();
    const dialog = await open();
    expect(within(dialog).getByRole("combobox", { name: "Buscar reuniones" })).toHaveFocus();
    const row = await within(dialog).findByRole("option", { name: /Daily del equipo/ });
    expect(row).toHaveTextContent("12 nov");
    expect(row).toHaveTextContent("10:30");
    expect(row).toHaveTextContent("45 min");
    expect(row.querySelector("[data-brand='teams']")).toBeInTheDocument();
    expect(row.querySelector(".avatar-stack")).toHaveAttribute("title", "Edu, Ana");
  });

  it("busca por título sin distinguir tildes", async () => {
    setupMeetings();
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("combobox"), "revision");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    expect(within(dialog).getByRole("option", { name: /Revisión de diseño/ })).toBeInTheDocument();
  });

  it("busca también en lo que se dijo y enseña la frase", async () => {
    setupMeetings();
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("combobox"), "subcuentas");
    const row = await within(dialog).findByRole("option", { name: /Revisión de diseño/ });
    expect(row).toHaveTextContent("Hay que revisar las subcuentas.");
    expect(row.querySelector("mark")?.textContent).toBe("subcuentas");
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
  });

  it("selecciona varias y las añade de una vez", async () => {
    const { onAdd, ids } = setupMeetings();
    const dialog = await open();
    const add = within(dialog).getByRole("button", { name: "Añadir reuniones" });
    expect(add).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole("option", { name: /Daily del equipo/ }));
    expect(within(dialog).getByRole("button", { name: "Añadir 1 reunión" })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("option", { name: /Comité técnico/ }));
    expect(within(dialog).getByRole("option", { name: /Comité técnico/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir 2 reuniones" }));
    expect(onAdd).toHaveBeenCalledWith([ids[0], ids[2]]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("las que ya están salen marcadas y no se pueden elegir", async () => {
    const m = setupMeetings();
    // Se monta otro con una excluida.
    render(
      <ApiProvider api={m.api}>
        <MeetingPicker label="Añadir más" excludeIds={[m.ids[1]!]} onAdd={m.onAdd} />
      </ApiProvider>,
    );
    const dialog = await open("Añadir más");
    const row = await within(dialog).findByRole("option", { name: /Revisión de diseño/ });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent("Ya está en el grupo");
    await userEvent.click(row);
    expect(within(dialog).getByRole("button", { name: "Añadir reuniones" })).toBeDisabled();
  });

  it("se maneja con el teclado: flechas, Intro marca, ⌘Intro añade, Esc cierra", async () => {
    const { onAdd, ids } = setupMeetings();
    const dialog = await open();
    await within(dialog).findByRole("option", { name: /Daily del equipo/ });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(within(dialog).getByRole("option", { name: /Revisión de diseño/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onAdd).toHaveBeenCalledWith([ids[1]]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir reunión" })).toHaveFocus();
  });

  it("se cierra al pulsar fuera", async () => {
    setupMeetings();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "fuera" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("si nada coincide lo dice", async () => {
    setupMeetings();
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("combobox"), "zzzz");
    expect(await within(dialog).findByText("Ninguna reunión coincide con «zzzz».")).toBeInTheDocument();
  });
});

describe("GroupPicker", () => {
  async function setupGroups() {
    const { api, controls } = createMockApi();
    const a = await api.groupCreate("Producto");
    const b = await api.groupCreate("Uno a uno con Ana");
    const onAdd = vi.fn();
    render(
      <ApiProvider api={api}>
        <GroupPicker memberOf={[a.id]} onAdd={onAdd} />
      </ApiProvider>,
    );
    return { api, controls, onAdd, a, b };
  }

  it("lista los grupos, con los actuales ya marcados, y añade a varios", async () => {
    const { onAdd, b } = await setupGroups();
    const dialog = await open("Añadir a grupo");
    expect(await within(dialog).findByRole("option", { name: /Producto/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(within(dialog).getByRole("option", { name: /Uno a uno con Ana/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir a 1 grupo" }));
    expect(onAdd).toHaveBeenCalledWith([b.id]);
  });

  it("crea un grupo con lo escrito y lo deja marcado", async () => {
    const { controls, onAdd } = await setupGroups();
    const dialog = await open("Añadir a grupo");
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Buscar grupos" }), "Proyecto Atlas");
    await userEvent.click(await within(dialog).findByRole("option", { name: "Crear grupo «Proyecto Atlas»" }));
    await waitFor(() => expect(controls.state.groups.map((g) => g.name)).toContain("Proyecto Atlas"));
    const created = controls.state.groups.find((g) => g.name === "Proyecto Atlas")!;
    await userEvent.click(await within(dialog).findByRole("button", { name: "Añadir a 1 grupo" }));
    expect(onAdd).toHaveBeenCalledWith([created.id]);
  });

  it("no ofrece crear un grupo que ya existe", async () => {
    await setupGroups();
    const dialog = await open("Añadir a grupo");
    await userEvent.type(within(dialog).getByRole("combobox"), "producto");
    await within(dialog).findByRole("option", { name: /Producto/ });
    expect(within(dialog).queryByRole("option", { name: /Crear grupo/ })).not.toBeInTheDocument();
  });
});
