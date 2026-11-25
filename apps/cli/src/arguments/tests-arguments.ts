import type { Command } from "./command.ts";

/** What `oqas tests` is followed by, with the words each action takes after it. */
const TEST_ACTIONS = { verdicts: 0, read: 1, executions: 1, versions: 1, source: 1, trace: 2, capture: 3, rename: 3, step: 4 } as const;

/** A step of a test, numbered from 1. */
const STEP = /^[1-9][0-9]*$/;

/** What `oqas tests` asks for, or why it is refused: the list, or what it reads of one test, and nothing of a session. */
export function testsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, path = "", ...rest] = words;
  if (ofASession) return "oqas tests acts on the tests of the test repository: it takes no --brief, --environment nor --follow.";
  if (action === undefined) return { name: "tests", action: "list" };
  const known = Object.hasOwn(TEST_ACTIONS, action) ? (action as keyof typeof TEST_ACTIONS) : undefined;
  if (known === undefined || words.length !== TEST_ACTIONS[known] + 1)
    return "oqas tests takes nothing, verdicts, read, executions, versions or source then a test, trace then a test and a file, capture then a test, a step and a file, rename then a test, its title and its new title, or step then a test, its title, a step and its new text.";
  if (known === "verdicts") return { name: "tests", action: known };
  if (known === "rename") return { name: "tests", action: "change", path, title: rest[0]!, change: { title: rest[1]! } };
  if (known === "step") {
    const [title = "", step = "", text = ""] = rest;
    return STEP.test(step)
      ? { name: "tests", action: "change", path, title, change: { step: Number(step), text } }
      : "oqas tests step needs the number of a step, from 1.";
  }
  if (known === "trace") return { name: "tests", action: known, path, file: rest[0]! };
  if (known === "capture") {
    const [step = "", file = ""] = rest;
    return STEP.test(step) ? { name: "tests", action: known, path, step: Number(step), file } : "oqas tests capture needs the number of a step, from 1.";
  }
  return { name: "tests", action: known, path };
}
