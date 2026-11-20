import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { i18n } from "./i18n/i18n.ts";
import "./tokens.css";
import "./base.css";
import "./ui/ui.css";
import "./shell/shell.css";
import "./agent/session.css";
import "./agent/agent-home.css";
import "./configuration/configuration.css";
import "./knowledge/knowledge.css";
import "./tests/tests.css";
import "./executions/executions.css";

// Until the instance tells the language of its configuration, the console speaks that of the browser, when it has its words.
void i18n.changeLanguage(navigator.language);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
