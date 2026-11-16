import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import type { LocalLlmDownload, LocalLlmStatus } from "../../api";
import { defaultSettings, mockLocalLlmStatus } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { App } from "../../app/App";
import { SettingsContainer } from "../settings/SettingsContainer";
import { applyAi, aiProblem, initialAi } from "../onboarding/aiChoice";
import { BUILTIN_PROVIDER_ID, presetOf, upsertPreset } from "./presets";

const TINY = "qwen3.5-2b-q4_k_m";
const LARGE = "qwen3.5-9b-q4_k_m";
const GIB = 1024 ** 3;

type Seed = Parameters<typeof createMockApi>[0];

async function settings(seed: Seed = {}) {
  const mock = createMockApi(seed);
  render(
    <ApiProvider api={mock.api}>
      <SettingsContainer />
    </ApiProvider>,
  );
  const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
  await userEvent.click(within(nav).getByRole("button", { name: "Proveedores de IA" }));
  const group = await screen.findByRole("group", { name: "Modelo local integrado" });
  return { ...mock, group };
}
const row = (group: HTMLElement, name: string) => within(group).getByRole("listitem", { name });
const progressEvent = (over: Partial<LocalLlmDownload>): LocalLlmDownload => ({ modelId: TINY, stage: "model", receivedBytes: 0, totalBytes: 1_280_835_840, fraction: 0, done: false, error: null, ...over });
function status(patch: (s: LocalLlmStatus) => void): LocalLlmStatus {
  const s = mockLocalLlmStatus();
  patch(s);
  return s;
}

afterEach(() => vi.restoreAllMocks());

describe("Modelo local integrado en Ajustes › Proveedores de IA", () => {
  it("se ofrece como opcional, con los tres niveles y lo que cuesta cada uno", async () => {
    const { group } = await settings();
    expect(screen.getByText("Modelo local integrado (opcional)")).toBeInTheDocument();
    expect(within(group).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Qwen3.5 2B", "Qwen3.5 4B", "Qwen3.5 9B"]);
    const large = row(group, "Qwen3.5 9B");
    for (const fact of ["5,7 GB", "≈ 9,1 GB", "≈ 19 tokens/s", "Apache-2.0"]) expect(within(large).getByText(fact)).toBeInTheDocument();
    expect(within(group).getByText(/sin Ollama, sin cuenta y sin conexión/)).toBeInTheDocument();
  });

  it("dice qué Mac tienes y recomienda un nivel para él", async () => {
    const { group } = await settings();
    expect(within(group).getByText("Apple M2 Pro")).toBeInTheDocument();
    expect(within(group).getByText(/32 GB/)).toBeInTheDocument();
    expect(within(row(group, "Qwen3.5 9B")).getByText("Recomendado para tu Mac")).toBeInTheDocument();
    expect(within(group).getAllByText("Recomendado para tu Mac")).toHaveLength(1);
    // El recomendado es el botón principal.
    expect(within(group).getByRole("button", { name: "Descargar Qwen3.5 9B" })).toHaveClass("btn-primary");
    expect(within(group).getByRole("button", { name: "Descargar Qwen3.5 2B" })).not.toHaveClass("btn-primary");
  });

  it("con poca memoria solo deja descargar el pequeño y explica por qué", async () => {
    const localLlm = status((s) => {
      s.hardware = { ...s.hardware, chip: "Apple M1", ramBytes: 6 * GIB };
      s.models[0]!.fit = "tight";
      s.models[0]!.recommended = true;
      s.models[1]!.fit = "tooBig";
      s.models[2]!.fit = "tooBig";
      s.models[2]!.recommended = false;
      s.recommended = TINY;
    });
    const { group } = await settings({ localLlm });
    expect(within(group).getByRole("button", { name: "Descargar Qwen3.5 2B" })).toBeEnabled();
    expect(within(row(group, "Qwen3.5 2B")).getByText(/dejará poca memoria/)).toBeInTheDocument();
    for (const name of ["Qwen3.5 4B", "Qwen3.5 9B"]) {
      expect(within(group).getByRole("button", { name: `Descargar ${name}` })).toBeDisabled();
      expect(row(group, name)).toHaveAttribute("aria-disabled", "true");
    }
    expect(within(row(group, "Qwen3.5 9B")).getByText("Necesita 16 GB de memoria y tu Mac tiene 6.")).toBeInTheDocument();
  });

  it("sin espacio en disco no deja descargar", async () => {
    const localLlm = status((s) => {
      s.models[2]!.fit = "noDisk";
    });
    const { group } = await settings({ localLlm });
    expect(within(group).getByRole("button", { name: "Descargar Qwen3.5 9B" })).toBeDisabled();
    expect(within(row(group, "Qwen3.5 9B")).getByText(/No cabe en el disco: ocupa 5,7 GB/)).toBeInTheDocument();
  });

  it("enseña el progreso de la descarga por fases y se puede pausar", async () => {
    const { group, api, controls } = await settings();
    const download = vi.spyOn(api, "localLlmDownload").mockResolvedValue();
    const cancel = vi.spyOn(api, "localLlmCancel").mockResolvedValue();
    await userEvent.click(within(group).getByRole("button", { name: "Descargar Qwen3.5 2B" }));
    expect(download).toHaveBeenCalledWith(TINY);
    const tiny = row(group, "Qwen3.5 2B");
    expect(within(tiny).getByRole("progressbar", { name: "Descargando Qwen3.5 2B" })).toBeInTheDocument();

    act(() => controls.emit("localmodel:download", progressEvent({ stage: "runtime", fraction: 0.5 })));
    expect(within(tiny).getByText("Preparando el motor (llama.cpp)…")).toBeInTheDocument();
    act(() => controls.emit("localmodel:download", progressEvent({ receivedBytes: 640_417_920, fraction: 0.5 })));
    expect(within(tiny).getByText("50 % · 0,6 GB de 1,3 GB")).toBeInTheDocument();
    expect(within(tiny).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    act(() => controls.emit("localmodel:download", progressEvent({ stage: "verifying", fraction: 1 })));
    expect(within(tiny).getByText("Comprobando la descarga…")).toBeInTheDocument();

    await userEvent.click(within(tiny).getByRole("button", { name: "Pausar la descarga de Qwen3.5 2B" }));
    expect(cancel).toHaveBeenCalledWith(TINY);
  });

  it("una descarga a medias se puede reanudar donde se quedó", async () => {
    const localLlm = status((s) => {
      s.models[0]!.partialBytes = 640_417_920;
    });
    const { group, api } = await settings({ localLlm });
    const tiny = row(group, "Qwen3.5 2B");
    expect(within(tiny).getByText("En pausa · 0,6 GB de 1,3 GB descargados")).toBeInTheDocument();
    const download = vi.spyOn(api, "localLlmDownload");
    await userEvent.click(within(tiny).getByRole("button", { name: "Reanudar la descarga de Qwen3.5 2B" }));
    expect(download).toHaveBeenCalledWith(TINY);
  });

  it("si la descarga falla, lo dice y deja reintentar", async () => {
    const { group, controls } = await settings();
    act(() => controls.emit("localmodel:download", progressEvent({ stage: "done", done: true, error: "la descarga está dañada (el SHA-256 no coincide)" })));
    const tiny = row(group, "Qwen3.5 2B");
    expect(await within(tiny).findByText(/SHA-256 no coincide/)).toBeInTheDocument();
    expect(within(tiny).getByRole("button", { name: "Descargar Qwen3.5 2B" })).toBeEnabled();
  });

  it("descargado: «Usar» lo pone a escribir las actas, el chat y los nombres", async () => {
    const { group, controls } = await settings();
    await userEvent.click(within(group).getByRole("button", { name: "Descargar Qwen3.5 2B" }));
    await userEvent.click(await within(group).findByRole("button", { name: "Usar Qwen3.5 2B" }));
    expect(within(row(group, "Qwen3.5 2B")).getAllByText("En uso").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBe(BUILTIN_PROVIDER_ID));
    const llm = controls.state.settings.llm;
    expect(llm.providers.find((p) => p.id === BUILTIN_PROVIDER_ID)).toMatchObject({ label: "Modelo local integrado", enabled: true, kind: { type: "builtIn", modelId: TINY } });
    expect([llm.chatProvider, llm.namingProvider]).toEqual([BUILTIN_PROVIDER_ID, BUILTIN_PROVIDER_ID]);
    // Cambiar de nivel reutiliza el mismo proveedor.
    expect(llm.providers.filter((p) => p.kind.type === "builtIn")).toHaveLength(1);
  });

  it("«Probar» carga el modelo y dice si responde", async () => {
    const localLlm = status((s) => {
      s.models[0]!.downloaded = true;
    });
    const { group } = await settings({ localLlm });
    await userEvent.click(within(group).getByRole("button", { name: "Probar Qwen3.5 2B" }));
    expect(await within(row(group, "Qwen3.5 2B")).findByText("Funciona · respondió en 1,2 s")).toBeInTheDocument();
  });

  it("borrar pide confirmación y libera el disco", async () => {
    const localLlm = status((s) => {
      s.models[0]!.downloaded = true;
    });
    const { group, controls } = await settings({ localLlm });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(within(group).getByRole("button", { name: "Borrar Qwen3.5 2B" }));
    expect(confirm.mock.calls[0]![0]).toMatch(/Se liberan 1,3 GB/);
    expect(controls.state.localLlm.models[0]!.downloaded).toBe(true);
    await userEvent.click(within(group).getByRole("button", { name: "Borrar Qwen3.5 2B" }));
    expect(await within(group).findByRole("button", { name: "Descargar Qwen3.5 2B" })).toBeInTheDocument();
    expect(controls.state.localLlm.models[0]!.downloaded).toBe(false);
  });
});

describe("Modelo integrado en la bienvenida", () => {
  async function aiStep(seed: Seed = {}) {
    const base = defaultSettings();
    const mock = createMockApi({ settings: { ...base, onboarding: { completed: false }, llm: { ...base.llm, providers: [], minutesProvider: null, chatProvider: null, namingProvider: null } }, ...seed });
    render(<App api={mock.api} />);
    const dialog = await screen.findByRole("dialog", { name: "Bienvenida a acta" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Empezar" }));
    for (let i = 0; i < 2; i += 1) await userEvent.click(within(dialog).getByRole("button", { name: "Continuar" }));
    return { ...mock, dialog };
  }

  it("lo ofrece como la opción que no necesita instalar nada", async () => {
    const { dialog } = await aiStep();
    const option = within(dialog).getByRole("radio", { name: /Modelo integrado/ });
    expect(within(option).getByText("Sin instalar nada")).toBeInTheDocument();
    expect(within(option).getByText("acta descarga un modelo y lo ejecuta en tu Mac.")).toBeInTheDocument();
    // Sigue siendo opcional: sin elegir nada se puede continuar.
    expect(within(dialog).getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("descargar y elegir un nivel deja las actas en el modelo integrado", async () => {
    const { dialog, controls } = await aiStep();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Modelo integrado/ }));
    const group = await within(dialog).findByRole("group", { name: "Modelo local integrado" });
    expect(within(group).getByText("Recomendado para tu Mac")).toBeInTheDocument();
    // En la bienvenida el recomendado es el primero de la lista.
    expect(within(group).getAllByRole("listitem")[0]).toHaveAttribute("aria-label", "Qwen3.5 9B");
    expect(within(dialog).getByText("Descarga un modelo y pulsa «Elegir» para continuar.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continuar" })).toBeDisabled();

    await userEvent.click(within(group).getByRole("button", { name: "Descargar Qwen3.5 9B" }));
    await userEvent.click(await within(group).findByRole("button", { name: "Elegir Qwen3.5 9B" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(controls.state.settings.llm.minutesProvider).toBe(BUILTIN_PROVIDER_ID));
    expect(controls.state.settings.llm.providers[0]).toMatchObject({ id: BUILTIN_PROVIDER_ID, kind: { type: "builtIn", modelId: LARGE } });
  });
});

describe("ajustes que salen de elegir el modelo integrado", () => {
  const llm = defaultSettings().llm;

  it("crea un único proveedor «builtin» y lo actualiza al cambiar de nivel", () => {
    const first = upsertPreset(llm, "builtIn", { model: TINY });
    expect(first.provider).toMatchObject({ id: "builtin", label: "Modelo local integrado", kind: { type: "builtIn", modelId: TINY } });
    expect(presetOf(first.provider)).toBe("builtIn");
    const second = upsertPreset(first.llm, "builtIn", { model: LARGE });
    expect(second.llm.providers.filter((p) => p.kind.type === "builtIn")).toHaveLength(1);
    expect(second.provider.kind).toEqual({ type: "builtIn", modelId: LARGE });
  });

  it("la bienvenida recuerda el modelo integrado que ya escribe las actas", () => {
    const withBuiltIn = applyAi(llm, { ...initialAi(llm), choice: "builtIn", builtIn: { modelId: TINY } }, null);
    expect(withBuiltIn.minutesProvider).toBe("builtin");
    const again = initialAi(withBuiltIn);
    expect(again).toMatchObject({ choice: "builtIn", builtIn: { modelId: TINY } });
    expect(aiProblem(again, null, false)).toBeNull();
    expect(aiProblem({ ...again, builtIn: null }, null, false)).toMatch(/Descarga un modelo/);
  });
});
