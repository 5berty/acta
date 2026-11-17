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

/** Abre una sección desde la lista de la izquierda (como en Ajustes del Sistema). */
async function goTo(name: string) {
  const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
  await userEvent.click(within(nav).getByRole("button", { name }));
}
const advanced = (name = "Avanzado") => userEvent.click(screen.getByRole("button", { name }));

describe("SettingsContainer", () => {
  it("empieza en General y lista las secciones como Ajustes del Sistema", async () => {
    setup();
    expect(await screen.findByRole("region", { name: "General" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones de ajustes" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "General",
      "Grabación y autoparada",
      "Detección",
      "Capturas",
      "Proveedores de IA",
      "Modelos",
      "Permisos",
      "Acerca de",
    ]);
    await goTo("Permisos");
    expect(screen.queryByRole("region", { name: "General" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Permisos" })).toHaveAttribute("aria-current", "page");
  });

  it("la barra de guardado solo aparece cuando hay cambios", async () => {
    setup();
    await goTo("Capturas");
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Capturar la pantalla compartida" }));
    expect(screen.getByText("Tienes cambios sin guardar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Capturar la pantalla compartida" })).not.toBeChecked();
  });

  it("confirma que se ha guardado", async () => {
    setup();
    await goTo("Capturas");
    await userEvent.click(screen.getByRole("checkbox", { name: "Capturar la pantalla compartida" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Cambios guardados");
  });

  it("guarda tu nombre y tus alias", async () => {
    const { controls } = setup();
    const name = await screen.findByLabelText("Tu nombre");
    expect(name).toHaveValue("Edu");
    await userEvent.clear(name);
    await userEvent.type(name, "Eduardo");
    const aliases = screen.getByLabelText("Otros nombres");
    await userEvent.clear(aliases);
    await userEvent.type(aliases, "Edu, Navajas");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.user).toEqual({ displayName: "Eduardo", aliases: ["Edu", "Navajas"] }));
  });

  it("esconde lo técnico de un proveedor tras «Avanzado»", async () => {
    setup();
    await goTo("Proveedores de IA");
    const section = await screen.findByRole("region", { name: "Proveedores de IA" });
    expect(within(section).getByText("Instalado en tu Mac")).toBeInTheDocument();
    expect(within(section).queryByLabelText("Ruta del binario de Claude Code (CLI)")).not.toBeInTheDocument();
    expect(within(section).queryByText(/Variables de entorno/)).not.toBeInTheDocument();
    await advanced("Avanzado de Claude Code (CLI)");
    expect(within(section).getByLabelText("Ruta del binario de Claude Code (CLI)")).toHaveValue("/opt/homebrew/bin/claude");
    expect(within(section).getByText(/Variables de entorno/)).toBeInTheDocument();
  });

  it("avisa si falta localizar el CLI", async () => {
    const mock = createMockApi();
    const k = mock.controls.state.settings.llm.providers[0]!.kind;
    if (k.type === "claudeCli") k.binaryPath = "";
    render(
      <ApiProvider api={mock.api}>
        <SettingsContainer />
      </ApiProvider>,
    );
    await goTo("Proveedores de IA");
    expect(await screen.findByText(/Sin localizar/)).toBeInTheDocument();
  });

  it("enseña las apps por su nombre, no por su identificador", async () => {
    setup();
    await goTo("Detección");
    const section = await screen.findByRole("region", { name: "Detección" });
    expect(within(section).getByText("Microsoft Teams")).toBeInTheDocument();
    expect(within(section).queryByText("com.microsoft.teams2")).not.toBeInTheDocument();
    expect(within(section).queryByLabelText("Identificador de la app")).not.toBeInTheDocument();
  });

  it("añade una app habitual con un toque", async () => {
    const { controls } = setup();
    await goTo("Detección");
    await userEvent.click(await screen.findByRole("button", { name: "Añadir Zoom" }));
    expect(screen.queryByRole("button", { name: "Añadir Zoom" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.rules).toContainEqual({ bundleId: "us.zoom.xos", platform: "zoom", isBrowser: false }));
  });

  it("edita las palabras clave como fichas", async () => {
    const { controls } = setup();
    await goTo("Capturas");
    await userEvent.type(await screen.findByLabelText("Palabras clave"), "urgente{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Quitar «importante»" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.screen.keywords).toEqual(["apuntad", "esto es clave", "deadline", "fecha", "urgente"]));
  });

  it("los contadores suben y bajan con sus botones", async () => {
    const { controls } = setup();
    await goTo("Grabación y autoparada");
    await userEvent.click(await screen.findByRole("button", { name: "Aumentar: Minutos de silencio antes de preguntar" }));
    expect(screen.getByLabelText("Minutos de silencio antes de preguntar")).toHaveValue(4);
    await userEvent.click(screen.getByRole("button", { name: "Reducir: Duración máxima (horas)" }));
    expect(screen.getByLabelText("Duración máxima (horas)")).toHaveValue(3.5);
    await advanced();
    expect(screen.getByLabelText("Umbral de silencio (dBFS)")).toHaveValue(-50);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.autoStop).toMatchObject({ silencePromptAfterMs: 240_000, maxDurationMs: 12_600_000 }));
  });

  it("acerca de: versión a la vista y la carpeta de datos en Avanzado", async () => {
    setup();
    await goTo("Acerca de");
    const section = await screen.findByRole("region", { name: "Acerca de" });
    expect(await within(section).findByText("0.1.0-mock")).toBeInTheDocument();
    expect(within(section).queryByText("/tmp/acta")).not.toBeInTheDocument();
    await advanced();
    expect(within(section).getByText("/tmp/acta")).toBeInTheDocument();
  });

  it("muestra el proveedor por defecto y prueba la conexión", async () => {
    const { api } = setup();
    await goTo("Proveedores de IA");
    const spy = vi.spyOn(api, "llmProviderTest");
    const section = await screen.findByRole("region", { name: "Proveedores de IA" });
    expect(within(section).getByLabelText("Nombre de Claude Code (CLI)")).toHaveValue("Claude Code (CLI)");
    await userEvent.click(within(section).getByRole("button", { name: "Probar conexión Claude Code (CLI)" }));
    expect(await within(section).findByText(/OK \(mock\)/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("claude-cli");
  });

  it("guarda la ruta del binario editada", async () => {
    const { controls } = setup();
    await goTo("Proveedores de IA");
    await advanced("Avanzado de Claude Code (CLI)");
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
    await goTo("Proveedores de IA");
    vi.spyOn(api, "llmCliDetect").mockResolvedValue({ claude: "/x/claude", codex: "/x/codex", claudeEnv: { CLAUDE_CONFIG_DIR: "/h/.claude-personal" }, codexEnv: {} });
    await userEvent.click(await screen.findByRole("button", { name: "Detectar CLI instalados" }));
    await userEvent.click(await screen.findByRole("button", { name: "Avanzado de Codex (CLI)" }));
    await advanced("Avanzado de Claude Code (CLI)");
    expect(await screen.findByDisplayValue("/x/codex")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/x/claude")).toBeInTheDocument();
    expect(screen.getByDisplayValue("CLAUDE_CONFIG_DIR")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/h/.claude-personal")).toBeInTheDocument();
  });

  it("edita el esfuerzo y las variables de entorno de Claude", async () => {
    const { controls } = setup();
    await goTo("Proveedores de IA");
    await advanced("Avanzado de Claude Code (CLI)");
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
    await goTo("Proveedores de IA");
    const set = vi.spyOn(api, "secretSet");
    const del = vi.spyOn(api, "secretDelete");
    await userEvent.click(await screen.findByRole("button", { name: "Añadir Otro servidor compatible" }));
    const input = await screen.findByLabelText("Clave de API de OpenAI compatible");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk-secreto");
    await userEvent.click(screen.getByRole("button", { name: "Guardar en el Llavero OpenAI compatible" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("custom", "sk-secreto"));
    await waitFor(() => expect(input).toHaveValue(""));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => {
      const k = controls.state.settings.llm.providers[1]!.kind;
      expect(k.type === "openAiCompatible" && k.apiKey).toEqual({ service: "acta", account: "provider:custom" });
    });
    expect(JSON.stringify(controls.state.settings)).not.toContain("sk-secreto");
    await userEvent.click(screen.getByRole("button", { name: "Borrar clave OpenAI compatible" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("custom"));
  });

  it("lista los modelos y descarga uno con progreso", async () => {
    const { api } = setup();
    await goTo("Modelos");
    const dl = vi.spyOn(api, "modelsDownload");
    const section = await screen.findByRole("region", { name: "Modelos" });
    const diar = await within(section).findByRole("listitem", { name: "Separar hablantes" });
    expect(within(await within(section).findByRole("listitem", { name: "Transcripción" })).getByText(/Descargado/)).toBeInTheDocument();
    await userEvent.click(within(diar).getByRole("button", { name: "Descargar Separar hablantes" }));
    expect(dl).toHaveBeenCalledWith("diarizer");
    await waitFor(() => expect(within(diar).getByText(/Descargado/)).toBeInTheDocument());
  });

  it("muestra el error de descarga de un modelo", async () => {
    const { controls } = setup();
    await goTo("Modelos");
    const section = await screen.findByRole("region", { name: "Modelos" });
    await within(section).findByRole("listitem", { name: "Detección de voz" });
    act(() => controls.emit("model:download", { name: "vad", fraction: 0.2, done: false, error: "sin red" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("sin red");
  });

  it("edita la lista de apps que nunca disparan la detección", async () => {
    const { controls } = setup();
    await goTo("Detección");
    await advanced();
    await userEvent.type(await screen.findByLabelText("Identificador de la app a ignorar"), "com.typeless.app");
    await userEvent.click(screen.getByRole("button", { name: "Ignorar app" }));
    expect(screen.getByText("Typeless")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.denylist).toEqual(["com.typeless.app"]));
    await userEvent.click(screen.getByRole("button", { name: "Dejar de ignorar Typeless" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.denylist).toEqual([]));
  });

  it("añade un proveedor compatible con OpenAI", async () => {
    setup();
    await goTo("Proveedores de IA");
    await userEvent.click(await screen.findByRole("button", { name: "Añadir Otro servidor compatible" }));
    expect(await screen.findByLabelText("URL base de OpenAI compatible")).toBeInTheDocument();
  });

  it("elige el proveedor por tarea", async () => {
    const { controls } = setup();
    await goTo("Proveedores de IA");
    const sel = await screen.findByLabelText("Proveedor para el acta");
    expect(sel).toHaveValue("claude-cli");
    await userEvent.selectOptions(sel, "");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBeNull());
  });

  it("autoparada en minutos y horas", async () => {
    const { controls } = setup();
    await goTo("Grabación y autoparada");
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
    await goTo("Permisos");
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

  describe("permisos al día", () => {
    const row = async (name: string) => within(await screen.findByRole("region", { name: "Permisos" })).getByRole("listitem", { name });
    const grant = (controls: ReturnType<typeof createMockApi>["controls"], kind: string) => {
      controls.state.permissions = controls.state.permissions.map((p) => (p.kind === kind ? { ...p, status: "granted" } : p));
    };

    it("al volver a la ventana se vuelve a comprobar y la fila cambia", async () => {
      const { controls } = setup();
      await goTo("Permisos");
      expect(within(await row("Audio del sistema")).getByText("Sin comprobar")).toBeInTheDocument();
      grant(controls, "systemAudio");
      act(() => void window.dispatchEvent(new Event("focus")));
      await waitFor(async () => expect(within(await row("Audio del sistema")).getByText("Concedido")).toBeInTheDocument());
      expect(within(await row("Audio del sistema")).queryByRole("button", { name: "Abrir Ajustes del Sistema" })).not.toBeInTheDocument();
    });

    it("también al volver a ser visible (cambio de espacio o de app)", async () => {
      const { api, controls } = setup();
      await goTo("Permisos");
      await row("Accesibilidad");
      const status = vi.spyOn(api, "permissionsStatus");
      grant(controls, "accessibility");
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(async () => expect(within(await row("Accesibilidad")).getByText("Concedido")).toBeInTheDocument());
      expect(status).toHaveBeenCalled();
    });

    it("`permissions:changed` actualiza la fila en el acto", async () => {
      const { controls } = setup();
      await goTo("Permisos");
      await row("Grabación de pantalla");
      act(() => controls.emit("permissions:changed", { kind: "screenRecording", status: "granted" }));
      expect(within(await row("Grabación de pantalla")).getByText("Concedido")).toBeInTheDocument();
    });

    it("con la sección abierta sondea cada poco; fuera de ella, no", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        const { api, controls } = setup();
        const status = vi.spyOn(api, "permissionsStatus");
        await screen.findByRole("region", { name: "General" });
        act(() => void vi.advanceTimersByTime(6_500));
        expect(status).not.toHaveBeenCalled();
        await goTo("Permisos");
        grant(controls, "systemAudio");
        act(() => void vi.advanceTimersByTime(2_100));
        await waitFor(async () => expect(within(await row("Audio del sistema")).getByText("Concedido")).toBeInTheDocument());
      } finally {
        vi.useRealTimers();
      }
    });

    it("el aviso rojo de la lista desaparece cuando se concede lo que faltaba", async () => {
      const { controls } = setup();
      controls.state.permissions = controls.state.permissions.map((p) => (p.kind === "microphone" ? { ...p, status: "denied" } : p));
      act(() => void window.dispatchEvent(new Event("focus")));
      const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
      await waitFor(() => expect(nav.querySelector(".settings-nav-alert")).toBeInTheDocument());
      grant(controls, "microphone");
      act(() => void window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(nav.querySelector(".settings-nav-alert")).not.toBeInTheDocument());
    });
  });

  it("muestra el progreso de descarga de modelos", async () => {
    const { controls } = setup();
    await goTo("Modelos");
    const section = await screen.findByRole("region", { name: "Modelos" });
    await within(section).findByRole("listitem", { name: "Transcripción" });
    act(() => controls.emit("model:download", { name: "asr", fraction: 0.5, done: false, error: null }));
    expect(await screen.findByRole("progressbar", { name: "Descargando Transcripción" })).toHaveAttribute("aria-valuenow", "50");
    act(() => controls.emit("model:download", { name: "asr", fraction: 1, done: true, error: null }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it("activar las capturas es opt-in explícito", async () => {
    const { controls } = setup();
    await goTo("Capturas");
    const toggle = await screen.findByRole("checkbox", { name: "Capturar la pantalla compartida" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.screen.enabled).toBe(true));
  });

  it("añade y quita reglas de detección", async () => {
    const { controls } = setup();
    await goTo("Detección");
    await advanced();
    await userEvent.type(await screen.findByLabelText("Identificador de la app"), "us.zoom.xos");
    await userEvent.selectOptions(screen.getByLabelText("Tipo de reunión"), "zoom");
    await userEvent.click(screen.getByRole("button", { name: "Añadir app" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar Microsoft Teams" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.detection.rules.map((r) => r.bundleId)).toEqual(["us.zoom.xos"]));
  });

  it("borra una huella de voz", async () => {
    const { controls } = setup({ voiceprints: [{ id: "v1", displayName: "Ana", samples: 3, meetings: 2, updatedAt: 0 }] });
    await goTo("General");
    await userEvent.click(await screen.findByRole("button", { name: "Olvidar la voz de Ana" }));
    await waitFor(() => expect(controls.state.voiceprints).toHaveLength(0));
  });
});
