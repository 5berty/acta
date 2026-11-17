import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionItem, Decision, TimelineEvent } from "../../api";
import { TimelineTab } from "./TimelineTab";

const events: TimelineEvent[] = [
  { at: 0, end: 50_000, kind: "topic", label: "Plan", refId: null },
  { at: 50_000, end: 100_000, kind: "topic", label: "Riesgos", refId: null },
  { at: 75_000, end: null, kind: "decision", label: "Lanzar el lunes", refId: "d1" },
  { at: 20_000, end: null, kind: "capture", label: "Diapositiva", refId: "c1" },
];

/** Reunión de 10 minutos con un tema estrecho, un subtema y una tarea. */
const LONG_TITLE = "Subcontratación del soporte de segundo nivel y calendario de traspaso";
const rich: TimelineEvent[] = [
  { at: 0, end: 300_000, kind: "topic", label: "Arranque", refId: "1" },
  { at: 300_000, end: 320_000, kind: "topic", label: LONG_TITLE, refId: "2" },
  { at: 302_000, end: 310_000, kind: "topic", label: "Proveedores candidatos", refId: "2.1" },
  { at: 320_000, end: 600_000, kind: "topic", label: "Cierre", refId: "3" },
  { at: 75_000, end: null, kind: "actionItem", label: "Enviar el informe", refId: "a1" },
  { at: 400_000, end: null, kind: "decision", label: "Lanzar el lunes", refId: "d1" },
];
const decisions = [{ id: "d1", text: "Lanzar el lunes en toda la región", at: 400_000 }] as unknown as Decision[];
const actionItems = [
  { id: "a1", meetingId: "m1", text: "Enviar el informe trimestral a dirección", ownerName: "Ana", ownerSpeakerId: null, isMine: true, due: "viernes", done: false, at: 75_000, captureIds: [] },
] as unknown as ActionItem[];

// vitest solo procesa las hojas declaradas en su configuración: esta se lee del disco.
const css = readFileSync("src/styles/timeline.css", "utf8");

const plot = () => screen.getByRole("group", { name: "Línea de tiempo" });
const inPlot = () => within(plot());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TimelineTab", () => {
  it("coloca los temas proporcionalmente", () => {
    render(<TimelineTab events={events} duration={100_000} onSeek={() => {}} />);
    const risks = inPlot().getByRole("button", { name: /Riesgos/ });
    expect(risks.style.left).toBe("50%");
    expect(risks.style.width).toBe("50%");
  });

  it("al pulsar un tema salta exactamente a su inicio", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={events} duration={100_000} onSeek={onSeek} />);
    await userEvent.click(inPlot().getByRole("button", { name: /Riesgos/ }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(50_000);
  });

  it("sin eventos, estado vacío", () => {
    render(<TimelineTab events={[]} duration={0} onSeek={() => {}} />);
    expect(screen.getByText("No hay eventos en la línea de tiempo")).toBeInTheDocument();
  });
});

describe("cabeza lectora", () => {
  it("comparte el sistema de coordenadas con los temas", () => {
    const { container } = render(<TimelineTab events={events} duration={100_000} currentMs={50_000} onSeek={() => {}} />);
    const risks = inPlot().getByRole("button", { name: /Riesgos/ });
    const playhead = container.querySelector<HTMLElement>(".tl-playhead")!;
    // Mismo contenedor de trazado: mismo borde izquierdo y mismo ancho que las pistas.
    expect(playhead.closest(".tl-plot")).toBe(plot());
    expect(playhead.parentElement?.parentElement).toBe(plot());
    expect(risks.parentElement?.parentElement?.parentElement).toBe(plot());
    expect(playhead.style.left).toBe(risks.style.left);
    expect(container.querySelector(".playhead-rail")).toBeNull();
  });

  it("la hoja de estilos no desplaza ni la capa ni las pistas respecto al trazado", () => {
    const rule = (selector: string) => new RegExp(`(^|\\n)\\${selector} \\{([^}]*)\\}`).exec(css)?.[2] ?? "";
    expect(rule(".tl-overlay")).toMatch(/inset:\s*0/);
    expect(rule(".tl-track")).not.toMatch(/margin|padding|left|right|width/);
    expect(rule(".tl-lane")).not.toMatch(/grid|padding|margin-(left|right)|left|right/);
    expect(css).not.toMatch(/\.playhead-rail|left:\s*160px/);
  });

  it("se ve también en el segundo cero y no intercepta clics", () => {
    const { container } = render(<TimelineTab events={events} duration={100_000} currentMs={0} onSeek={() => {}} />);
    const playhead = container.querySelector<HTMLElement>(".tl-playhead")!;
    expect(playhead.style.left).toBe("0%");
    expect(playhead.closest("[aria-hidden]")).not.toBeNull();
    expect(css).toMatch(/\.tl-overlay \{[^}]*pointer-events:\s*none/);
  });

  it("sin audio no hay cabeza lectora", () => {
    const { container } = render(<TimelineTab events={events} duration={100_000} onSeek={() => {}} />);
    expect(container.querySelector(".tl-playhead")).toBeNull();
  });
});

describe("temas legibles", () => {
  it("el bloque que no cabe enseña su número y la lista el título entero", () => {
    render(<TimelineTab events={rich} duration={600_000} onSeek={() => {}} />);
    const narrow = inPlot().getByRole("button", { name: new RegExp(`Tema 2: ${LONG_TITLE}`) });
    expect(narrow).toHaveTextContent(/^2$/);
    expect(inPlot().getByRole("button", { name: /Tema 1: Arranque/ })).toHaveTextContent("Arranque");
    const list = within(screen.getByRole("list", { name: "Temas" }));
    const rows = list.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent(LONG_TITLE);
    expect(rows[1]).toHaveTextContent("05:00");
    expect(rows[2]).toHaveTextContent("2.1");
    expect(rows[2]).toHaveTextContent("Proveedores candidatos");
    expect(list.getByRole("button", { name: /Proveedores candidatos/ })).toHaveAttribute("data-depth", "1");
  });

  it("pulsar una fila de la lista salta exactamente al inicio del tema", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} onSeek={onSeek} />);
    await userEvent.click(within(screen.getByRole("list", { name: "Temas" })).getByRole("button", { name: /Proveedores candidatos/ }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(302_000);
  });

  it("el subtema va en su propia fila, más fina, sin pisar al padre", () => {
    render(<TimelineTab events={rich} duration={600_000} onSeek={() => {}} />);
    const parent = inPlot().getByRole("button", { name: /^Tema 2:/ });
    const child = inPlot().getByRole("button", { name: /^Tema 2\.1:/ });
    expect(parent).toHaveAttribute("data-depth", "0");
    expect(child).toHaveAttribute("data-depth", "1");
    expect(child.style.top).not.toBe(parent.style.top);
  });

  it("resalta la fila al pasar por el bloque y viceversa", async () => {
    render(<TimelineTab events={rich} duration={600_000} onSeek={() => {}} />);
    const block = inPlot().getByRole("button", { name: /Tema 3: Cierre/ });
    const row = within(screen.getByRole("list", { name: "Temas" })).getByRole("button", { name: /Cierre/ });
    await userEvent.hover(block);
    expect(row).toHaveAttribute("data-hot", "true");
    await userEvent.unhover(block);
    expect(row).not.toHaveAttribute("data-hot");
    await userEvent.hover(row);
    expect(block).toHaveAttribute("data-hot", "true");
  });

  it("marca como actual el tema que contiene la cabeza lectora, en el trazado y en la lista", () => {
    render(<TimelineTab events={rich} duration={600_000} currentMs={305_000} onSeek={() => {}} />);
    const list = within(screen.getByRole("list", { name: "Temas" }));
    expect(inPlot().getByRole("button", { name: /^Tema 2\.1:/ })).toHaveAttribute("aria-current", "true");
    expect(list.getByRole("button", { name: /Proveedores candidatos/ })).toHaveAttribute("aria-current", "true");
    expect(inPlot().getByRole("button", { name: /^Tema 1:/ })).not.toHaveAttribute("aria-current");
    expect(list.getByRole("button", { name: /Arranque/ })).not.toHaveAttribute("aria-current");
  });
});

describe("marcadores que se explican", () => {
  const TASK = "Tarea: Enviar el informe trimestral a dirección (01:15)";

  it("al pasar por una tarea se ve el texto, el responsable y la fecha", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} decisions={decisions} actionItems={actionItems} onSeek={onSeek} />);
    await userEvent.hover(inPlot().getByRole("button", { name: TASK }));
    const pop = within(await screen.findByRole("dialog"));
    expect(pop.getByText("Tarea")).toBeInTheDocument();
    expect(pop.getByText("Enviar el informe trimestral a dirección")).toBeInTheDocument();
    expect(pop.getByText("Ana")).toBeInTheDocument();
    expect(pop.getByText("viernes")).toBeInTheDocument();
    expect(pop.getByText("Pendiente")).toBeInTheDocument();
    expect(pop.getByText("Es tuya")).toBeInTheDocument();
    expect(onSeek).not.toHaveBeenCalled();
    await userEvent.click(pop.getByRole("button", { name: "Ir al minuto 01:15" }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(75_000);
  });

  it("al salir con el ratón se cierra, salvo que se haya fijado con un clic", async () => {
    render(<TimelineTab events={rich} duration={600_000} decisions={decisions} actionItems={actionItems} onSeek={() => {}} />);
    const marker = inPlot().getByRole("button", { name: TASK });
    await userEvent.hover(marker);
    await screen.findByRole("dialog");
    await userEvent.unhover(marker);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(marker);
    expect(marker).toHaveAttribute("aria-expanded", "true");
    await userEvent.unhover(marker);
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con teclado: el foco lo abre, Intro lo fija, se llega al botón y Esc devuelve el foco", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} decisions={decisions} actionItems={actionItems} onSeek={onSeek} />);
    const marker = inPlot().getByRole("button", { name: TASK });
    marker.focus();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Ir al minuto 01:15" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(marker).toHaveFocus();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("sin datos del acta, cae en la etiqueta del evento", async () => {
    render(<TimelineTab events={events} duration={100_000} onSeek={() => {}} />);
    await userEvent.hover(inPlot().getByRole("button", { name: "Decisión: Lanzar el lunes (01:15)" }));
    const pop = within(await screen.findByRole("dialog"));
    expect(pop.getByText("Lanzar el lunes")).toBeInTheDocument();
    expect(pop.queryByText("Sin responsable")).not.toBeInTheDocument();
    expect(inPlot().getByRole("button", { name: "Captura: Diapositiva (00:20)" })).toHaveClass("tl-capture");
  });

  it("una tarea sin responsable lo dice", async () => {
    const orphan = [{ ...actionItems[0], ownerName: null, isMine: false, due: null, done: true }] as ActionItem[];
    render(<TimelineTab events={rich} duration={600_000} actionItems={orphan} onSeek={() => {}} />);
    await userEvent.hover(inPlot().getByRole("button", { name: TASK }));
    const pop = within(await screen.findByRole("dialog"));
    expect(pop.getByText("Sin responsable")).toBeInTheDocument();
    expect(pop.getByText("Hecha")).toBeInTheDocument();
    expect(pop.queryByText("Es tuya")).not.toBeInTheDocument();
    expect(pop.queryByText("Vence")).not.toBeInTheDocument();
  });

  it("los marcadores que se pisan siguen siendo alcanzables uno a uno", async () => {
    const onSeek = vi.fn();
    const crowd: TimelineEvent[] = [
      { at: 0, end: 600_000, kind: "topic", label: "Todo", refId: "1" },
      ...[0, 1, 2, 3, 4].map((i): TimelineEvent => ({ at: 300_000 + i * 100, end: null, kind: "decision", label: `Acuerdo ${i + 1}`, refId: `d${i}` })),
    ];
    render(<TimelineTab events={crowd} duration={600_000} onSeek={onSeek} />);
    const first = inPlot().getByRole("button", { name: /^Decisión: Acuerdo 1 / });
    const second = inPlot().getByRole("button", { name: /^Decisión: Acuerdo 2 / });
    expect(first.parentElement?.style.top).not.toBe(second.parentElement?.style.top);
    const cluster = inPlot().getByRole("button", { name: "3 decisiones (05:00)" });
    expect(cluster).toHaveTextContent("3");
    await userEvent.click(cluster);
    const pop = within(screen.getByRole("dialog"));
    expect(pop.getByText("Acuerdo 3")).toBeInTheDocument();
    expect(pop.getByText("Acuerdo 4")).toBeInTheDocument();
    const jumps = pop.getAllByRole("button", { name: "Ir al minuto 05:00" });
    expect(jumps).toHaveLength(3);
    await userEvent.click(jumps[2]!);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(300_400);
  });

  it("lista decisiones y tareas debajo, y pulsar una fila salta a su inicio", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} decisions={decisions} actionItems={actionItems} onSeek={onSeek} />);
    const list = within(screen.getByRole("list", { name: "Decisiones y tareas" }));
    const rows = list.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("01:15");
    expect(rows[0]).toHaveTextContent("Enviar el informe trimestral a dirección");
    expect(rows[0]).toHaveTextContent("Ana");
    expect(rows[0]).toHaveTextContent("viernes");
    expect(rows[1]).toHaveTextContent("Lanzar el lunes en toda la región");
    await userEvent.click(list.getByRole("button", { name: /Lanzar el lunes/ }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(400_000);
  });
});

describe("regla del tiempo", () => {
  const ruler = () => screen.getByRole("slider", { name: "Posición en la reunión" });
  const mockRect = () =>
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 100, width: 800, top: 0, height: 20, right: 900, bottom: 20, x: 100, y: 0, toJSON: () => ({}) });

  it("un clic lleva al instante bajo el puntero y arrastrar lo sigue 1:1", () => {
    mockRect();
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} currentMs={0} onSeek={onSeek} />);
    fireEvent.pointerDown(ruler(), { clientX: 500, pointerId: 1, button: 0 });
    expect(onSeek).toHaveBeenLastCalledWith(300_000);
    expect(screen.getByRole("tooltip")).toHaveTextContent("05:00");
    fireEvent.pointerMove(ruler(), { clientX: 700, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(450_000);
    fireEvent.pointerMove(ruler(), { clientX: 5000, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(600_000);
    fireEvent.pointerUp(ruler(), { clientX: 5000, pointerId: 1 });
    onSeek.mockClear();
    fireEvent.pointerMove(ruler(), { clientX: 300, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent("02:30");
  });

  it("las flechas mueven cinco segundos y anuncia el tiempo", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={rich} duration={600_000} currentMs={2_000} onSeek={onSeek} />);
    expect(ruler()).toHaveAttribute("aria-valuetext", "00:02");
    ruler().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenLastCalledWith(7_000);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(0);
    await userEvent.keyboard("{End}");
    expect(onSeek).toHaveBeenLastCalledWith(600_000);
  });

  it("en 90 minutos las etiquetas no se repiten ni se amontonan", () => {
    const long: TimelineEvent[] = [
      ...Array.from({ length: 25 }, (_, i): TimelineEvent => ({ at: i * 216_000, end: (i + 1) * 216_000, kind: "topic", label: `Tema largo número ${i + 1}`, refId: `${i + 1}` })),
      ...Array.from({ length: 40 }, (_, i): TimelineEvent => ({ at: 60_000 + i * 130_000, end: null, kind: "actionItem", label: `Tarea ${i + 1}`, refId: `a${i}` })),
    ];
    const { container } = render(<TimelineTab events={long} duration={5_400_000} currentMs={0} onSeek={() => {}} />);
    const labels = [...container.querySelectorAll(".tl-tick")].map((t) => t.textContent);
    expect(labels[0]).toBe("00:00");
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("1:00:00");
    expect(within(screen.getByRole("list", { name: "Temas" })).getAllByRole("listitem")).toHaveLength(25);
    expect(within(screen.getByRole("list", { name: "Decisiones y tareas" })).getAllByRole("listitem")).toHaveLength(40);
  });
});
