import type { ScriptWording } from "@open-qa-stack/domain/sessions";
import { t, type Words } from "../i18n/i18n.ts";
import { toolTitle } from "./tool-title.ts";

/** The phases the terminal words; a later version of the contract may name another. */
const PHASES = new Set([
  "configuration",
  "prerequisites",
  "survey",
  "card",
  "consolidation",
  "knowledge-base",
  "plan",
  "review",
  "write",
  "execution",
  "summary",
]);

/**
 * The words of the terminal for what a thread tells, in the language of the conversation; a phase it does not
 * know reads as a step of the work, without more.
 *
 * @returns The wording.
 */
export function wording(): ScriptWording {
  return {
    phase: (phase) => (PHASES.has(phase) ? t(`steps.phases.${phase as keyof Words["steps"]["phases"]}`) : t("steps.step")),
    // The terminal names the levels by their tags, as its plans and its scope do.
    level: (level) => level,
    tool: toolTitle,
    planAccepted: t("steps.planAccepted"),
    scope: t("steps.scope"),
    interrupted: t("steps.interrupted"),
    verdicts: (tests) => t("steps.verdicts", { count: tests }),
    closed: (scenarios) => t("steps.closed", { count: scenarios }),
    opened: (day, time) => t("steps.opened", { day, time }),
  };
}
