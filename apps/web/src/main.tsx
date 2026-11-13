import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell.tsx";
import "./tokens.css";
import "./base.css";
import "./shell.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
