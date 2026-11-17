import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChipsInput } from "./ChipsInput";

function Harness({ initial = [], suggestions, spy }: { initial?: string[]; suggestions?: string[]; spy?: (v: string[]) => void }) {
  const [values, setValues] = useState(initial);
  return (
    <ChipsInput
      label="Otros nombres"
      placeholder="Álex, Alejandra"
      values={values}
      suggestions={suggestions}
      onChange={(v) => {
        spy?.(v);
        setValues(v);
      }}
    />
  );
}
const chips = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

describe("ChipsInput", () => {
  it("añade con Intro y con coma, sin espacios sobrantes", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Otros nombres");
    await userEvent.type(input, "  Álex {Enter}");
    await userEvent.type(input, "Ale,");
    expect(chips()).toEqual(["Álex", "Ale"]);
    expect(input).toHaveValue("");
  });

  it("al pegar varios separados por comas los añade todos", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Otros nombres"));
    await userEvent.paste("Álex, Alejandra ,  Romero");
    await userEvent.keyboard("{Enter}");
    expect(chips()).toEqual(["Álex", "Alejandra", "Romero"]);
  });

  it("no repite uno que ya está, aunque cambien las mayúsculas", async () => {
    const spy = vi.fn();
    render(<Harness initial={["Álex"]} spy={spy} />);
    await userEvent.type(screen.getByLabelText("Otros nombres"), "álex{Enter}");
    expect(chips()).toEqual(["Álex"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("lo que quede escrito se añade al salir del campo", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("Otros nombres"), "Ale");
    await userEvent.tab();
    expect(chips()).toEqual(["Ale"]);
  });

  it("quita una ficha con su botón o con Retroceso en el campo vacío", async () => {
    render(<Harness initial={["Álex", "Ale", "Romero"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Quitar «Ale»" }));
    expect(chips()).toEqual(["Álex", "Romero"]);
    await userEvent.type(screen.getByLabelText("Otros nombres"), "{Backspace}");
    expect(chips()).toEqual(["Álex"]);
  });

  it("propone sugerencias de un toque y las retira al usarlas", async () => {
    render(<Harness initial={["Ale"]} suggestions={["Álex", "ale"]} />);
    expect(screen.queryByRole("button", { name: "Añadir «ale»" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Añadir «Álex»" }));
    expect(chips()).toEqual(["Ale", "Álex"]);
    expect(screen.queryByRole("button", { name: "Añadir «Álex»" })).not.toBeInTheDocument();
  });
});
