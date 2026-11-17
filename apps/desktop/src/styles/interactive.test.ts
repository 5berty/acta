import { describe, expect, it } from "vitest";
import css from "./interactive.css?raw";
import mainCss from "../app/styles.css?raw";
import overlaySource from "../features/overlay/OverlayContainer.tsx?raw";

describe("interactive cursor", () => {
  it("gives every clickable control the pointer cursor", () => {
    for (const selector of [
      "button:not(:disabled)",
      '[role="button"]',
      '[role="tab"]',
      '[role="option"]',
      '[role="menuitem"]',
      '[role="switch"]',
      "a[href]",
      "summary",
      "select:not(:disabled)",
      'input[type="checkbox"]:not(:disabled)',
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/cursor:\s*pointer/);
  });

  it("marks disabled controls as not allowed", () => {
    expect(css).toMatch(/:disabled[\s\S]*cursor:\s*not-allowed/);
  });

  it("is loaded last in the main window and in the overlay", () => {
    const lines = mainCss.trim().split("\n");
    expect(lines[lines.length - 1]).toContain("interactive.css");
    expect(overlaySource).toContain("styles/interactive.css");
  });
});
