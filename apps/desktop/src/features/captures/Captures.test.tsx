import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi } from "../../api";
import { sampleMeeting } from "../../api/mock";
import { ApiProvider } from "../../app/ApiContext";
import { CapturesTab } from "./CapturesTab";
import { CapturesContainer } from "./CapturesContainer";

const d = sampleMeeting();
const taskId = d.minutes!.actionItems[0]!.id;
const cap = (n: number, over = {}) => ({
  id: `c${n}`,
  meetingId: d.meeting.id,
  at: n * 10_000,
  atWall: 0,
  path: `captures/00000${n}-slideChange.jpg`,
  reason: "slideChange" as const,
  phash: "0",
  width: 100,
  height: 50,
  keyword: null,
  topicPath: null,
  actionItemIds: [],
  ...over,
});

function setup(captures = [cap(1, { topicPath: "1", actionItemIds: [taskId] }), cap(2)]) {
  const props = {
    captures,
    minutes: d.minutes,
    escaleta: d.escaleta,
    srcFor: (c: { path: string }) => `asset://${c.path}`,
    onSeek: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<CapturesTab {...props} />);
  return props;
}

describe("CapturesTab", () => {
  it("muestra la galería", () => {
    setup();
    expect(screen.getAllByRole("button", { name: /Captura/ })).toHaveLength(2);
  });

  it("abre el lightbox con tema y tarea vinculados", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Plan");
    expect(dialog).toHaveTextContent("Enviar presupuesto");
  });

  it("navega entre capturas y cierra con Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    await userEvent.click(screen.getByRole("button", { name: "Siguiente captura" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("00:20");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ir al momento salta en el audio", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    await userEvent.click(screen.getByRole("button", { name: "Ir al momento" }));
    expect(p.onSeek).toHaveBeenCalledWith(10_000);
  });

  it("elimina una captura", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    await userEvent.click(screen.getByRole("button", { name: "Eliminar captura" }));
    expect(p.onDelete).toHaveBeenCalledWith("c1");
  });

  it("sin capturas explica que es opt-in", () => {
    setup([]);
    expect(screen.getByText("No hay capturas")).toBeInTheDocument();
  });
});

describe("CapturesContainer", () => {
  it("resuelve la URL con el directorio de datos", async () => {
    const { api } = createMockApi();
    render(
      <ApiProvider api={api}>
        <CapturesContainer detail={{ ...d, captures: [cap(1)] }} onSeek={() => {}} onChanged={() => {}} />
      </ApiProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Captura 1" })).toHaveAttribute(
        "src",
        `file:///tmp/acta/meetings/${d.meeting.id}/captures/000001-slideChange.jpg`,
      ),
    );
  });
});

describe("visor de capturas", () => {
  it("las flechas del teclado pasan de captura sin salirse", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    expect(screen.getByRole("button", { name: "Captura anterior" })).toBeDisabled();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog")).toHaveTextContent("2 de 2");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog")).toHaveTextContent("2 de 2");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog")).toHaveTextContent("1 de 2");
  });

  it("se puede cerrar con su botón y enseña por qué se capturó", async () => {
    setup([cap(1, { reason: "keyword", keyword: "deadline" })]);
    await userEvent.click(screen.getByRole("button", { name: "Captura 1 en 00:10" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Palabra clave");
    expect(screen.getByRole("dialog")).toHaveTextContent("«deadline»");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar visor" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
