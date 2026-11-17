import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type ChatMessage, type ChatScope, type Citation } from "../../api";
import { ApiProvider } from "../../app/ApiContext";
import { ChatContainer } from "./ChatContainer";
import { ChatView } from "./ChatView";

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
    render(<ChatView messages={[assistant("Hola")]} streams={{}} busy={false} providerLabel="Claude Code · sonnet" providerNames={{ "claude-cli": "Claude Code" }} onSend={() => {}} onCitation={() => {}} />);
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
