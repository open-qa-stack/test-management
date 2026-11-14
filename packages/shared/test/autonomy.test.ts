import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsOf, validateVariant, type JsonObject } from "./helpers.ts";

const limitsOf = (autonomy: JsonObject | undefined) => {
  const result = validateVariant((c) => (autonomy === undefined ? delete c["autonomy"] : (c["autonomy"] = autonomy)));
  assert.ok(result.ok, JSON.stringify(result));
  return result.config.autonomy;
};

const only = <T>(items: readonly T[]): T => {
  assert.equal(items.length, 1, JSON.stringify(items));
  return items[0]!;
};

describe("autonomy, criterion 1 — a file without autonomy is valid, with the limits of autonomous", () => {
  it("gives the autonomous level, no limit per task and the two-hour guardrail", () => {
    const autonomous = { level: "autonomous", limits: { task: { maxIterations: null, maxMinutes: null, maxActions: null }, guardrailMinutes: 120 } };
    assert.deepEqual(limitsOf(undefined), autonomous);
    assert.deepEqual(limitsOf({ level: "autonomous" }), autonomous);
  });

  it("takes the guardrail the file gives", () => {
    assert.equal(limitsOf({ level: "autonomous", guardrailMinutes: 600 }).limits.guardrailMinutes, 600);
  });

  it("refuses a task criterion on the autonomous level", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "autonomous", task: { maxMinutes: 10 } }))));
    assert.deepEqual([e.path, e.rule], ["/autonomy/task", "unknown-key"]);
  });
});

describe("autonomy, criterion 2 — bounded with one criterion is valid, the others unbounded; bounded without one is refused at its path", () => {
  for (const [criterion, value] of [
    ["maxMinutes", 45],
    ["maxIterations", 300],
    ["maxActions", 1000],
  ] as const) {
    it(`bounds only ${criterion}, with no guardrail`, () => {
      const { level, limits } = limitsOf({ level: "bounded", task: { [criterion]: value } });
      assert.equal(level, "bounded");
      assert.deepEqual(limits, { task: { maxIterations: null, maxMinutes: null, maxActions: null, [criterion]: value }, guardrailMinutes: null });
    });
  }

  it("takes every criterion and the guardrail the file gives", () => {
    const task = { maxMinutes: 30, maxIterations: 200, maxActions: 800 };
    assert.deepEqual(limitsOf({ level: "bounded", task, guardrailMinutes: 240 }).limits, { task, guardrailMinutes: 240 });
  });

  it("refuses an empty task, and a missing one, at /autonomy/task", () => {
    const empty = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", task: {} }))));
    assert.deepEqual([empty.path, empty.rule], ["/autonomy/task", "too-few-keys"]);
    const missing = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", guardrailMinutes: 30 }))));
    assert.deepEqual([missing.path, missing.rule], ["/autonomy/task", "required"]);
  });

  for (const value of [0, -1, 2.5, "10"]) {
    it(`refuses ${JSON.stringify(value)} as a criterion or a guardrail`, () => {
      const criterion = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", task: { maxMinutes: value } }))));
      assert.equal(criterion.path, "/autonomy/task/maxMinutes");
      const guardrail = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "autonomous", guardrailMinutes: value }))));
      assert.equal(guardrail.path, "/autonomy/guardrailMinutes");
    });
  }

  it("refuses an unknown criterion", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", task: { maxMinutes: 5, maxTests: 4 } }))));
    assert.deepEqual([e.path, e.rule], ["/autonomy/task/maxTests", "unknown-key"]);
  });
});

describe("autonomy, criterion 3 — the levels of earlier versions are refused with a message that names the one to write", () => {
  for (const autonomy of [{ level: "supervised" }, { level: "custom", task: { maxIterations: 8 }, guardrailMinutes: 60 }]) {
    it(`refuses ${autonomy.level} at /autonomy/level, and names bounded and /autonomy/task`, () => {
      const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = autonomy))));
      assert.deepEqual([e.kind, e.path, e.rule], ["structure", "/autonomy/level", "retired-level"]);
      assert.match(e.message, new RegExp(`^The level "${autonomy.level}" is no longer supported: write "bounded", with its limits in /autonomy/task`));
      assert.match(e.message, /maxMinutes/);
    });
  }

  it("tells a custom level that maxDurationMinutes is now maxMinutes and that batch is gone", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "custom", task: { maxDurationMinutes: 15 }, batch: { maxTests: 20 } }))));
    assert.match(e.message, /maxDurationMinutes is now maxMinutes; batch is no longer supported/);
  });

  it("keeps the other errors of the file", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        c["autonomy"] = { level: "supervised" };
        delete c["model"];
      }),
    );
    assert.deepEqual(new Set(errors.map((e) => `${e.path} ${e.rule}`)), new Set(["/autonomy/level retired-level", "/model required"]));
  });

  it("refuses an unknown level as an unsupported value, an inherited name too, and a level that is no name", () => {
    for (const level of ["reckless", "constructor"]) {
      const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level }))));
      assert.deepEqual([e.path, e.rule], ["/autonomy/level", "unknown-variant"]);
    }
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: 3 }))));
    assert.deepEqual([e.path, e.rule], ["/autonomy/level", "required"]);
  });
});
