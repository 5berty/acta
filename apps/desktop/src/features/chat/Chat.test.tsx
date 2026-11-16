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
    expect(screen.getByLabelText("Pensando")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
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
