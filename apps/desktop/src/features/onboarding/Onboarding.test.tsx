import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import { defaultSettings } from "../../api/mock";
import { App } from "../../app/App";
import { NAN_REFERRAL_URL } from "../providers/presets";

type Seed = Parameters<typeof createMockApi>[0];

/** Primer arranque: la bienvenida aún no se ha visto. */
async function firstRun(seed: Seed = {}, prepare?: (api: ReturnType<typeof createMockApi>["api"]) => void) {
  const mock = createMockApi({ settings: { ...defaultSettings(), onboarding: { completed: false } }, ...seed });
  prepare?.(mock.api);
  render(<App api={mock.api} />);
  const dialog = await screen.findByRole("dialog", { name: "Bienvenida a acta" });
  return { ...mock, dialog };
}
const next = (name = "Continuar") => userEvent.click(screen.getByRole("button", { name }));
/** Avanza desde la bienvenida hasta el paso `n` (1 = Bienvenida). */
async function goToStep(n: number) {
  if (n > 1) await next("Empezar");
  for (let i = 2; i < n; i += 1) await next();
}
const OLLAMA = {
  ollama: { running: true, baseUrl: "http://127.0.0.1:11434/v1", models: ["qwen2.5:14b", "llama3.2:latest"] },
  lmStudio: { running: false, baseUrl: "http://127.0.0.1:1234/v1", models: [] },
};

describe("bienvenida de primer arranque", () => {
  it("no aparece si ya se vio", async () => {
    render(<App api={createMockApi().api} />);
    await screen.findByRole("button", { name: /Daily del equipo/ });
    expect(screen.queryByRole("dialog", { name: "Bienvenida a acta" })).not.toBeInTheDocument();
  });

  it("explica qué hace acta y que todo se queda en tu Mac", async () => {
    const { dialog } = await firstRun();
    expect(within(dialog).getByRole("heading", { name: "Te damos la bienvenida a acta" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Se queda en tu Mac/)).toBeInTheDocument();
    const steps = within(dialog).getByRole("list", { name: "Pasos" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Bienvenida", "Permisos", "Transcripción", "Inteligencia artificial", "Detección", "Listo"]);
    expect(within(steps).getByText("Bienvenida").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("se puede saltar y no vuelve a salir", async () => {
    const { dialog, api, controls } = await firstRun();
    await userEvent.click(within(dialog).getByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bienvenida a acta" })).not.toBeInTheDocument());
    expect(controls.state.settings.onboarding).toEqual({ completed: true });
    render(<App api={api} />);
    await screen.findAllByRole("button", { name: /Daily del equipo/ });
    expect(screen.queryByRole("dialog", { name: "Bienvenida a acta" })).not.toBeInTheDocument();
  });

  it("permisos: con dos navegadores abiertos, cada fila de Automatización dice para cuál es", async () => {
    const base = createMockApi().controls.state.permissions.filter((p) => p.kind !== "automation");
    const { dialog } = await firstRun({
      permissions: [
        ...base,
        { kind: "automation", status: "notDetermined", target: "com.google.Chrome" },
        { kind: "automation", status: "notDetermined", target: "com.brave.Browser" },
      ],
    });
    await goToStep(2);
    const rows = await within(dialog).findAllByRole("listitem", { name: /^Automatización/ });
    expect(rows.map((li) => li.getAttribute("aria-label"))).toEqual(["Automatización (Google Chrome)", "Automatización (Brave)"]);
    expect(within(rows[0]!).getByText(/Se pide para Google Chrome\./)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Se pide para Brave\./)).toBeInTheDocument();
  });

  it("permisos: dice para qué es cada uno, su estado al momento y cómo concederlo", async () => {
    const { dialog, api, controls } = await firstRun();
    const request = vi.spyOn(api, "permissionsRequest");
    const open = vi.spyOn(api, "openSystemSettings");
    await goToStep(2);
    expect(within(dialog).getByRole("heading", { name: "Permisos de macOS" })).toBeInTheDocument();
    const mic = await within(dialog).findByRole("listitem", { name: "Micrófono" });
    expect(within(mic).getByText("Para grabar tu voz.")).toBeInTheDocument();
    expect(within(mic).getByText("Concedido")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["Micrófono", "Audio del sistema", "Accesibilidad", "Automatización (Google Chrome)", "Grabación de pantalla"]),
    );
    const screenRec = within(dialog).getByRole("listitem", { name: "Grabación de pantalla" });
    expect(within(screenRec).getByText("Opcional")).toBeInTheDocument();
    const system = within(dialog).getByRole("listitem", { name: "Audio del sistema" });
    await userEvent.click(within(system).getByRole("button", { name: "Conceder" }));
    expect(request).toHaveBeenCalledWith("systemAudio");
    await userEvent.click(within(system).getByRole("button", { name: "Abrir Ajustes del Sistema" }));
    expect(open).toHaveBeenCalledWith("systemAudio");
    // Al volver de Ajustes del Sistema el estado se actualiza solo.
    controls.state.permissions = controls.state.permissions.map((p) => (p.kind === "systemAudio" ? { ...p, status: "granted" } : p));
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(within(system).getByText("Concedido")).toBeInTheDocument());
  });

  it("transcripción: descarga los modelos que faltan y enseña el progreso", async () => {
    const { dialog, api, controls } = await firstRun();
    const download = vi.spyOn(api, "modelsDownload").mockResolvedValue();
    await goToStep(3);
    expect(within(dialog).getByRole("heading", { name: "Transcripción en tu Mac" })).toBeInTheDocument();
    await within(dialog).findByRole("listitem", { name: "Separar hablantes" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Descargar todo" }));
    expect(download.mock.calls.map((c) => c[0])).toEqual(["diarizer", "vad"]);
    act(() => controls.emit("model:download", { name: "diarizer", fraction: 0.5, done: false, error: null }));
    expect(await within(dialog).findByRole("progressbar", { name: "Descargando Separar hablantes" })).toHaveAttribute("aria-valuenow", "50");
  });

  it("IA: reconoce el Claude Code de este Mac y lo deja configurado", async () => {
    const { dialog, controls } = await firstRun({}, (api) => {
      vi.spyOn(api, "llmCliDetect").mockResolvedValue({ claude: "/x/claude", codex: null, claudeEnv: { CLAUDE_CONFIG_DIR: "/h/.c" }, codexEnv: {} });
    });
    await goToStep(4);
    expect(within(dialog).getByRole("heading", { name: "¿Quién escribe tus actas?" })).toBeInTheDocument();
    const group = within(dialog).getByRole("radiogroup", { name: "Proveedor de IA" });
    const claude = within(group).getByRole("radio", { name: /Claude Code/ });
    expect(await within(claude).findByText("Detectado en este Mac")).toBeInTheDocument();
    expect(within(within(group).getByRole("radio", { name: /Codex/ })).getByText("No está instalado")).toBeInTheDocument();
    expect(claude).toHaveAttribute("aria-checked", "true");
    await next();
    await waitFor(() => expect(controls.state.settings.llm.providers[0]!.kind).toMatchObject({ binaryPath: "/x/claude", extraEnv: { CLAUDE_CONFIG_DIR: "/h/.c" } }));
    expect(controls.state.settings.llm.minutesProvider).toBe("claude-cli");
  });

  it("IA: un modelo local detectado en este Mac", async () => {
    const { dialog, controls } = await firstRun({ local: OLLAMA });
    await goToStep(4);
    await userEvent.click(within(dialog).getByRole("radio", { name: /Modelo local/ }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    const ollama = await within(dialog).findByRole("listitem", { name: "Ollama" });
    await userEvent.selectOptions(await within(ollama).findByRole("combobox", { name: "Modelo de Ollama" }), "llama3.2:latest");
    await userEvent.click(within(ollama).getByRole("button", { name: "Elegir Ollama" }));
    await next();
    await waitFor(() => expect(controls.state.settings.llm).toMatchObject({ minutesProvider: "ollama", chatProvider: "ollama", namingProvider: "ollama" }));
    expect(controls.state.settings.llm.providers.find((p) => p.id === "ollama")?.kind).toMatchObject({ model: "llama3.2:latest", baseUrl: "http://127.0.0.1:11434/v1" });
  });

  it("IA: sin servidor local, enseña cómo instalarlo", async () => {
    const { dialog } = await firstRun();
    await goToStep(4);
    await userEvent.click(within(dialog).getByRole("radio", { name: /Modelo local/ }));
    const ollama = await within(dialog).findByRole("listitem", { name: "Ollama" });
    expect(await within(ollama).findByText("No está en marcha")).toBeInTheDocument();
    expect(within(ollama).getByRole("button", { name: "Cómo instalar Ollama" })).toBeInTheDocument();
  });

  it("IA: NaN Builders sugerido por privacidad, con la clave en el Llavero", async () => {
    const { dialog, api, controls } = await firstRun({ remoteModels: { "https://api.nan.builders/v1": ["deepseek-v4-flash", "gemma4", "qwen3.6"] } });
    const secret = vi.spyOn(api, "secretSet");
    await goToStep(4);
    const nan = within(dialog).getByRole("radio", { name: /NaN Builders/ });
    expect(within(nan).getByText("Recomendado por privacidad")).toBeInTheDocument();
    await userEvent.click(nan);
    expect(within(dialog).getByText(/sin registros de prompts ni respuestas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/requiere el plan con API/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear cuenta" }));
    expect(controls.state.opened).toEqual([NAN_REFERRAL_URL]);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Clave de API de NaN Builders"), "sk-nan");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar en el Llavero NaN Builders" }));
    await waitFor(() => expect(secret).toHaveBeenCalledWith("nan", "sk-nan"));
    expect(await within(dialog).findByRole("combobox", { name: "Modelo de NaN Builders" })).toHaveValue("gemma4");
    await next();
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBe("nan"));
    expect(controls.state.settings.llm.providers.find((p) => p.id === "nan")?.kind).toMatchObject({ baseUrl: "https://api.nan.builders/v1", model: "gemma4", apiKey: { service: "acta", account: "provider:nan" } });
    expect(JSON.stringify(controls.state.settings)).not.toContain("sk-nan");
  });

  it("IA: con mi propia clave (OpenRouter)", async () => {
    const { dialog, controls } = await firstRun({ remoteModels: { "https://openrouter.ai/api/v1": ["meta/llama-4"] } });
    await goToStep(4);
    await userEvent.click(within(dialog).getByRole("radio", { name: /Mi propia clave/ }));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Servicio" }), "openRouter");
    await userEvent.type(within(dialog).getByLabelText("Clave de API de OpenRouter"), "sk-or");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar en el Llavero OpenRouter" }));
    expect(await within(dialog).findByRole("combobox", { name: "Modelo de OpenRouter" })).toHaveValue("meta/llama-4");
    await next();
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBe("openrouter"));
  });

  it("IA: prueba la conexión con lo elegido", async () => {
    const { dialog, api } = await firstRun();
    const test = vi.spyOn(api, "llmProviderTest");
    await goToStep(4);
    await within(await within(dialog).findByRole("radio", { name: /Claude Code/ })).findByText("Detectado en este Mac");
    await userEvent.click(within(dialog).getByRole("button", { name: "Probar conexión" }));
    expect(await within(dialog).findByText(/OK \(mock\)/)).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith("claude-cli");
  });

  it("detección y autoparada: valores sensatos que se pueden cambiar", async () => {
    const { dialog, controls } = await firstRun();
    await goToStep(5);
    expect(within(dialog).getByRole("heading", { name: "Que empiece y pare sola" })).toBeInTheDocument();
    const detect = within(dialog).getByRole("checkbox", { name: "Avisarme cuando empiece una reunión" });
    expect(detect).toBeChecked();
    expect(within(dialog).getByLabelText("Minutos de silencio antes de preguntar")).toHaveValue(3);
    expect(within(dialog).getByLabelText("Minutos sin respuesta antes de parar")).toHaveValue(2);
    await userEvent.click(detect);
    await userEvent.click(within(dialog).getByRole("button", { name: "Aumentar: Minutos de silencio antes de preguntar" }));
    await next();
    await waitFor(() => expect(controls.state.settings.detection.enabled).toBe(false));
    expect(controls.state.settings.autoStop.silencePromptAfterMs).toBe(240_000);
  });

  it("al terminar resume cómo ha quedado y no vuelve a salir", async () => {
    const { dialog, controls } = await firstRun();
    await goToStep(6);
    expect(await within(dialog).findByRole("heading", { name: "Todo listo" })).toBeInTheDocument();
    const summary = within(dialog).getByRole("list", { name: "Resumen" });
    expect(within(summary).getByText(/Actas con Claude Code/)).toBeInTheDocument();
    expect(within(summary).getByText(/Falta el permiso de audio del sistema/)).toBeInTheDocument();
    await next("Empezar a usar acta");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Bienvenida a acta" })).not.toBeInTheDocument());
    expect(controls.state.settings.onboarding).toEqual({ completed: true });
  });

  it("se puede volver atrás", async () => {
    const { dialog } = await firstRun();
    await goToStep(3);
    await userEvent.click(within(dialog).getByRole("button", { name: "Atrás" }));
    expect(within(dialog).getByRole("heading", { name: "Permisos de macOS" })).toBeInTheDocument();
  });

  it("se puede volver a ver desde Ajustes › General", async () => {
    render(<App api={createMockApi().api} />);
    await userEvent.click(within(screen.getByRole("navigation", { name: "Secciones" })).getByRole("button", { name: "Ajustes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Volver a ver la bienvenida" }));
    expect(await screen.findByRole("dialog", { name: "Bienvenida a acta" })).toBeInTheDocument();
  });
});
