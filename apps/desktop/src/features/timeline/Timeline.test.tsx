import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TimelineEvent } from "../../api";
import { TimelineTab } from "./TimelineTab";

const events: TimelineEvent[] = [
  { at: 0, end: 50_000, kind: "topic", label: "Plan", refId: null },
  { at: 50_000, end: 100_000, kind: "topic", label: "Riesgos", refId: null },
  { at: 75_000, end: null, kind: "decision", label: "Lanzar el lunes", refId: "d1" },
  { at: 20_000, end: null, kind: "capture", label: "Diapositiva", refId: "c1" },
];

describe("TimelineTab", () => {
  it("coloca los temas proporcionalmente", () => {
    render(<TimelineTab events={events} duration={100_000} onSeek={() => {}} />);
    const risks = screen.getByRole("button", { name: /Riesgos/ });
    expect(risks.style.left).toBe("50%");
    expect(risks.style.width).toBe("50%");
  });

  it("al pulsar un evento salta a su instante", async () => {
    const onSeek = vi.fn();
    render(<TimelineTab events={events} duration={100_000} onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: /Lanzar el lunes/ }));
    expect(onSeek).toHaveBeenCalledWith(75_000);
  });

  it("sin eventos, estado vacío", () => {
    render(<TimelineTab events={[]} duration={0} onSeek={() => {}} />);
    expect(screen.getByText("No hay eventos en la línea de tiempo")).toBeInTheDocument();
  });
});
