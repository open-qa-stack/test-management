import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./tokens.css";
import "./base.css";
import "./ui/ui.css";
import "./shell/shell.css";
import "./agent/session.css";
import "./agent/agent-home.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
