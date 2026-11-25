import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ExecutionResult, TestExecution } from "@open-qa-stack/domain/sessions";
import { WhatToDo } from "../../src/tests/what-to-do.tsx";
import { at, linksOf, render, textOf } from "../render.ts";
import { DETAIL } from "./tests-fixture.ts";

const RESULT: ExecutionResult = { path: DETAIL.path, title: DETAIL.title, project: "policy-management", verdict: "failed", durationMs: 1 };

/** The card for the latest execution of a test, as HTML. */
const card = (result: ExecutionResult | undefined): string => {
  const latest: TestExecution | undefined = result === undefined ? undefined : { id: "e1", origin: "manual", ranAt: "2026-11-19T10:00:00.000Z", result };
  return render(createElement(WhatToDo, { path: DETAIL.path, latest }));
};

describe("what to do with a test that failed", () => {
  it("is to ask the agent, with the request written", () => {
    const html = card({ ...RESULT, failure: { step: { number: 2, title: "Read its amounts" } } });
    assert.match(textOf(html), /^Que faire \? Étape 2 · Read its amounts Lisez d’abord le résultat/);
    const [ask] = linksOf(html);
    assert.match(
      at(ask!).query["request"]!,
      /^Le test « Display the detail of a policy » \(apps\/.*\) échoue à l’étape 2 \(Read its amounts\)\. Cherche pourquoi\./,
    );
    assert.match(at(linksOf(card(RESULT))[0]!).query["request"]!, /spec\.ts\) échoue\. Cherche/);
  });

  it("is nothing for a test that passed, or never ran", () => {
    assert.equal(card({ ...RESULT, verdict: "passed" }), "");
    assert.equal(card(undefined), "");
  });
});
