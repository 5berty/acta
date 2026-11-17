import { describe, expect, it } from "vitest";
import type { InstalledApp } from "../../api";
import { dictationApps } from "./dictationApps";
import { isBundleId } from "../../shared/ui/AppListEditor";
import { guessRule } from "./appRules";

const app = (bundleId: string, name: string): InstalledApp => ({ bundleId, name, path: `/Applications/${name}.app`, running: false, iconPath: null });

describe("apps de dictado conocidas", () => {
  it("solo sugiere las que están instaladas", () => {
    expect(dictationApps([app("com.apple.Safari", "Safari"), app("com.microsoft.teams2", "Microsoft Teams")])).toEqual([]);
    expect(dictationApps([])).toEqual([]);
  });

  it("las reconoce por su identificador, sin mirar mayúsculas", () => {
    const found = dictationApps([
      app("com.superduper.superwhisper", "superwhisper"),
      app("com.goodsnooze.macwhisper", "Whisper"),
      app("com.electron.wispr-flow", "Flow"),
      app("com.typeless.desktop", "T"),
      app("com.stablyai.orca", "O"),
    ]);
    expect(found.map((a) => a.bundleId)).toEqual(["com.typeless.desktop", "com.electron.wispr-flow", "com.superduper.superwhisper", "com.goodsnooze.macwhisper", "com.stablyai.orca"]);
  });

  it("y por su nombre si el identificador es otro", () => {
    const found = dictationApps([app("io.example.aqua", "Aqua Voice"), app("xyz.other.id", "Wispr Flow"), app("a.b.c", "MACWHISPER"), app("d.e.f", "Orca")]);
    expect(found.map((a) => a.name)).toEqual(["Wispr Flow", "MACWHISPER", "Orca", "Aqua Voice"]);
  });

  it("no confunde apps que solo se parecen", () => {
    expect(dictationApps([app("com.example.orcaslicer", "OrcaSlicer"), app("com.example.flow", "Flow"), app("com.example.aquarium", "Aquarium")])).toEqual([]);
  });

  it("no repite ni sugiere las que ya están en la lista", () => {
    const apps = [app("com.typeless.app", "Typeless"), app("com.typeless.app", "Typeless"), app("com.superduper.superwhisper", "superwhisper")];
    expect(dictationApps(apps).map((a) => a.name)).toEqual(["Typeless", "superwhisper"]);
    expect(dictationApps(apps, ["COM.typeless.app"]).map((a) => a.name)).toEqual(["superwhisper"]);
  });
});

describe("reglas de apps de reunión", () => {
  it("un navegador conocido es Google Meet en el navegador", () => {
    for (const id of ["com.google.Chrome", "com.apple.Safari", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "org.mozilla.firefox"]) {
      expect(guessRule(id)).toEqual({ bundleId: id, platform: "meet", isBrowser: true });
    }
  });

  it("reconoce Teams, Zoom y Slack; el resto es «otra»", () => {
    expect(guessRule("com.microsoft.teams2")).toMatchObject({ platform: "teams", isBrowser: false });
    expect(guessRule("us.zoom.xos")).toMatchObject({ platform: "zoom", isBrowser: false });
    expect(guessRule("com.tinyspeck.slackmacgap")).toMatchObject({ platform: "slack", isBrowser: false });
    expect(guessRule("com.hnc.Discord")).toMatchObject({ platform: "other", isBrowser: false });
    expect(guessRule("com.example.app", "Zoom Workplace")).toMatchObject({ platform: "zoom" });
  });

  it("valida la forma de un identificador de app", () => {
    expect(isBundleId("com.typeless.app")).toBe(true);
    expect(isBundleId("us.zoom.xos")).toBe(true);
    expect(isBundleId("com.electron.wispr-flow")).toBe(true);
    expect(isBundleId("Typeless")).toBe(false);
    expect(isBundleId("com.")).toBe(false);
    expect(isBundleId("com..app")).toBe(false);
    expect(isBundleId("com.example app")).toBe(false);
    expect(isBundleId("")).toBe(false);
  });
});
