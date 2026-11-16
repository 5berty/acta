import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "../api";
import { App } from "./App";
import "./styles.css";

// Dentro de Tauri el fondo lo pone el cristal nativo de la ventana.
if (isTauri()) document.documentElement.dataset.native = "";

// Mando de desarrollo para recorrer la UI en modo demo (no entra en producción).
if (import.meta.env.DEV && import.meta.env.VITE_ACTA_DEMO === "1") void import("../dev/remote").then((m) => m.startRemote("main"));

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
