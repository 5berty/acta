import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import { ApiProvider } from "../../app/ApiContext";
import { SettingsContainer } from "../settings/SettingsContainer";
import { NAN_REFERRAL_URL } from "./presets";

async function setup(seed: Parameters<typeof createMockApi>[0] = {}) {
  const mock = createMockApi(seed);
  render(
    <ApiProvider api={mock.api}>
      <SettingsContainer />
    </ApiProvider>,
  );
  const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
  await userEvent.click(within(nav).getByRole("button", { name: "Proveedores de IA" }));
  const section = await screen.findByRole("region", { name: "Proveedores de IA" });
  return { ...mock, section };
}
const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
const NAN_MODELS = { "https://api.nan.builders/v1": ["deepseek-v4-flash", "qwen3.6", "gemma4"] };

describe("Proveedores de IA", () => {
  it("cada proveedor enseña su logo", async () => {
    const { section } = await setup();
    const card = within(section).getByRole("group", { name: "Claude Code (CLI)" });
    expect(card.querySelector("[data-brand='claude']")).toBeInTheDocument();
  });

  it("añade un proveedor con un toque desde la galería, ya relleno", async () => {
    const { section, controls } = await setup();
    await userEvent.click(within(section).getByRole("button", { name: "Añadir OpenRouter" }));
    const card = await within(section).findByRole("group", { name: "OpenRouter" });
    expect(card.querySelector("[data-brand='openrouter']")).toBeInTheDocument();
    expect(within(card).getByLabelText("Clave de API de OpenRouter")).toBeInTheDocument();
    await save();
    await waitFor(() => expect(controls.state.settings.llm.providers[1]).toMatchObject({ id: "openrouter", kind: { baseUrl: "https://openrouter.ai/api/v1" } }));
  });

  it("no ofrece dos veces lo que solo puede haber una vez", async () => {
    const { section } = await setup();
    expect(within(section).queryByRole("button", { name: "Añadir Claude Code" })).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Añadir Codex" })).toBeInTheDocument();
  });

  describe("NaN Builders", () => {
    it("lo sugiere por privacidad, con lo que promete y lo que cuesta", async () => {
      const { section } = await setup();
      const promo = within(section).getByRole("group", { name: "NaN Builders" });
      expect(within(promo).getByText("Recomendado por privacidad")).toBeInTheDocument();
      expect(within(promo).getByText(/sin registros de prompts ni respuestas, no entrena con tus datos y procesa en la UE \(según NaN Builders\)/)).toBeInTheDocument();
      expect(within(promo).getByText(/requiere el plan con API/)).toBeInTheDocument();
      expect(promo.querySelector("[data-brand='nan']")).toBeInTheDocument();
    });

    it("«Crear cuenta» abre el enlace de invitación en el navegador", async () => {
      const { section, controls } = await setup();
      await userEvent.click(within(section).getByRole("button", { name: "Crear cuenta" }));
      expect(controls.state.opened).toEqual([NAN_REFERRAL_URL]);
      expect(NAN_REFERRAL_URL).toBe("https://cloud.nan.builders/r/YZ524NPK");
    });

    it("con la clave en el Llavero carga sus modelos y propone uno que no gasta cuota", async () => {
      const { section, api, controls } = await setup({ remoteModels: NAN_MODELS });
      const secret = vi.spyOn(api, "secretSet");
      const list = vi.spyOn(api, "llmListModels");
      await userEvent.click(within(section).getByRole("button", { name: "Usar NaN Builders" }));
      const card = await within(section).findByRole("group", { name: "NaN Builders" });
      await userEvent.type(within(card).getByLabelText("Clave de API de NaN Builders"), "sk-nan");
      await userEvent.click(within(card).getByRole("button", { name: "Guardar en el Llavero NaN Builders" }));
      await waitFor(() => expect(secret).toHaveBeenCalledWith("nan", "sk-nan"));
      const model = await within(card).findByRole("combobox", { name: "Modelo de NaN Builders" });
      expect(list).toHaveBeenCalledWith("https://api.nan.builders/v1", "nan");
      expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["deepseek-v4-flash", "qwen3.6", "gemma4"]);
      expect(model).toHaveValue("gemma4");
      await userEvent.selectOptions(model, "qwen3.6");
      await save();
      await waitFor(() =>
        expect(controls.state.settings.llm.providers[1]).toMatchObject({
          id: "nan",
          enabled: true,
          kind: { type: "openAiCompatible", baseUrl: "https://api.nan.builders/v1", model: "qwen3.6", apiKey: { service: "acta", account: "provider:nan" } },
        }),
      );
      expect(JSON.stringify(controls.state.settings)).not.toContain("sk-nan");
    });

    it("si no puede listar los modelos lo dice y deja escribir el nombre", async () => {
      const { section } = await setup();
      await userEvent.click(within(section).getByRole("button", { name: "Usar NaN Builders" }));
      const card = await within(section).findByRole("group", { name: "NaN Builders" });
      await userEvent.click(within(card).getByRole("button", { name: "Ver modelos de NaN Builders" }));
      expect(await within(card).findByRole("alert")).toHaveTextContent(/no se pudo conectar/);
      expect(within(card).getByRole("textbox", { name: "Modelo de NaN Builders" })).toHaveValue("gemma4");
    });
  });

  describe("modelos en tu Mac", () => {
    it("si no hay ninguno en marcha explica cómo instalarlo", async () => {
      const { section, controls } = await setup();
      const ollama = await within(section).findByRole("listitem", { name: "Ollama" });
      expect(await within(ollama).findByText("No está en marcha")).toBeInTheDocument();
      expect(within(ollama).queryByRole("combobox")).not.toBeInTheDocument();
      await userEvent.click(within(ollama).getByRole("button", { name: "Cómo instalar Ollama" }));
      expect(within(ollama).getByText(/ollama pull/)).toBeInTheDocument();
      await userEvent.click(within(ollama).getByRole("button", { name: "Abrir ollama.com" }));
      expect(controls.state.opened).toEqual(["https://ollama.com/download"]);
      const lms = within(section).getByRole("listitem", { name: "LM Studio" });
      await userEvent.click(within(lms).getByRole("button", { name: "Cómo instalar LM Studio" }));
      expect(within(lms).getByText(/servidor local/)).toBeInTheDocument();
    });

    it("detecta Ollama, lista sus modelos y lo deja como proveedor con un toque", async () => {
      const { section, controls } = await setup({
        local: {
          ollama: { running: true, baseUrl: "http://127.0.0.1:11434/v1", models: ["gemma3:12b", "llama3.2:latest"] },
          lmStudio: { running: false, baseUrl: "http://127.0.0.1:1234/v1", models: [] },
        },
      });
      const ollama = await within(section).findByRole("listitem", { name: "Ollama" });
      expect(await within(ollama).findByText("En marcha · 2 modelos")).toBeInTheDocument();
      await userEvent.selectOptions(within(ollama).getByRole("combobox", { name: "Modelo de Ollama" }), "llama3.2:latest");
      await userEvent.click(within(ollama).getByRole("button", { name: "Usar Ollama" }));
      expect(await within(section).findByRole("group", { name: "Ollama" })).toBeInTheDocument();
      await save();
      await waitFor(() =>
        expect(controls.state.settings.llm.providers[1]).toMatchObject({ id: "ollama", enabled: true, kind: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2:latest", apiKey: null } }),
      );
    });

    it("un servidor en marcha sin modelos pide descargar uno", async () => {
      const { section } = await setup({
        local: {
          ollama: { running: false, baseUrl: "http://127.0.0.1:11434/v1", models: [] },
          lmStudio: { running: true, baseUrl: "http://127.0.0.1:1234/v1", models: [] },
        },
      });
      const lms = await within(section).findByRole("listitem", { name: "LM Studio" });
      expect(await within(lms).findByText("En marcha, sin modelos")).toBeInTheDocument();
      expect(within(lms).queryByRole("button", { name: "Usar LM Studio" })).not.toBeInTheDocument();
    });

    it("«Volver a buscar» repite la detección", async () => {
      const { section, api, controls } = await setup();
      const detect = vi.spyOn(api, "llmDetectLocal");
      const lms = await within(section).findByRole("listitem", { name: "LM Studio" });
      await within(lms).findByText("No está en marcha");
      controls.state.local.lmStudio = { running: true, baseUrl: "http://127.0.0.1:1234/v1", models: ["google/gemma-3-12b"] };
      await userEvent.click(within(section).getByRole("button", { name: "Volver a buscar" }));
      expect(detect).toHaveBeenCalledTimes(1);
      expect(await within(lms).findByText("En marcha · 1 modelo")).toBeInTheDocument();
    });
  });

  it("un servidor compatible cualquiera: URL, clave y modelos a la carta", async () => {
    const { section, controls } = await setup({ remoteModels: { "https://llm.example.com/v1": ["mi-modelo"] } });
    await userEvent.click(within(section).getByRole("button", { name: "Añadir Otro servidor compatible" }));
    const card = await within(section).findByRole("group", { name: "OpenAI compatible" });
    await userEvent.type(within(card).getByLabelText("URL base de OpenAI compatible"), "https://llm.example.com/v1");
    await userEvent.click(within(card).getByRole("button", { name: "Ver modelos de OpenAI compatible" }));
    expect(await within(card).findByRole("combobox", { name: "Modelo de OpenAI compatible" })).toHaveValue("mi-modelo");
    await save();
    await waitFor(() => expect(controls.state.settings.llm.providers[1]).toMatchObject({ id: "custom", kind: { baseUrl: "https://llm.example.com/v1", model: "mi-modelo" } }));
  });

  describe("fallos a la vista", () => {
    const failing = async (prepare: (api: ReturnType<typeof createMockApi>["api"]) => void) => {
      const mock = createMockApi();
      prepare(mock.api);
      render(
        <ApiProvider api={mock.api}>
          <SettingsContainer />
        </ApiProvider>,
      );
      const nav = await screen.findByRole("navigation", { name: "Secciones de ajustes" });
      await userEvent.click(within(nav).getByRole("button", { name: "Proveedores de IA" }));
      return { ...mock, section: await screen.findByRole("region", { name: "Proveedores de IA" }) };
    };

    it("si no se puede buscar Ollama ni LM Studio, lo dice en vez de darlos por apagados", async () => {
      const { section, api } = await failing((api) => {
        vi.spyOn(api, "llmDetectLocal").mockRejectedValueOnce({ code: "io", message: "sin red local" });
      });
      expect(await within(section).findByText(/No se ha podido buscar Ollama ni LM Studio en este Mac: sin red local/)).toBeInTheDocument();
      const again = vi.spyOn(api, "llmDetectLocal");
      await userEvent.click(within(section).getByRole("button", { name: "Volver a buscar" }));
      await waitFor(() => expect(again).toHaveBeenCalled());
      await waitFor(() => expect(within(section).queryByText(/No se ha podido buscar Ollama/)).not.toBeInTheDocument());
    });

    it("si no se puede mirar qué ejecuta este Mac, el modelo integrado enseña el error y deja reintentar", async () => {
      const { section } = await failing((api) => {
        vi.spyOn(api, "localLlmStatus").mockRejectedValueOnce({ code: "io", message: "sin motor" });
      });
      expect(await within(section).findByText(/No se ha podido mirar qué puede ejecutar tu Mac: sin motor/)).toBeInTheDocument();
      await userEvent.click(within(section).getAllByRole("button", { name: "Reintentar" })[0]!);
      expect(await within(section).findByRole("group", { name: "Modelo local integrado" })).toBeInTheDocument();
    });

    it("si el navegador no se abre al crear la cuenta, lo dice", async () => {
      const { section } = await failing((api) => {
        vi.spyOn(api, "openExternalUrl").mockRejectedValue({ code: "io", message: "sin navegador" });
      });
      await userEvent.click(within(section).getByRole("button", { name: "Crear cuenta" }));
      expect(await within(section).findByText(/No se ha podido abrir .* en el navegador: sin navegador/)).toBeInTheDocument();
    });
  });
});
