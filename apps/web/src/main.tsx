import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
