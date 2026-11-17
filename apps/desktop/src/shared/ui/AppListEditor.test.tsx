import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InstalledApp } from "../../api";
import { AppListEditor, type AppListEntry, type AppsSource } from "./AppListEditor";

const app = (bundleId: string, name: string, over: Partial<InstalledApp> = {}): InstalledApp => ({ bundleId, name, path: `/Applications/${name}.app`, running: false, iconPath: `/icons/${bundleId}.png`, ...over });
const APPS = [app("com.apple.Safari", "Safari"), app("com.typeless.app", "Typeless", { running: true }), app("com.example.notes", "Árbol Notas", { iconPath: null }), app("com.superduper.superwhisper", "superwhisper", { running: true })];

function setup(over: { entries?: AppListEntry[]; source?: Partial<AppsSource>; suggestions?: InstalledApp[] } = {}) {
  const onPick = vi.fn();
  const onRemove = vi.fn();
  const reload = vi.fn();
  const source: AppsSource = { apps: APPS, error: null, reload, iconUrl: (p) => `asset://${p}`, ...over.source };
  render(
    <AppListEditor
      title="Apps ignoradas"
      foot="Apps que usan el micrófono pero no son reuniones."
      emptyText="Ninguna"
      entries={over.entries ?? []}
      source={source}
      removeLabel={(n) => `Dejar de ignorar ${n}`}
      suggestions={over.suggestions}
      suggestLabel={(n) => `Ignorar ${n}`}
      onPick={onPick}
      onRemove={onRemove}
    />,
  );
  const group = screen.getByRole("group", { name: "Apps ignoradas" });
  return { onPick, onRemove, reload, group };
}
const openPicker = async (group: HTMLElement) => {
  await userEvent.click(within(group).getByRole("button", { name: "Añadir app" }));
  return screen.findByRole("dialog", { name: "Añadir app: Apps ignoradas" });
};
const names = (dialog: HTMLElement) => within(dialog).getAllByRole("option").map((o) => o.getAttribute("aria-label"));

describe("AppListEditor", () => {
  it("cada fila enseña el icono, el nombre, el identificador y un botón para quitarla", async () => {
    const { group, onRemove } = setup({ entries: [{ bundleId: "com.typeless.app" }, { bundleId: "com.acme.super-notes", detail: "Teams" }] });
    const row = within(group).getByRole("listitem", { name: "Typeless" });
    expect(within(row).getByText("com.typeless.app")).toBeInTheDocument();
    const img = row.querySelector("img")!;
    expect(img).toHaveAttribute("src", "asset:///icons/com.typeless.app.png");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    // Una app que no está instalada: nombre deducido del identificador y un icono genérico.
    const other = within(group).getByRole("listitem", { name: "Super Notes" });
    expect(other.querySelector("img")).toBeNull();
    expect(other.querySelector(".app-icon-glyph")).toBeInTheDocument();
    expect(within(other).getByText(/Teams/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Dejar de ignorar Typeless" }));
    expect(onRemove).toHaveBeenCalledWith("com.typeless.app");
  });

  it("si el icono no carga, pone el genérico", () => {
    const { group } = setup({ entries: [{ bundleId: "com.typeless.app" }] });
    const row = within(group).getByRole("listitem", { name: "Typeless" });
    fireEvent.error(row.querySelector("img")!);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector(".app-icon-glyph")).toBeInTheDocument();
  });

  it("lista vacía: lo dice", () => {
    const { group } = setup();
    expect(within(group).getByText("Ninguna")).toBeInTheDocument();
  });

  it("el selector lista las apps con las que están en marcha primero y las ya añadidas desactivadas", async () => {
    const { group, onPick } = setup({ entries: [{ bundleId: "com.typeless.app" }] });
    const dialog = await openPicker(group);
    expect(names(dialog)).toEqual(["superwhisper", "Typeless", "Árbol Notas", "Safari"]);
    expect(within(within(dialog).getByRole("option", { name: "superwhisper" })).getByText("En marcha")).toBeInTheDocument();
    const taken = within(dialog).getByRole("option", { name: "Typeless" });
    expect(taken).toHaveAttribute("aria-disabled", "true");
    expect(within(taken).getByText("Ya añadida")).toBeInTheDocument();
    await userEvent.click(taken);
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("option", { name: "Safari" }));
    expect(onPick).toHaveBeenCalledWith({ bundleId: "com.apple.Safari", name: "Safari" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("busca por nombre (sin tildes) o por identificador y se maneja con el teclado", async () => {
    const { group, onPick } = setup();
    const dialog = await openPicker(group);
    const search = within(dialog).getByRole("combobox", { name: "Buscar app" });
    expect(search).toHaveFocus();
    await userEvent.type(search, "arbol");
    expect(names(dialog)).toEqual(["Árbol Notas"]);
    await userEvent.clear(search);
    await userEvent.type(search, "superduper");
    expect(names(dialog)).toEqual(["superwhisper"]);
    await userEvent.clear(search);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith({ bundleId: "com.typeless.app", name: "Typeless" });
  });

  it("sin coincidencias, lo dice y recuerda el identificador a mano", async () => {
    const { group } = setup();
    const dialog = await openPicker(group);
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Buscar app" }), "zzz");
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    expect(within(dialog).getByText(/Ninguna app coincide/)).toBeInTheDocument();
  });

  it("mientras se buscan las apps, lo indica", async () => {
    const { group } = setup({ source: { apps: null } });
    const dialog = await openPicker(group);
    expect(within(dialog).getByText("Buscando las apps de este Mac…")).toBeInTheDocument();
  });

  it("si no se pueden leer las apps, enseña el error y deja reintentar", async () => {
    const { group, reload } = setup({ source: { apps: null, error: "sin permiso" } });
    const dialog = await openPicker(group);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("sin permiso");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    expect(reload).toHaveBeenCalled();
  });

  it("a mano: valida el identificador, avisa de los repetidos y añade el bueno", async () => {
    const { group, onPick } = setup({ entries: [{ bundleId: "com.typeless.app" }] });
    await userEvent.click(within(group).getByRole("button", { name: "Avanzado de Apps ignoradas" }));
    const input = within(group).getByLabelText("Identificador de la app");
    const add = within(group).getByRole("button", { name: "Añadir por identificador" });
    await userEvent.click(add);
    expect(within(group).getByRole("alert")).toHaveTextContent(/Escribe el identificador/);
    await userEvent.type(input, "Typeless");
    expect(within(group).queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(add);
    expect(within(group).getByRole("alert")).toHaveTextContent(/no parece un identificador/);
    await userEvent.clear(input);
    await userEvent.type(input, "  COM.typeless.app ");
    await userEvent.click(add);
    expect(within(group).getByRole("alert")).toHaveTextContent("Typeless ya está en la lista.");
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "  com.example.dictado {Enter}");
    expect(onPick).toHaveBeenCalledWith({ bundleId: "com.example.dictado", name: "Dictado" });
    expect(input).toHaveValue("");
    expect(within(group).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sugerencias de un toque, con su icono", async () => {
    const { group, onPick } = setup({ suggestions: [APPS[1]!] });
    const chip = within(group).getByRole("button", { name: "Ignorar Typeless" });
    expect(chip.querySelector("img")).toHaveAttribute("src", "asset:///icons/com.typeless.app.png");
    await userEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith({ bundleId: "com.typeless.app", name: "Typeless" });
  });
});
