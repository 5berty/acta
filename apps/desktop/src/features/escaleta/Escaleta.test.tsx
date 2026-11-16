import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Escaleta } from "../../api";
import { EscaletaTab } from "./EscaletaTab";
import { layoutMindMap } from "./MindMap";

const tema = (titulo: string, inicio_ms: number, subtemas: Escaleta["temas"] = []) => ({
  titulo,
  resumen: `Resumen de ${titulo}`,
  inicio_ms,
  fin_ms: inicio_ms + 1000,
  subtemas,
  capturas: [],
});
const escaleta: Escaleta = { temas: [tema("Plan", 0, [tema("Presupuesto", 5000)]), tema("Riesgos", 70_000)] };

describe("EscaletaTab", () => {
  it("pinta el árbol y colapsa subtemas", async () => {
    render(<EscaletaTab escaleta={escaleta} onSeek={() => {}} />);
    expect(screen.getByText("Presupuesto")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Contraer Plan" }));
    expect(screen.queryByText("Presupuesto")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expandir Plan" }));
    expect(screen.getByText("Presupuesto")).toBeInTheDocument();
  });

  it("salta al inicio del tema", async () => {
    const onSeek = vi.fn();
    render(<EscaletaTab escaleta={escaleta} onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: "Ir a 01:10" }));
    expect(onSeek).toHaveBeenCalledWith(70_000);
  });

  it("sin escaleta, estado vacío", () => {
    render(<EscaletaTab escaleta={null} onSeek={() => {}} />);
    expect(screen.getByText("Todavía no hay escaleta")).toBeInTheDocument();
  });
});

describe("mapa de la escaleta", () => {
  it("cambia a la vista de mapa y cada nodo salta a su minuto", async () => {
    const onSeek = vi.fn();
    render(<EscaletaTab escaleta={escaleta} title="Daily" onSeek={onSeek} />);
    expect(screen.queryByRole("group", { name: "Mapa de la escaleta" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mapa" }));
    const map = screen.getByRole("group", { name: "Mapa de la escaleta" });
    expect(map).toHaveTextContent("Daily");
    await userEvent.click(screen.getByRole("button", { name: "Presupuesto (00:05)" }));
    expect(onSeek).toHaveBeenCalledWith(5000);
    await userEvent.click(screen.getByRole("button", { name: "Esquema" }));
    expect(screen.getByRole("list", { name: "Escaleta" })).toBeInTheDocument();
  });

  it("coloca las hojas en filas y centra cada padre entre sus hijos", () => {
    const { nodes, width, height } = layoutMindMap({ temas: [tema("A", 0, [tema("A1", 1), tema("A2", 2)]), tema("B", 3)] }, "Raíz");
    const y = (label: string) => nodes.find((n) => n.label === label)!.y;
    const x = (label: string) => nodes.find((n) => n.label === label)!.x;
    expect(nodes.map((n) => n.label)).toEqual(["Raíz", "A", "A1", "A2", "B"]);
    expect(y("A")).toBe((y("A1") + y("A2")) / 2);
    expect(y("A2")).toBeGreaterThan(y("A1"));
    expect(y("B")).toBeGreaterThan(y("A2"));
    expect(y("Raíz")).toBe((y("A") + y("B")) / 2);
    expect(x("Raíz")).toBeLessThan(x("A"));
    expect(x("A")).toBeLessThan(x("A1"));
    expect(width).toBeGreaterThan(x("A1"));
    expect(height).toBeGreaterThan(y("B"));
  });

  it("muestra cuánto dura cada tema", () => {
    render(<EscaletaTab escaleta={{ temas: [{ ...tema("Largo", 0), fin_ms: 600_000 }] }} onSeek={() => {}} />);
    expect(screen.getByText("10 min")).toBeInTheDocument();
  });
});
