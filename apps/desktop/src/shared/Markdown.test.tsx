import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockApi, type Citation } from "../api";
import { ApiProvider } from "../app/ApiContext";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("pinta listas numeradas, anidadas y negrita", () => {
    render(<Markdown source={"1. **Uno**\n2. Dos\n   - hijo\n\n- suelto"} />);
    const lists = screen.getAllByRole("list");
    expect(lists[0]?.tagName).toBe("OL");
    expect(screen.getByText("Uno").tagName).toBe("STRONG");
    expect(screen.getByText("hijo").closest("ul")?.parentElement?.tagName).toBe("LI");
    expect(screen.getByText("suelto")).toBeInTheDocument();
  });

  it("pinta bloques de código sin interpretar su contenido", () => {
    const { container } = render(<Markdown source={"Antes\n\n```ts\nconst a = **1**;\n```\n\nDespués"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("const a = **1**;");
    expect(container.querySelector("pre strong")).toBeNull();
  });

  it("un bloque de código a medias (streaming) no rompe", () => {
    const { container } = render(<Markdown source={"```\nlet x"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("let x");
  });

  it("pinta tablas, citas y tachado", () => {
    const { container } = render(<Markdown source={"| Quién | Qué |\n|---|---|\n| Ana | ~~nada~~ textos |\n\n> ojo con esto"} />);
    expect(screen.getByRole("columnheader", { name: "Quién" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ana" })).toBeInTheDocument();
    expect(container.querySelector("del")?.textContent).toBe("nada");
    expect(container.querySelector("blockquote")?.textContent).toBe("ojo con esto");
  });

  it("nunca inyecta HTML crudo", () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"> <script>alert(1)</script>'} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("los enlaces http se abren fuera de acta y los demás esquemas quedan como texto", async () => {
    const { api, controls } = createMockApi();
    render(
      <ApiProvider api={api}>
        <Markdown source={"[web](https://example.com) y [malo](javascript:alert(1))"} />
      </ApiProvider>,
    );
    await userEvent.click(screen.getByRole("link", { name: "web" }));
    expect(controls.state.opened).toEqual(["https://example.com"]);
    expect(screen.queryByRole("link", { name: "malo" })).toBeNull();
    expect(screen.getByText(/malo/)).toBeInTheDocument();
  });

  it("convierte [n] en citas clicables también dentro de listas", async () => {
    const c: Citation = { n: 2, meetingId: "m1", meetingTitle: "Daily", at: 65_000, end: 70_000, snippet: "" };
    const onCitation = vi.fn();
    render(<Markdown source={"- Lo dijo Ana [2] y nadie más [9]"} citations={[c]} onCitation={onCitation} />);
    await userEvent.click(screen.getByRole("button", { name: "Cita 2: Daily, 01:05" }));
    expect(onCitation).toHaveBeenCalledWith(c);
    expect(screen.getByText(/nadie más \[9\]/)).toBeInTheDocument();
  });

  it("une las líneas seguidas en un párrafo", () => {
    const { container } = render(<Markdown source={"una\ndos\n\ntres"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});
