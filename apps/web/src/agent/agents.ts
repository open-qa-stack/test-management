import type { IconName } from "../ui/icon.tsx";
import type { Speaker } from "@open-qa-stack/domain/sessions";

/** How the console shows who speaks: a name, a role, an icon and a colour family. */
export interface Identity {
  /** The name shown beside what it says. */
  readonly name: string;
  /** What it is there for, in a few words. */
  readonly role: string;
  readonly icon: IconName;
  /** The colour family of its mark. */
  readonly tone: "primary" | "ai" | "ok" | "warn" | "neutral";
}

/** The identity of everyone a session shows. */
export const IDENTITIES: Readonly<Record<Speaker, Identity>> = {
  user: { name: "Vous", role: "Responsable QA", icon: "home", tone: "primary" },
  cartographer: { name: "Cartographe", role: "inventorie les sources et les range par domaine", icon: "discovery", tone: "ai" },
  planner: { name: "Planificateur", role: "explore l’application et propose le plan", icon: "layers", tone: "ai" },
  writer: { name: "Rédacteur", role: "écrit et joue les tests Playwright", icon: "pen", tone: "primary" },
  plan_reviewer: { name: "Relecteur du plan", role: "cherche les doublons avec l’existant", icon: "copy", tone: "warn" },
  coherence_reviewer: { name: "Relecteur de cohérence", role: "compare chaque test à son scénario", icon: "eye", tone: "ok" },
  code_reviewer: { name: "Relecteur de code", role: "juge la qualité du code Playwright", icon: "code", tone: "ok" },
  harness: { name: "Harnais", role: "accepte sur preuve, refuse le reste", icon: "shield", tone: "neutral" },
};

/** Everyone but the person, in the order they come into a session. */
export const AGENTS: readonly Speaker[] = ["cartographer", "planner", "plan_reviewer", "writer", "coherence_reviewer", "code_reviewer", "harness"];
