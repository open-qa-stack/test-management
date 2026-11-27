import type { MemoryItem, MemoryList } from "@open-qa-stack/domain/sessions";

/** An instruction a person gave, kept to an application, for the design. */
export const INSTRUCTION: MemoryItem = {
  id: "l1",
  type: "instruction",
  text: "Create the customers by the API, never by the screens.",
  application: "policy-management",
  target: "design",
  active: true,
  at: "2026-11-27T10:00:00.000Z",
};

/** A correction kept as a lesson, for the whole project, set aside. */
export const CORRECTION: MemoryItem = {
  id: "l2",
  type: "correction",
  text: "Use the policy of Max Mustermann as reference data.",
  target: "all",
  active: false,
  at: "2026-11-27T09:00:00.000Z",
};

/** What an agent noted while it worked. */
export const INFERRED: MemoryItem = {
  id: "m1",
  type: "inferred",
  text: "The quote screens bear data-testid in quote-*.",
  target: "all",
  active: true,
  at: "2026-11-26T08:00:00.000Z",
  filed: { domain: "quotes", kind: "locator", role: "cartographer" },
};

/** The memory of the fixtures. */
export const MEMORY: MemoryList = { items: [INSTRUCTION, CORRECTION, INFERRED], counts: { active: 2, inactive: 1 } };
