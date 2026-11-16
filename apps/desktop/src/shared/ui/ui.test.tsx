import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AvatarStack, Disclosure, EmptyState, IconButton, PlatformIcon, Segmented, Stepper, Switch, Tabs, errorMessage } from "./ui";

function StepperHarness({ initial = 3, onChange = () => {} }: { initial?: number; onChange?: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Stepper
      label="Minutos"
      value={v}
      min={1}
      max={5}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

describe("Stepper", () => {
  it("respeta mínimo y máximo con los botones", async () => {
    render(<StepperHarness initial={4} />);
    const input = screen.getByLabelText("Minutos");
    await userEvent.click(screen.getByRole("button", { name: "Aumentar: Minutos" }));
    await userEvent.click(screen.getByRole("button", { name: "Aumentar: Minutos" }));
    expect(input).toHaveValue(5);
    for (let i = 0; i < 6; i += 1) await userEvent.click(screen.getByRole("button", { name: "Reducir: Minutos" }));
    expect(input).toHaveValue(1);
  });

  it("deja el campo vacío mientras escribes y no avisa con valores a medias", async () => {
    const onChange = vi.fn();
    render(<StepperHarness onChange={onChange} />);
    const input = screen.getByLabelText("Minutos");
    await userEvent.clear(input);
    expect(input).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(input, "2");
    expect(onChange).toHaveBeenLastCalledWith(2);
    await userEvent.tab();
    expect(input).toHaveValue(2);
  });
});

describe("Disclosure", () => {
  it("no monta el contenido hasta que se abre", async () => {
    render(
      <Disclosure label="Avanzado">
        <p>Ruta del binario</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Avanzado" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ruta del binario")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ruta del binario")).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByText("Ruta del binario")).not.toBeInTheDocument();
  });
});

describe("átomos", () => {
  it("el interruptor es una casilla accesible", async () => {
    const onChange = vi.fn();
    render(<Switch label="Activar" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Activar" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("el control segmentado marca la opción elegida", async () => {
    const onChange = vi.fn();
    render(<Segmented label="Fecha" value="a" onChange={onChange} options={[{ key: "a", label: "Todas" }, { key: "b", label: "Hoy" }]} />);
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("las pestañas enseñan el contador solo si hay algo", () => {
    render(<Tabs tabs={[{ key: "a", label: "Capturas", count: 3 }, { key: "b", label: "Chat", count: 0 }]} active="a" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /Capturas/ })).toHaveTextContent("Capturas3");
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveTextContent(/^Chat$/);
  });

  it("los botones de icono se nombran con su etiqueta", () => {
    render(<IconButton label="Volver">←</IconButton>);
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("la pila de avatares resume los que no caben", () => {
    const { container } = render(<AvatarStack names={["Ana", "Luis", "Marta", "Pablo", "Sara", "Edu"]} max={4} />);
    expect(container.querySelectorAll(".avatar")).toHaveLength(5);
    expect(container).toHaveTextContent("+2");
    expect(render(<AvatarStack names={[]} />).container).toBeEmptyDOMElement();
  });

  it("el icono de plataforma es decorativo", () => {
    const { container } = render(<PlatformIcon platform="teams" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("el estado vacío admite acciones", () => {
    render(
      <EmptyState title="Nada" hint="Todavía">
        <button type="button">Empezar</button>
      </EmptyState>,
    );
    expect(screen.getByText("Nada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Empezar" })).toBeInTheDocument();
  });

  it("errorMessage extrae el mensaje del backend", () => {
    expect(errorMessage({ code: "notFound", message: "No existe" })).toBe("No existe");
    expect(errorMessage("x")).toBe("Algo ha fallado");
  });
});
