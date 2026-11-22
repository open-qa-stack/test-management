import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { Session, TestVerdict } from "@open-qa-stack/domain/sessions";
import { SessionBar } from "../../src/agent/session-bar.tsx";
import { render } from "../render.ts";
import { COMPLETED } from "./session-fixture.ts";

/** The bar of a session whose tests came to the verdicts given, as HTML. */
const bar = (verdicts: readonly TestVerdict[]): string => {
  const session: Session = {
    ...COMPLETED,
    result: { ...COMPLETED.result!, tests: verdicts.map((verdict, rank) => ({ id: `t${rank}`, verdict, reason: "" })) },
  };
  return render(createElement(SessionBar, { session }));
};

describe("the bar of the result of a session", () => {
  it("is a part per verdict, as long as how many of its tests came to it, what was not run left empty", () => {
    assert.match(
      bar(["passed", "passed", "failed", "blocked", "indeterminate", "skipped", "not_run"]),
      /<span class="verdict-bar" aria-hidden="true"><span class="verdict-part passed" style="flex-grow:2"><\/span><span class="verdict-part skipped" style="flex-grow:1"><\/span><span class="verdict-part blocked" style="flex-grow:1"><\/span><span class="verdict-part indeterminate" style="flex-grow:1"><\/span><span class="verdict-part failed" style="flex-grow:1"><\/span><span class="verdict-part not_run" style="flex-grow:1"><\/span><\/span>/,
    );
  });

  it("says in words the failures, the tests blocked and those without a verdict, or, when there are none, how many passed out of how many", () => {
    assert.match(
      bar(["failed", "failed", "blocked", "indeterminate", "passed"]),
      /<span class="verdict-words failed">2 en échec<\/span><span class="verdict-words blocked">1 bloqué<\/span><span class="verdict-words indeterminate">1 indéterminé<\/span><\/span>$/,
    );
    assert.match(bar(["passed", "passed", "skipped"]), /<span class="verdict-words passed">2 \/ 3 tests réussis<\/span><\/span>$/);
  });

  it("is nothing for a session without a test yet", () => {
    assert.equal(bar([]), "");
    assert.equal(render(createElement(SessionBar, { session: { ...COMPLETED, result: undefined } as unknown as Session })), "");
  });
});
