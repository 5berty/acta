import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api, isTauri } from "../api";
import { App } from "./App";
import "./styles.css";

// Dentro de Tauri el fondo lo pone el cristal nativo de la ventana.
if (isTauri()) document.documentElement.dataset.native = "";

function mount() {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
}

// Mando de desarrollo para recorrer la UI en modo demo (no entra en producción):
// el grifo de eventos se instala antes de pintar para que vea todas las suscripciones.
if (import.meta.env.DEV && import.meta.env.VITE_ACTA_DEMO === "1") {
  void import("../dev/remote").then((m) => m.startRemote("main"));
  void import("../dev/tap").then((m) => m.installTap(api)).finally(mount);
} else mount();
