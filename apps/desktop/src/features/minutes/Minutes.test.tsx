import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleMeeting } from "../../api/mock";
import { Markdown } from "../../shared/Markdown";
import { MinutesTab } from "./MinutesTab";

describe("Markdown", () => {
  it("renderiza listas, encabezados y negrita", () => {
    render(<Markdown source={"## Plan\n- uno **fuerte**\n- dos\n\nTexto suelto"} />);
    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("fuerte").tagName).toBe("STRONG");
    expect(screen.getByText("Texto suelto")).toBeInTheDocument();
  });
});

describe("MinutesTab", () => {
  const base = sampleMeeting();
  const minutes = base.minutes!;
  minutes.actionItems.push({
    ...minutes.actionItems[0]!,
    id: "other-1",
    text: "Revisar contrato",
    ownerName: "Ana",
    isMine: false,
    due: null,
    at: null,
  });

  it("separa 'Mis tareas' de 'Tareas de otros'", () => {
    render(<MinutesTab minutes={minutes} onToggleTask={() => {}} onSeek={() => {}} />);
    const mine = screen.getByRole("region", { name: "Mis tareas" });
    const others = screen.getByRole("region", { name: "Tareas de otros" });
    expect(within(mine).getByRole("checkbox", { name: "Enviar presupuesto" })).toBeInTheDocument();
    expect(within(others).getByRole("checkbox", { name: "Revisar contrato" })).toBeInTheDocument();
    expect(within(others).getByText("Ana")).toBeInTheDocument();
  });

  it("marcar una tarea avisa con el nuevo estado", async () => {
    const onToggle = vi.fn();
    render(<MinutesTab minutes={minutes} onToggleTask={onToggle} onSeek={() => {}} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Enviar presupuesto" }));
    expect(onToggle).toHaveBeenCalledWith(minutes.actionItems[0]!.id, true);
  });

  it("saltar al momento de una decisión", async () => {
    const onSeek = vi.fn();
    render(<MinutesTab minutes={minutes} onToggleTask={() => {}} onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: "Ir a 01:00" }));
    expect(onSeek).toHaveBeenCalledWith(60_000);
  });

  it("sin acta muestra un aviso", () => {
    render(<MinutesTab minutes={null} onToggleTask={() => {}} onSeek={() => {}} />);
    expect(screen.getByText("Todavía no hay acta")).toBeInTheDocument();
  });
});
