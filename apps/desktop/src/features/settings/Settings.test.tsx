import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import { ApiProvider } from "../../app/ApiContext";
import { SettingsContainer } from "./SettingsContainer";

function setup(seed: Parameters<typeof createMockApi>[0] = {}) {
  const mock = createMockApi(seed);
  render(
    <ApiProvider api={mock.api}>
      <SettingsContainer />
    </ApiProvider>,
  );
  return mock;
}

describe("SettingsContainer", () => {
  it("muestra el proveedor por defecto y prueba la conexión", async () => {
    const { api } = setup();
    const spy = vi.spyOn(api, "llmProviderTest");
    const section = await screen.findByRole("region", { name: "Proveedores de IA" });
    expect(within(section).getByDisplayValue("/opt/homebrew/bin/claude")).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "Probar conexión Claude Code (CLI)" }));
    expect(await within(section).findByText(/OK \(mock\)/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("claude-cli");
  });

  it("guarda la ruta del binario editada", async () => {
    const { controls } = setup();
    const input = await screen.findByLabelText("Ruta del binario de Claude Code (CLI)");
    await userEvent.clear(input);
    await userEvent.type(input, "/usr/local/bin/claude");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      const k = controls.state.settings.llm.providers[0]!.kind;
      expect(k.type === "claudeCli" && k.binaryPath).toBe("/usr/local/bin/claude");
    });
  });

  it("detecta los CLI y añade Codex", async () => {
    const { api } = setup();
    vi.spyOn(api, "llmCliDetect").mockResolvedValue({ claude: "/x/claude", codex: "/x/codex", claudeEnv: { CLAUDE_CONFIG_DIR: "/h/.claude-personal" }, codexEnv: {} });
    await userEvent.click(await screen.findByRole("button", { name: "Detectar CLI instalados" }));
    expect(await screen.findByDisplayValue("/x/codex")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/x/claude")).toBeInTheDocument();
    expect(screen.getByDisplayValue("CLAUDE_CONFIG_DIR")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/h/.claude-personal")).toBeInTheDocument();
  });

  it("edita el esfuerzo y las variables de entorno de Claude", async () => {
    const { controls } = setup();
    await userEvent.selectOptions(await screen.findByLabelText("Esfuerzo de Claude Code (CLI)"), "high");
    await userEvent.click(screen.getByRole("button", { name: "Añadir variable a Claude Code (CLI)" }));
    await userEvent.type(screen.getByLabelText("Nombre de la variable 1 de Claude Code (CLI)"), "FOO");
    await userEvent.type(screen.getByLabelText("Valor de la variable 1 de Claude Code (CLI)"), "bar");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      const k = controls.state.settings.llm.providers[0]!.kind;
      expect(k.type === "claudeCli" && k.effort).toBe("high");
      expect(k.type === "claudeCli" && k.extraEnv).toEqual({ FOO: "bar" });
    });
    await userEvent.click(screen.getByRole("button", { name: "Quitar variable FOO de Claude Code (CLI)" }));
    await userEvent.selectOptions(screen.getByLabelText("Esfuerzo de Claude Code (CLI)"), "");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      const k = controls.state.settings.llm.providers[0]!.kind;
      expect(k.type === "claudeCli" && k.effort).toBeNull();
      expect(k.type === "claudeCli" && k.extraEnv).toEqual({});
    });
  });

  it("guarda y borra la clave de API en el Llavero", async () => {
    const { api, controls } = setup();
    const set = vi.spyOn(api, "secretSet");
    const del = vi.spyOn(api, "secretDelete");
    await userEvent.selectOptions(await screen.findByLabelText("Tipo de proveedor nuevo"), "openAiCompatible");
    await userEvent.click(screen.getByRole("button", { name: "Añadir proveedor" }));
    const input = await screen.findByLabelText("Clave de API de OpenAI compatible");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk-secreto");
    await userEvent.click(screen.getByRole("button", { name: "Guardar en el Llavero OpenAI compatible" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("openAiCompatible-1", "sk-secreto"));
    await waitFor(() => expect(input).toHaveValue(""));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      const k = controls.state.settings.llm.providers[1]!.kind;
      expect(k.type === "openAiCompatible" && k.apiKey).toEqual({ service: "acta", account: "provider:openAiCompatible-1" });
    });
    expect(JSON.stringify(controls.state.settings)).not.toContain("sk-secreto");
    await userEvent.click(screen.getByRole("button", { name: "Borrar clave OpenAI compatible" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("openAiCompatible-1"));
  });

  it("lista los modelos y descarga uno con progreso", async () => {
    const { api } = setup();
    const dl = vi.spyOn(api, "modelsDownload");
    const section = await screen.findByRole("region", { name: "Modelos" });
    const diar = await within(section).findByRole("listitem", { name: "Diarización" });
    expect(within(await within(section).findByRole("listitem", { name: "Transcripción" })).getByText(/Descargado/)).toBeInTheDocument();
    await userEvent.click(within(diar).getByRole("button", { name: "Descargar Diarización" }));
    expect(dl).toHaveBeenCalledWith("diarizer");
    await waitFor(() => expect(within(diar).getByText(/Descargado/)).toBeInTheDocument());
  });

  it("muestra el error de descarga de un modelo", async () => {
    const { controls } = setup();
    const section = await screen.findByRole("region", { name: "Modelos" });
    await within(section).findByRole("listitem", { name: "Detección de voz" });
    act(() => controls.emit("model:download", { name: "vad", fraction: 0.2, done: false, error: "sin red" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("sin red");
  });

  it("edita la lista de apps que nunca disparan la detección", async () => {
    const { controls } = setup();
    await userEvent.type(await screen.findByLabelText("Bundle id a ignorar"), "com.typeless.app");
    await userEvent.click(screen.getByRole("button", { name: "Añadir a ignoradas" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.denylist).toEqual(["com.typeless.app"]));
    await userEvent.click(screen.getByRole("button", { name: "Dejar de ignorar com.typeless.app" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.denylist).toEqual([]));
  });

  it("añade un proveedor compatible con OpenAI", async () => {
    setup();
    await userEvent.selectOptions(await screen.findByLabelText("Tipo de proveedor nuevo"), "openAiCompatible");
    await userEvent.click(screen.getByRole("button", { name: "Añadir proveedor" }));
    expect(await screen.findByLabelText("URL base de OpenAI compatible")).toBeInTheDocument();
  });

  it("elige el proveedor por tarea", async () => {
    const { controls } = setup();
    const sel = await screen.findByLabelText("Proveedor para el acta");
    expect(sel).toHaveValue("claude-cli");
    await userEvent.selectOptions(sel, "");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBeNull());
  });

  it("autoparada en minutos y horas", async () => {
    const { controls } = setup();
    const silence = await screen.findByLabelText("Minutos de silencio antes de preguntar");
    expect(silence).toHaveValue(3);
    await userEvent.clear(silence);
    await userEvent.type(silence, "5");
    const max = screen.getByLabelText("Duración máxima (horas)");
    expect(max).toHaveValue(4);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.autoStop.silencePromptAfterMs).toBe(300_000));
  });

  it("permisos: estado y acciones", async () => {
    const { api } = setup();
    const req = vi.spyOn(api, "permissionsRequest");
    const open = vi.spyOn(api, "openSystemSettings");
    const section = await screen.findByRole("region", { name: "Permisos" });
    const mic = within(section).getByRole("listitem", { name: "Micrófono" });
    expect(within(mic).getByText("Concedido")).toBeInTheDocument();
    const screenRec = within(section).getByRole("listitem", { name: "Grabación de pantalla" });
    await userEvent.click(within(screenRec).getByRole("button", { name: "Conceder" }));
    expect(req).toHaveBeenCalledWith("screenRecording");
    await userEvent.click(within(screenRec).getByRole("button", { name: "Abrir Ajustes del Sistema" }));
    expect(open).toHaveBeenCalledWith("screenRecording");
  });

  it("muestra el progreso de descarga de modelos", async () => {
    const { controls } = setup();
    const section = await screen.findByRole("region", { name: "Modelos" });
    await within(section).findByRole("listitem", { name: "Transcripción" });
    act(() => controls.emit("model:download", { name: "asr", fraction: 0.5, done: false, error: null }));
    expect(await screen.findByRole("progressbar", { name: "Descargando Transcripción" })).toHaveAttribute("aria-valuenow", "50");
    act(() => controls.emit("model:download", { name: "asr", fraction: 1, done: true, error: null }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it("activar las capturas es opt-in explícito", async () => {
    const { controls } = setup();
    const toggle = await screen.findByRole("checkbox", { name: "Capturar la pantalla compartida" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.screen.enabled).toBe(true));
  });

  it("añade y quita reglas de detección", async () => {
    const { controls } = setup();
    await userEvent.type(await screen.findByLabelText("Bundle id de la regla nueva"), "us.zoom.xos");
    await userEvent.selectOptions(screen.getByLabelText("Plataforma de la regla nueva"), "zoom");
    await userEvent.click(screen.getByRole("button", { name: "Añadir regla" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar com.microsoft.teams2" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.rules.map((r) => r.bundleId)).toEqual(["us.zoom.xos"]));
  });

  it("borra una huella de voz", async () => {
    const { controls } = setup({ voiceprints: [{ id: "v1", displayName: "Ana", samples: 3, meetings: 2, updatedAt: 0 }] });
    await userEvent.click(await screen.findByRole("button", { name: "Olvidar la voz de Ana" }));
    await waitFor(() => expect(controls.state.voiceprints).toHaveLength(0));
  });
});
