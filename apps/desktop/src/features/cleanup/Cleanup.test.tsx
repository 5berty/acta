import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type CleanupCandidate, type MeetingDetail } from "../../api";
import { defaultSettings, sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { MeetingListContainer } from "../meetings/MeetingListContainer";
import { SettingsContainer } from "../settings/SettingsContainer";
import { ago, formatSize, reasonLabel, reasonLabels } from "./reasons";

const DAY = 86_400_000;

function old(title: string, daysAgo: number, bytes: number, reasons: CleanupCandidate["reasons"] = [{ kind: "old", days: daysAgo }, { kind: "neverUsed" }]): { detail: MeetingDetail; candidate: CleanupCandidate } {
  const detail = sampleMeeting();
  detail.meeting.title = title;
  detail.meeting.startedAt = Date.now() - daysAgo * DAY;
  return { detail, candidate: { meetingId: detail.meeting.id, title, startedAt: detail.meeting.startedAt, duration: 45_000, reasons, bytes } };
}

function setup(seedSettings: Partial<ReturnType<typeof defaultSettings>["cleanup"]> = {}) {
  const a = old("Sync de marzo", 200, 800_000_000, [{ kind: "old", days: 200 }, { kind: "neverUsed" }, { kind: "short", durationMs: 45_000 }, { kind: "littleContent", words: 12 }]);
  const b = old("Prueba de micro", 150, 400_000_000, [{ kind: "old", days: 150 }, { kind: "unusedFor", days: 140 }, { kind: "failed" }]);
  const base = defaultSettings();
  const mock = createMockApi({ meetings: [sampleMeeting(), a.detail, b.detail], cleanup: [a.candidate, b.candidate], settings: { ...base, cleanup: { ...base.cleanup, ...seedSettings } } });
  const onOpen = vi.fn();
  render(
    <ApiProvider api={mock.api}>
      <MeetingListContainer onOpen={onOpen} />
    </ApiProvider>,
  );
  return { ...mock, onOpen, a, b };
}
const banner = () => screen.findByRole("complementary", { name: "Sugerencia de limpieza" });
async function openSheet() {
  await userEvent.click(within(await banner()).getByRole("button", { name: /Revisar/ }));
  return screen.findByRole("dialog", { name: "Reuniones antiguas" });
}

describe("sugerencia de limpieza de reuniones antiguas", () => {
  it("avisa con calma de cuántas hay y cuánto ocupan, sin borrar nada", async () => {
    const { controls } = setup();
    const b = await banner();
    expect(within(b).getByText("Tienes 2 reuniones antiguas que quizá ya no necesites")).toBeInTheDocument();
    expect(within(b).getByText("Ocupan 1,2 GB. No se borra nada sin que lo revises.")).toBeInTheDocument();
    expect(controls.state.meetings).toHaveLength(3);
  });

  it("no aparece si no hay nada que sugerir, si está apagada o si se pospuso", async () => {
    for (const cleanup of [{ enabled: false }, { snoozedUntil: Date.now() + DAY }]) {
      const { unmount } = render(<span />);
      unmount();
      setup(cleanup);
      await screen.findAllByText("Sync de marzo");
      expect(screen.queryByRole("complementary", { name: "Sugerencia de limpieza" })).not.toBeInTheDocument();
      document.body.innerHTML = "";
    }
  });

  it("un aplazamiento ya vencido vuelve a avisar", async () => {
    setup({ snoozedUntil: Date.now() - DAY });
    expect(await banner()).toBeInTheDocument();
  });

  it("«Recordármelo más tarde» la esconde una semana y lo guarda", async () => {
    const { controls } = setup();
    await userEvent.click(within(await banner()).getByRole("button", { name: "Recordármelo más tarde" }));
    expect(screen.queryByRole("complementary", { name: "Sugerencia de limpieza" })).not.toBeInTheDocument();
    await waitFor(() => expect(controls.state.settings.cleanup.snoozedUntil).toBeGreaterThan(Date.now() + 6 * DAY));
    expect(controls.state.meetings).toHaveLength(3);
  });

  it("la hoja lista cada reunión con sus motivos y su tamaño", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByText(/Tienen más de 90 días/)).toBeInTheDocument();
    const list = within(sheet).getByRole("list", { name: "Reuniones sugeridas" });
    const first = within(list).getByRole("listitem", { name: "Sync de marzo" });
    for (const text of ["Nunca la has abierto", "Dura menos de un minuto", "Casi sin contenido"]) expect(within(first).getByText(text)).toBeInTheDocument();
    expect(within(first).getByText(/800 MB/)).toBeInTheDocument();
    const second = within(list).getByRole("listitem", { name: "Prueba de micro" });
    expect(within(second).getByText("Sin usar desde hace 4 meses")).toBeInTheDocument();
    expect(within(second).getByText("Falló al procesarse")).toBeInTheDocument();
    expect(within(sheet).getByText("2 de 2 · 1,2 GB")).toBeInTheDocument();
  });

  it("se puede deseleccionar: solo se borra lo marcado, con confirmación y diciendo lo liberado", async () => {
    const { controls, b } = setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Seleccionar Sync de marzo" }));
    expect(within(sheet).getByText("1 de 2 · 400 MB")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Borrar seleccionadas" }));
    // Nada se borra hasta confirmar.
    const confirm = within(sheet).getByRole("alertdialog", { name: "Confirmar el borrado" });
    expect(within(confirm).getByText(/Se eliminan su audio, sus capturas y su transcripción, y se liberan 400 MB/)).toBeInTheDocument();
    expect(controls.state.meetings).toHaveLength(3);
    await userEvent.click(within(confirm).getByRole("button", { name: "Borrar 1 reunión" }));

    expect(await within(sheet).findByText("Se ha borrado 1 reunión")).toBeInTheDocument();
    expect(within(sheet).getByText("Has liberado 400 MB")).toBeInTheDocument();
    expect(controls.state.meetings.map((m) => m.meeting.title)).not.toContain(b.detail.meeting.title);
    expect(controls.state.meetings).toHaveLength(2);
    await userEvent.click(within(sheet).getByRole("button", { name: "Hecho" }));
    expect(screen.queryByRole("dialog", { name: "Reuniones antiguas" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Prueba de micro")).not.toBeInTheDocument());
    // Queda una por revisar: el aviso lo refleja.
    expect(await screen.findByText("Tienes 1 reunión antigua que quizá ya no necesites")).toBeInTheDocument();
  });

  it("cancelar la confirmación no borra nada", async () => {
    const { controls } = setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Borrar seleccionadas" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    expect(within(sheet).getByRole("button", { name: "Borrar seleccionadas" })).toBeInTheDocument();
    expect(controls.state.meetings).toHaveLength(3);
  });

  it("sin nada seleccionado no se puede borrar", async () => {
    setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Quitar selección" }));
    expect(within(sheet).getByRole("button", { name: "Borrar seleccionadas" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Mantener seleccionadas" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Seleccionar todas" }));
    expect(within(sheet).getByRole("button", { name: "Borrar seleccionadas" })).toBeEnabled();
  });

  it("«Mantener» la quita para siempre sin borrarla", async () => {
    const { controls, a } = setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Mantener Sync de marzo" }));
    await waitFor(() => expect(within(sheet).queryByRole("listitem", { name: "Sync de marzo" })).not.toBeInTheDocument());
    expect(controls.state.kept).toEqual([a.detail.meeting.id]);
    expect(controls.state.meetings).toHaveLength(3);
    expect((await controls.state.meetings.length) && (await screen.findByText("Tienes 1 reunión antigua que quizá ya no necesites"))).toBeInTheDocument();
  });

  it("«Recordármelo más tarde» desde la hoja la cierra y pospone el aviso", async () => {
    const { controls } = setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Recordármelo más tarde" }));
    expect(screen.queryByRole("dialog", { name: "Reuniones antiguas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Sugerencia de limpieza" })).not.toBeInTheDocument();
    await waitFor(() => expect(controls.state.settings.cleanup.snoozedUntil).not.toBeNull());
  });

  it("marcar una candidata como favorita la saca de la sugerencia", async () => {
    setup();
    await banner();
    const row = (await screen.findByRole("button", { name: /Sync de marzo/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Marcar como favorita" }));
    expect(await screen.findByText("Tienes 1 reunión antigua que quizá ya no necesites")).toBeInTheDocument();
  });

  it("desde la hoja se puede abrir una reunión para mirarla antes de decidir", async () => {
    const { onOpen, a } = setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Sync de marzo" }));
    expect(onOpen).toHaveBeenCalledWith(a.detail.meeting.id);
  });
});

describe("Ajustes › General › Limpieza", () => {
  async function general() {
    const mock = createMockApi();
    render(
      <ApiProvider api={mock.api}>
        <SettingsContainer />
      </ApiProvider>,
    );
    await screen.findByRole("region", { name: "General" });
    return mock;
  }

  it("se puede apagar y elegir la antigüedad", async () => {
    const { controls } = await general();
    expect(screen.getByText(/acta solo sugiere: nunca borra nada por su cuenta/)).toBeInTheDocument();
    const age = screen.getByRole("combobox", { name: "Antigüedad para sugerir" });
    expect(age).toHaveValue("90");
    await userEvent.selectOptions(age, "180");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.cleanup).toMatchObject({ enabled: true, minAgeDays: 180 }));

    await userEvent.click(screen.getByRole("checkbox", { name: "Sugerir borrar reuniones antiguas" }));
    expect(screen.queryByRole("combobox", { name: "Antigüedad para sugerir" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.cleanup.enabled).toBe(false));
  });
});

describe("textos de la limpieza", () => {
  it("tamaños como en Finder", () => {
    expect([formatSize(1_234_000_000), formatSize(340_400_000), formatSize(12_300), formatSize(12), formatSize(0)]).toEqual(["1,2 GB", "340 MB", "12 KB", "menos de 1 KB", "0 KB"]);
  });
  it("antigüedad en palabras", () => {
    expect([ago(1), ago(45), ago(95), ago(400), ago(800)]).toEqual(["hace 1 día", "hace 45 días", "hace 3 meses", "hace más de un año", "hace 2 años"]);
  });
  it("cada motivo tiene su etiqueta y la antigüedad no se repite", () => {
    expect(reasonLabel({ kind: "old", days: 100 })).toBeNull();
    expect(reasonLabel({ kind: "short", durationMs: 150_000 })).toBe("Dura 3 min");
    expect(reasonLabel({ kind: "littleContent", words: 0 })).toBe("Sin transcripción");
    expect(reasonLabels({ meetingId: "x", title: "", startedAt: 0, duration: 0, bytes: 0, reasons: [{ kind: "old", days: 100 }, { kind: "neverUsed" }] })).toEqual(["Nunca la has abierto"]);
  });
});
