import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "../api";
import { Overlay } from "./Overlay";

// Dentro de Tauri el fondo de la cápsula es el cristal nativo del panel.
if (isTauri()) document.documentElement.dataset.native = "";

if (import.meta.env.DEV && import.meta.env.VITE_ACTA_DEMO === "1") void import("../dev/remote").then((m) => m.startRemote("overlay"));

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><Overlay /></StrictMode>);
