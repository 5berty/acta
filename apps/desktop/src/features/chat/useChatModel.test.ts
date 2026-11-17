import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type Settings } from "../../api";
import { chatScopeKey, readChoice, resolveModel, saveChoice } from "./useChatModel";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function settings(): Settings {
  const s = createMockApi().controls.state.settings;
  s.llm.providers.push({ id: "nan", label: "NaN Builders", enabled: true, kind: { type: "openAiCompatible", baseUrl: "https://x/v1", model: "deepseek-v4-pro", apiKey: null }, timeoutS: 600 });
  return s;
}

describe("clave de cada chat", () => {
  it("distingue reunión, grupo, todas y directo", () => {
    expect(chatScopeKey({ kind: "meeting", meetingId: "m1" })).toBe("meeting:m1");
    expect(chatScopeKey({ kind: "group", groupId: "g1" })).toBe("group:g1");
    expect(chatScopeKey({ kind: "all" })).toBe("all");
  });
});

describe("elección guardada", () => {
  it("guarda por chat y como última usada", () => {
    saveChoice("meeting:m1", { providerId: "nan", model: "qwen-max" });
    expect(readChoice("meeting:m1")).toEqual({ providerId: "nan", model: "qwen-max" });
    expect(readChoice("group:g1")).toEqual({ providerId: "nan", model: "qwen-max" });
    saveChoice("group:g1", { providerId: "claude-cli", model: null });
    expect(readChoice("meeting:m1")).toEqual({ providerId: "nan", model: "qwen-max" });
    expect(readChoice("all")).toEqual({ providerId: "claude-cli", model: null });
  });

  it("sin nada guardado no hay elección", () => {
    expect(readChoice("all")).toBeNull();
  });

  it("ignora lo que no entiende", () => {
    localStorage.setItem("acta.chat.llm.all", "{roto");
    localStorage.setItem("acta.chat.llm.last", JSON.stringify({ model: "sin proveedor" }));
    expect(readChoice("all")).toBeNull();
    localStorage.setItem("acta.chat.llm.last", JSON.stringify({ providerId: "nan", model: 7 }));
    expect(readChoice("all")).toEqual({ providerId: "nan", model: null });
  });

  it("si el almacenamiento falla, no revienta", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denegado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("lleno");
    });
    expect(readChoice("all")).toBeNull();
    expect(() => saveChoice("all", { providerId: "nan", model: null })).not.toThrow();
  });
});

describe("qué modelo responde", () => {
  it("sin elección: el proveedor de chat de Ajustes y ningún override", () => {
    expect(resolveModel(settings(), null)).toEqual({ model: { label: "Claude Code (CLI)", providerId: "claude-cli", model: null, missing: false }, llm: null });
  });

  it("el de Ajustes enseña su modelo configurado", () => {
    const s = settings();
    s.llm.chatProvider = "nan";
    expect(resolveModel(s, null).model.label).toBe("NaN Builders · deepseek-v4-pro");
  });

  it("con elección: ese proveedor y modelo, como override", () => {
    expect(resolveModel(settings(), { providerId: "nan", model: "qwen-max" })).toEqual({
      model: { label: "NaN Builders · qwen-max", providerId: "nan", model: "qwen-max", missing: false },
      llm: { providerId: "nan", model: "qwen-max" },
    });
  });

  it("una elección sin modelo no hereda el modelo configurado en el botón", () => {
    expect(resolveModel(settings(), { providerId: "nan", model: null })).toEqual({
      model: { label: "NaN Builders", providerId: "nan", model: null, missing: false },
      llm: { providerId: "nan", model: null },
    });
  });

  it("elección de un proveedor borrado o desactivado: vuelve al de Ajustes", () => {
    const s = settings();
    expect(resolveModel(s, { providerId: "borrado", model: "x" }).llm).toBeNull();
    s.llm.providers[1]!.enabled = false;
    const r = resolveModel(s, { providerId: "nan", model: "qwen-max" });
    expect(r.llm).toBeNull();
    expect(r.model.label).toBe("Claude Code (CLI)");
  });

  it("sin proveedor de chat: falta, nunca un nombre roto", () => {
    const s = settings();
    s.llm.providers = [];
    expect(resolveModel(s, null)).toEqual({ model: { label: "Sin proveedor de IA", providerId: null, model: null, missing: true }, llm: null });
  });

  it("mientras no hay ajustes no inventa nada", () => {
    expect(resolveModel(null, null)).toEqual({ model: { label: null, providerId: null, model: null, missing: false }, llm: null });
    expect(resolveModel(null, { providerId: "nan", model: "qwen-max" }).llm).toEqual({ providerId: "nan", model: "qwen-max" });
  });
});
