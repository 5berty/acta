import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Highlight, findRanges, fold } from "./textSearch";

describe("búsqueda de texto", () => {
  it("ignora mayúsculas y tildes", () => {
    expect(fold("Reunión ÁGIL")).toBe("reunion agil");
    expect(findRanges("La Reunión de la reunion", "reunión")).toEqual([
      [3, 10],
      [17, 24],
    ]);
  });

  it("sin consulta o sin coincidencias no devuelve nada", () => {
    expect(findRanges("hola", "")).toEqual([]);
    expect(findRanges("hola", "  ")).toEqual([]);
    expect(findRanges("hola", "adiós")).toEqual([]);
  });

  it("respeta los índices con texto ya descompuesto", () => {
    const text = "canción rara";
    const [r] = findRanges(text, "rara");
    expect(text.slice(r![0], r![1])).toBe("rara");
  });

  it("Highlight marca los tramos", () => {
    const { container } = render(<Highlight text="las subcuentas nuevas" ranges={[[4, 14]]} />);
    expect(container.querySelector("mark")?.textContent).toBe("subcuentas");
    expect(container.textContent).toBe("las subcuentas nuevas");
  });
});
