import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleMeeting } from "../../api/mock";
import { TranscriptTab } from "./TranscriptTab";

const d = sampleMeeting();

function setup(over: Partial<React.ComponentProps<typeof TranscriptTab>> = {}) {
  const props = {
    transcript: d.transcript,
    voiceprintNames: ["Ana", "Luis"],
    currentMs: 0,
    onSeek: vi.fn(),
    onRename: vi.fn(),
    ...over,
  };
  render(<TranscriptTab {...props} />);
  return props;
}

describe("TranscriptTab", () => {
  it("muestra cada línea con su hablante", () => {
    setup();
    expect(screen.getByText("Empezamos con el plan.")).toBeInTheDocument();
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Edu").length).toBeGreaterThan(0);
  });

  it("al pulsar una línea salta a su inicio", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: /Yo envío el presupuesto/ }));
    expect(p.onSeek).toHaveBeenCalledWith(4_500);
  });

  it("marca la línea que suena", () => {
    setup({ currentMs: 5_000 });
    expect(screen.getByRole("button", { name: /Yo envío el presupuesto/ })).toHaveAttribute("aria-current", "true");
  });

  it("renombra un hablante recordando su voz", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Renombrar a Ana" }));
    const input = screen.getByRole("combobox", { name: "Nombre del hablante" });
    await userEvent.clear(input);
    await userEvent.type(input, "Luis");
    await userEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(p.onRename).toHaveBeenCalledWith(d.transcript.speakers[1]!.id, "Luis", true);
  });

  it("puede renombrar sin recordar la voz", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Renombrar a Ana" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Recordar esta voz" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(p.onRename).toHaveBeenCalledWith(d.transcript.speakers[1]!.id, "Ana", false);
  });

  it("confirma una sugerencia de nombre sin confirmar", async () => {
    const p = setup();
    expect(screen.getByText(/¿Es Ana\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar a Ana" }));
    expect(p.onRename).toHaveBeenCalledWith(d.transcript.speakers[1]!.id, "Ana", true);
  });

  it("no ofrece renombrar al propio usuario", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Renombrar a Edu" })).not.toBeInTheDocument();
  });
});
