import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the session state from the api", async () => {
    render(<App />);
    expect(await screen.findByText("Estado: idle")).toBeInTheDocument();
  });
});
