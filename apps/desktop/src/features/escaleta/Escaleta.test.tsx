import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Escaleta } from "../../api";
import { EscaletaTab } from "./EscaletaTab";

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
