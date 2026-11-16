import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformIcon } from "../ui/ui";
import { ActaMark } from "./ActaMark";
import { BrandLogo } from "./BrandLogo";
import { BRANDS, platformBrand } from "./brands";

describe("logotipos", () => {
  it("cada marca lleva su archivo empaquetado, nunca una URL de internet", () => {
    for (const [id, b] of Object.entries(BRANDS)) {
      expect(b.name, id).not.toBe("");
      expect(b.src, id).toBeTruthy();
      expect(b.src, id).not.toMatch(/^https?:\/\/(?!localhost)/);
    }
  });

  it("enseña el logo de la app de la reunión y lo nombra para quien no lo ve", () => {
    render(<BrandLogo brand="teams" label />);
    expect(screen.getByRole("img", { name: "Microsoft Teams" })).toBeInTheDocument();
  });

  it("al lado de su nombre el logo es decorativo", () => {
    const { container } = render(<BrandLogo brand="ollama" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("[data-brand='ollama']")).toHaveAttribute("aria-hidden", "true");
  });

  it("las reuniones usan el logo de su plataforma y un micro si no se conoce", () => {
    expect(platformBrand("meet")).toBe("meet");
    expect(platformBrand("other")).toBeNull();
    const { container } = render(
      <>
        <PlatformIcon platform="zoom" />
        <PlatformIcon platform="other" />
      </>,
    );
    expect(container.querySelector("[data-brand='zoom']")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-brand]")).toHaveLength(1);
  });

  it("la marca de acta se puede nombrar", () => {
    render(<ActaMark label="acta" />);
    expect(screen.getByRole("img", { name: "acta" })).toBeInTheDocument();
  });
});
