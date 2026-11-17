import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type ChatMessage, type ChatScope, type Citation } from "../../api";
import { ApiProvider } from "../../app/ApiContext";
import { ChatContainer } from "./ChatContainer";
import { ChatView } from "./ChatView";

beforeEach(() => localStorage.clear());

const citation: Citation = { n: 1, meetingId: "m1", meetingTitle: "Daily", at: 10_000, end: 15_000, snippet: "dijo algo" };
const assistant = (content: string, citations: Citation[] = []): ChatMessage => ({
  id: "a1",
  threadId: "t1",
  role: "assistant",
  content,
  citations,
  provider: "claude-cli",
  createdAt: 0,
});

describe("ChatView", () => {
  it("convierte [n] en citas clicables y lista las citas", async () => {
    const onCitation = vi.fn();
    render(<ChatView messages={[assistant("Lo acordaron [1].", [citation])]} streams={{}} busy={false} onSend={() => {}} onCitation={onCitation} />);
    await userEvent.click(screen.getByRole("button", { name: "Cita 1: Daily, 00:10" }));
    expect(onCitation).toHaveBeenCalledWith(citation);
    expect(screen.getByRole("button", { name: "Daily, 00:10" })).toBeInTheDocument();
  });

  it("envía con el botón y vacía el campo", async () => {
    const onSend = vi.fn();
    render(<ChatView messages={[]} streams={{}} busy={false} onSend={onSend} onCitation={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), "¿Qué se decidió?");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onSend).toHaveBeenCalledWith("¿Qué se decidió?");
    expect(screen.getByRole("textbox", { name: "Pregunta" })).toHaveValue("");
  });

  it("no envía texto vacío", () => {
    render(<ChatView messages={[]} streams={{}} busy={false} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });
});

describe("ChatContainer", () => {
  const scope: ChatScope = { kind: "meeting", meetingId: "m1" };

  it("crea el hilo al enviar y muestra la respuesta", async () => {
    const { api, controls } = createMockApi();
    render(
      <ApiProvider api={api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "Hola");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Respuesta simulada.")).toBeInTheDocument();
    expect(screen.getByText("Hola")).toBeInTheDocument();
    expect(controls.state.threads).toHaveLength(1);
  });

  it("recupera el historial del hilo existente", async () => {
    const { api, controls } = createMockApi();
    const t = await api.chatThreadCreate(scope);
    controls.state.messages.push({ ...assistant("Respuesta previa"), threadId: t.id });
    render(
      <ApiProvider api={api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByText("Respuesta previa")).toBeInTheDocument();
  });

  it("pinta el streaming parcial", async () => {
    const { api, controls } = createMockApi();
    const t = await api.chatThreadCreate(scope);
    render(
      <ApiProvider api={api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );
    await screen.findByRole("textbox", { name: "Pregunta" });
    await waitFor(() => expect(controls.state.threads).toHaveLength(1));
    act(() => controls.emit("chat:delta", { threadId: t.id, messageId: "s1", delta: "Pensando", done: false, citations: [], error: null }));
    expect(await screen.findByText("Pensando")).toBeInTheDocument();
  });
});

describe("chat vacío", () => {
  it("propone preguntas de ejemplo y las envía de un toque", async () => {
    const onSend = vi.fn();
    render(<ChatView messages={[]} streams={{}} busy={false} placeholder="este grupo" suggestions={["¿Qué se decidió?", "¿Qué sigue pendiente?"]} onSend={onSend} onCitation={() => {}} />);
    expect(screen.getByText("Pregunta lo que quieras sobre este grupo.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "¿Qué sigue pendiente?" }));
    expect(onSend).toHaveBeenCalledWith("¿Qué sigue pendiente?");
  });

  it("las sugerencias desaparecen cuando ya hay conversación", () => {
    render(<ChatView messages={[assistant("Hola")]} streams={{}} busy={false} suggestions={["¿Qué se decidió?"]} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.queryByRole("button", { name: "¿Qué se decidió?" })).not.toBeInTheDocument();
  });

  it("mientras llega la respuesta enseña que está pensando", () => {
    const user: ChatMessage = { ...assistant("¿Y bien?"), id: "u1", role: "user" };
    render(<ChatView messages={[user]} streams={{}} busy onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByRole("status", { name: "Pensando" })).toHaveTextContent("Pensando…");
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detener" })).toBeInTheDocument();
  });

  it("Intro envía y Mayús+Intro no", async () => {
    const onSend = vi.fn();
    render(<ChatView messages={[]} streams={{}} busy={false} onSend={onSend} onCitation={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Pregunta" });
    await userEvent.type(box, "uno{Shift>}{Enter}{/Shift}dos");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("chat pulido", () => {
  const user: ChatMessage = { ...assistant("¿Qué se decidió?"), id: "u1", role: "user" };

  it("el asistente responde en markdown (listas, negrita, código)", () => {
    const { container } = render(<ChatView messages={[assistant("Decidieron:\n\n1. **Lanzar** el lunes\n2. Usar `sqlite`")]} streams={{}} busy={false} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByText("Lanzar").tagName).toBe("STRONG");
    expect(screen.getByText("sqlite").tagName).toBe("CODE");
    expect(container.querySelector(".msg-assistant ol")).not.toBeNull();
  });

  it("lo que escribe la persona no se interpreta como markdown", () => {
    render(<ChatView messages={[{ ...user, content: "**hola**" }]} streams={{}} busy={false} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByText("**hola**")).toBeInTheDocument();
  });

  it("Detener llama a onStop", async () => {
    const onStop = vi.fn();
    render(<ChatView messages={[user]} streams={{}} busy onSend={() => {}} onStop={onStop} onCitation={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("copia la respuesta", async () => {
    const u = userEvent.setup();
    render(<ChatView messages={[user, assistant("Lanzar el **lunes** [1].", [citation])]} streams={{}} busy={false} onSend={() => {}} onCitation={() => {}} />);
    await u.click(screen.getByRole("button", { name: "Copiar respuesta" }));
    expect(await navigator.clipboard.readText()).toBe("Lanzar el **lunes** [1].");
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("Reintentar solo sale en la última respuesta", async () => {
    const onRetry = vi.fn();
    render(<ChatView messages={[user, assistant("Una"), { ...user, id: "u2" }, { ...assistant("Dos"), id: "a2" }]} streams={{}} busy={false} onSend={() => {}} onRetry={onRetry} onCitation={() => {}} />);
    const retry = screen.getAllByRole("button", { name: "Reintentar" });
    expect(retry).toHaveLength(1);
    await userEvent.click(retry[0]!);
    expect(onRetry).toHaveBeenCalled();
  });

  it("un error ofrece reintentar", async () => {
    const onRetry = vi.fn();
    render(<ChatView messages={[user]} streams={{}} busy={false} error="La IA ha tardado demasiado" onSend={() => {}} onRetry={onRetry} onCitation={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("La IA ha tardado demasiado");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("⌘↩ también envía", async () => {
    const onSend = vi.fn();
    render(<ChatView messages={[]} streams={{}} busy={false} onSend={onSend} onCitation={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), "hola{Meta>}{Enter}{/Meta}");
    expect(onSend).toHaveBeenCalledWith("hola");
  });

  it("dice qué proveedor y modelo responde", () => {
    render(<ChatView messages={[assistant("Hola")]} streams={{}} busy={false} model={{ label: "Claude Code · sonnet", providerId: "claude-cli", model: "sonnet", missing: false }} onPickModel={() => {}} loadProviders={async () => []} providerNames={{ "claude-cli": "Claude Code" }} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByText("Claude Code · sonnet")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("una respuesta detenida lo dice", () => {
    render(<ChatView messages={[user, assistant("A medias")]} streams={{}} busy={false} stopped={{ a1: "A med" }} onSend={() => {}} onCitation={() => {}} />);
    expect(screen.getByText("A med")).toBeInTheDocument();
    expect(screen.getByText("Respuesta detenida")).toBeInTheDocument();
  });
});

describe("auto-scroll", () => {
  const user: ChatMessage = { ...assistant("¿Y bien?"), id: "u1", role: "user" };
  const view = (streams: Record<string, string>) => (
    <div data-testid="scroller" style={{ overflowY: "auto", height: 200 }}>
      <ChatView messages={[user]} streams={streams} busy onSend={() => {}} onCitation={() => {}} />
    </div>
  );
  const setup = () => {
    const r = render(view({}));
    const el = screen.getByTestId("scroller");
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 200 });
    return { ...r, el };
  };

  it("sigue el final mientras llegan tokens", () => {
    const { rerender, el } = setup();
    el.scrollTop = 800;
    act(() => void el.dispatchEvent(new Event("scroll")));
    rerender(view({ s1: "Hola" }));
    expect(el.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "Ir al final" })).not.toBeInTheDocument();
  });

  it("si la persona sube, no la arrastra y ofrece volver al final", async () => {
    const { rerender, el } = setup();
    el.scrollTop = 300;
    act(() => void el.dispatchEvent(new Event("scroll")));
    rerender(view({ s1: "Hola" }));
    rerender(view({ s1: "Hola, más" }));
    expect(el.scrollTop).toBe(300);
    await userEvent.click(screen.getByRole("button", { name: "Ir al final" }));
    expect(el.scrollTop).toBe(1000);
  });
});

describe("ChatContainer pulido", () => {
  const scope: ChatScope = { kind: "meeting", meetingId: "m1" };
  const mount = (api: ReturnType<typeof createMockApi>["api"]) =>
    render(
      <ApiProvider api={api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );

  it("enseña el proveedor de chat configurado", async () => {
    const { api } = createMockApi();
    mount(api);
    expect(await screen.findByText("Claude Code (CLI)")).toBeInTheDocument();
  });

  it("Detener congela la respuesta y deja de escuchar ese mensaje", async () => {
    const { api, controls } = createMockApi();
    const t = await api.chatThreadCreate(scope);
    api.chatSend = async (threadId, text) => ({
      userMessage: { id: "u9", threadId, role: "user", content: text, citations: [], provider: null, createdAt: 0 },
      assistantMessageId: "a9",
    });
    mount(api);
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "Hola{Enter}");
    await screen.findByRole("status", { name: "Pensando" });
    act(() => controls.emit("chat:delta", { threadId: t.id, messageId: "a9", delta: "Primera parte", done: false, citations: [], error: null }));
    await userEvent.click(await screen.findByRole("button", { name: "Detener" }));
    act(() => controls.emit("chat:delta", { threadId: t.id, messageId: "a9", delta: " y el resto", done: false, citations: [], error: null }));
    expect(screen.getByText("Primera parte")).toBeInTheDocument();
    expect(screen.queryByText(/y el resto/)).not.toBeInTheDocument();
    expect(screen.getByText("Respuesta detenida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("Reintentar vuelve a enviar la última pregunta", async () => {
    const { api } = createMockApi();
    const send = vi.spyOn(api, "chatSend");
    mount(api);
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "¿Qué se decidió?{Enter}");
    await screen.findByText("Respuesta simulada.");
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toBe("¿Qué se decidió?");
  });
});

describe("selector de modelo", () => {
  type Mock = ReturnType<typeof createMockApi>;
  const NAN = "https://api.nan.builders/v1";
  const m1: ChatScope = { kind: "meeting", meetingId: "m1" };
  const m2: ChatScope = { kind: "meeting", meetingId: "m2" };

  /** Claude Code (por defecto del chat, sin modelo fijado) y un servidor compatible con dos modelos. */
  function twoProviders(models = ["deepseek-v4-pro", "qwen-max"]): Mock {
    const mock = createMockApi();
    mock.controls.state.settings.llm.providers.push({ id: "nan", label: "NaN Builders", enabled: true, kind: { type: "openAiCompatible", baseUrl: NAN, model: "deepseek-v4-pro", apiKey: null }, timeoutS: 600 });
    mock.controls.state.remoteModels[NAN] = models;
    return mock;
  }
  const mount = (mock: Mock, scope: ChatScope = m1) =>
    render(
      <ApiProvider api={mock.api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );
  const trigger = () => screen.findByRole("button", { name: /^Modelo de IA/ });
  const openPicker = async () => userEvent.click(await trigger());
  const pick = async (name: string) => {
    await openPicker();
    await userEvent.click(await screen.findByRole("option", { name }));
  };
  const say = async (text: string) => {
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), `${text}{Enter}`);
    await screen.findByText("Respuesta simulada.");
  };

  it("el indicador es un botón que lista los proveedores activados y sus modelos", async () => {
    mount(twoProviders());
    const t = await trigger();
    await waitFor(() => expect(t).toHaveTextContent("Claude Code (CLI)"));
    expect(t).toHaveAttribute("aria-haspopup", "listbox");
    expect(t).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(t);
    expect(t).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Claude Code (CLI) · sonnet", "Claude Code (CLI) · opus", "Claude Code (CLI) · haiku", "NaN Builders · deepseek-v4-pro", "NaN Builders · qwen-max"]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("group", { name: "Claude Code (CLI)" })).getByText("por defecto")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "NaN Builders" })).queryByText("por defecto")).not.toBeInTheDocument();
  });

  it("un proveedor sin lista de modelos ofrece «Su modelo por defecto»", async () => {
    const mock = createMockApi();
    mock.controls.state.settings.llm.providers.push({ id: "codex", label: "Codex", enabled: true, kind: { type: "codexCli", binaryPath: "/usr/bin/codex", model: null, extraEnv: {} }, timeoutS: 600 });
    mount(mock);
    await pick("Codex · Su modelo por defecto");
    await waitFor(async () => expect(await trigger()).toHaveTextContent("Codex"));
    await say("Hola");
    expect(mock.controls.state.chatLlm).toEqual([{ providerId: "codex", model: null }]);
  });

  it("sin elegir nada, envía con el proveedor de Ajustes (sin override)", async () => {
    const mock = twoProviders();
    mount(mock);
    await say("Hola");
    expect(mock.controls.state.chatLlm).toEqual([null]);
  });

  it("el modelo elegido se ve en el botón, queda marcado y va en el siguiente mensaje", async () => {
    const mock = twoProviders();
    mount(mock);
    await pick("NaN Builders · qwen-max");
    const t = await trigger();
    expect(t).toHaveTextContent("NaN Builders · qwen-max");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(t).toHaveFocus();
    await say("Hola");
    expect(mock.controls.state.chatLlm).toEqual([{ providerId: "nan", model: "qwen-max" }]);
    await userEvent.click(t);
    expect(await screen.findByRole("option", { name: "NaN Builders · qwen-max" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "NaN Builders · deepseek-v4-pro" })).toHaveAttribute("aria-selected", "false");
  });

  it("Reintentar pregunta con el modelo elegido ahora", async () => {
    const mock = twoProviders();
    mount(mock);
    await say("¿Qué se decidió?");
    await pick("NaN Builders · qwen-max");
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(mock.controls.state.chatLlm).toEqual([null, { providerId: "nan", model: "qwen-max" }]));
  });

  it("recuerda la elección de cada chat y usa la última en los chats nuevos", async () => {
    const mock = twoProviders();
    const a = mount(mock, m1);
    await pick("NaN Builders · qwen-max");
    a.unmount();

    const b = mount(mock, m2);
    expect(await trigger()).toHaveTextContent("NaN Builders · qwen-max");
    await pick("Claude Code (CLI) · opus");
    b.unmount();

    const c = mount(mock, m1);
    expect(await trigger()).toHaveTextContent("NaN Builders · qwen-max");
    c.unmount();

    mount(mock, { kind: "all" });
    expect(await trigger()).toHaveTextContent("Claude Code (CLI) · opus");
    await say("Hola");
    expect(mock.controls.state.chatLlm).toEqual([{ providerId: "claude-cli", model: "opus" }]);
  });

  it("al cambiar de chat sin desmontar, cambia la elección", async () => {
    const mock = twoProviders();
    localStorage.setItem("acta.chat.llm.meeting:m2", JSON.stringify({ providerId: "nan", model: "deepseek-v4-pro" }));
    const r = mount(mock, m1);
    await waitFor(async () => expect(await trigger()).toHaveTextContent("Claude Code (CLI)"));
    r.rerender(
      <ApiProvider api={mock.api}>
        <ChatContainer scope={m2} onCitation={() => {}} />
      </ApiProvider>,
    );
    await waitFor(async () => expect(await trigger()).toHaveTextContent("NaN Builders · deepseek-v4-pro"));
  });

  it("si el proveedor guardado ya no está activado, vuelve al de por defecto sin decir nada", async () => {
    const mock = twoProviders();
    localStorage.setItem("acta.chat.llm.meeting:m1", JSON.stringify({ providerId: "borrado", model: "x" }));
    localStorage.setItem("acta.chat.llm.last", "{no es json");
    mount(mock);
    const t = await trigger();
    await waitFor(() => expect(t).toHaveTextContent("Claude Code (CLI)"));
    expect(t).not.toHaveTextContent(/borrado|undefined|NaN/);
    await say("Hola");
    expect(mock.controls.state.chatLlm).toEqual([null]);
  });

  it("con muchos modelos hay un filtro que acota la lista", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `modelo-${i + 1}`).concat("qwen-max");
    const mock = twoProviders(many);
    mount(mock);
    await openPicker();
    const filter = await screen.findByRole("combobox", { name: "Filtrar modelos" });
    expect(filter).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(44);
    await userEvent.type(filter, "QWEN");
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["NaN Builders · qwen-max"]);
    await userEvent.keyboard("{Enter}");
    expect(await trigger()).toHaveTextContent("NaN Builders · qwen-max");
    expect(mock.controls.state.chatLlm).toEqual([]);

    await openPicker();
    await userEvent.type(await screen.findByRole("combobox", { name: "Filtrar modelos" }), "zzz");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("Ningún modelo coincide con «zzz».")).toBeInTheDocument();
  });

  it("con pocos modelos no hay filtro y se navega con las flechas", async () => {
    mount(twoProviders());
    await openPicker();
    await screen.findByRole("option", { name: "Claude Code (CLI) · sonnet" });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const list = screen.getByRole("listbox", { name: "Modelo de IA" });
    expect(list).toHaveFocus();
    // La primera fila ya está resaltada al abrir.
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Claude Code (CLI) · sonnet" }).id);
    await userEvent.keyboard("{ArrowDown}");
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Claude Code (CLI) · opus" }).id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{End}{Enter}");
    expect(await trigger()).toHaveTextContent("NaN Builders · qwen-max");
  });

  it("Esc cierra sin cambiar nada y devuelve el foco al botón", async () => {
    mount(twoProviders());
    await openPicker();
    await screen.findByRole("option", { name: "Claude Code (CLI) · sonnet" });
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const t = await trigger();
    expect(t).toHaveFocus();
    expect(t).toHaveTextContent("Claude Code (CLI)");
  });

  it("mientras busca los modelos lo dice", async () => {
    const mock = twoProviders();
    let release: (v: Awaited<ReturnType<Mock["api"]["llmProvidersAvailable"]>>) => void = () => {};
    mock.api.llmProvidersAvailable = () => new Promise((r) => (release = r));
    mount(mock);
    await openPicker();
    expect(await screen.findByText("Buscando modelos…")).toBeInTheDocument();
    await act(async () => release([]));
    expect(await screen.findByText("No hay proveedores de IA activados. Actívalos en Ajustes → Proveedores de IA.")).toBeInTheDocument();
  });

  it("sin proveedor configurado lo avisa en vez de enseñar un nombre roto", async () => {
    const mock = createMockApi();
    mock.controls.state.settings.llm.providers = [];
    mount(mock);
    const t = await screen.findByRole("button", { name: "Modelo de IA: Sin proveedor de IA" });
    expect(t).toHaveClass("composer-model-warn");
    await userEvent.click(t);
    expect(await screen.findByText("No hay proveedores de IA activados. Actívalos en Ajustes → Proveedores de IA.")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("si no puede cargar los modelos enseña el error y deja reintentar", async () => {
    const mock = twoProviders();
    const real = mock.api.llmProvidersAvailable;
    mock.api.llmProvidersAvailable = async () => {
      throw { code: "unavailable", message: "No se pudo conectar con el servidor" };
    };
    mount(mock);
    await openPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar con el servidor");
    mock.api.llmProvidersAvailable = real;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("option", { name: "NaN Builders · qwen-max" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("se puede cambiar de modelo mientras llega una respuesta", async () => {
    const mock = twoProviders();
    mock.api.chatSend = async (threadId, text) => ({
      userMessage: { id: "u9", threadId, role: "user", content: text, citations: [], provider: null, createdAt: 0 },
      assistantMessageId: "a9",
    });
    mount(mock);
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "Hola{Enter}");
    await screen.findByRole("status", { name: "Pensando" });
    await pick("NaN Builders · qwen-max");
    expect(await trigger()).toHaveTextContent("NaN Builders · qwen-max");
    expect(screen.getByRole("status", { name: "Pensando" })).toBeInTheDocument();
  });

  it("elegir modelo en el filtro no envía el formulario", async () => {
    const onSend = vi.fn();
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    render(
      <ChatView
        messages={[]}
        streams={{}}
        busy={false}
        model={{ label: "X", providerId: "x", model: null, missing: false }}
        onPickModel={() => {}}
        loadProviders={async () => [{ providerId: "x", label: "X", kind: "openAiCompatible", models: many, defaultModel: null, isDefault: true, defaultFor: ["chat"] }]}
        onSend={onSend}
        onCitation={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Pregunta" }), "a medias");
    await userEvent.click(screen.getByRole("button", { name: /^Modelo de IA/ }));
    await userEvent.type(await screen.findByRole("combobox", { name: "Filtrar modelos" }), "m1{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("Detener de verdad", () => {
  const scope: ChatScope = { kind: "meeting", meetingId: "m1" };
  const slowSend = (api: ReturnType<typeof createMockApi>["api"]) => {
    api.chatSend = async (threadId, text) => ({
      userMessage: { id: "u9", threadId, role: "user", content: text, citations: [], provider: null, createdAt: 0 },
      assistantMessageId: "a9",
    });
  };
  const mount = (api: ReturnType<typeof createMockApi>["api"]) =>
    render(
      <ApiProvider api={api}>
        <ChatContainer scope={scope} onCitation={() => {}} />
      </ApiProvider>,
    );

  it("Detener cancela la generación en el backend", async () => {
    const { api, controls } = createMockApi();
    slowSend(api);
    mount(api);
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "Hola{Enter}");
    await screen.findByRole("status", { name: "Pensando" });
    await userEvent.click(await screen.findByRole("button", { name: "Detener" }));
    expect(controls.state.cancelled).toEqual(["a9"]);
    expect(screen.getByText("Respuesta detenida")).toBeInTheDocument();
  });

  it("si cancelar falla, la pantalla sigue detenida y nada revienta", async () => {
    const { api } = createMockApi();
    slowSend(api);
    api.chatCancel = async () => {
      throw { code: "unavailable", message: "sin backend" };
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(api);
    await userEvent.type(await screen.findByRole("textbox", { name: "Pregunta" }), "Hola{Enter}");
    await screen.findByRole("status", { name: "Pensando" });
    await userEvent.click(await screen.findByRole("button", { name: "Detener" }));
    expect(await screen.findByText("Respuesta detenida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
