import assert from "node:assert/strict";
import { describe, it } from "vitest";
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

describe("autonomy, criterion 1 — a file without autonomy is valid, with the limits of the bounded level by default", () => {
  it("gives the bounded level, ten minutes per task, forty tests per batch and the two-hour guardrail; the autonomous level no limit per task nor per batch, and the same guardrail", () => {
    assert.deepEqual(limitsOf(undefined), {
      level: "bounded",
      limits: { task: { maxIterations: null, maxMinutes: 10, maxActions: null }, batch: { maxTests: 40, maxIdleRounds: 3 }, guardrailMinutes: 120 },
    });
    assert.deepEqual(limitsOf({ level: "autonomous" }), {
      level: "autonomous",
      limits: { task: { maxIterations: null, maxMinutes: null, maxActions: null }, batch: { maxTests: null, maxIdleRounds: 3 }, guardrailMinutes: 120 },
    });
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
    it(`bounds only ${criterion}, with the two-hour guardrail`, () => {
      const { level, limits } = limitsOf({ level: "bounded", task: { [criterion]: value } });
      assert.equal(level, "bounded");
      assert.deepEqual(limits, {
        task: { maxIterations: null, maxMinutes: null, maxActions: null, [criterion]: value },
        batch: { maxTests: 40, maxIdleRounds: 3 },
        guardrailMinutes: 120,
      });
    });
  }

  it("takes every criterion, the limits of the batch and the guardrail the file gives", () => {
    const task = { maxMinutes: 30, maxIterations: 200, maxActions: 800 };
    const batch = { maxTests: 12, maxIdleRounds: 1 };
    assert.deepEqual(limitsOf({ level: "bounded", task, batch, guardrailMinutes: 240 }).limits, { task, batch, guardrailMinutes: 240 });
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

describe("autonomy — a bounded level sets what ends a batch, each limit with its default", () => {
  const task = { maxMinutes: 10 };

  it("keeps the default of the limit the file leaves out, an empty batch too", () => {
    assert.deepEqual(limitsOf({ level: "bounded", task, batch: { maxTests: 5 } }).limits.batch, { maxTests: 5, maxIdleRounds: 3 });
    assert.deepEqual(limitsOf({ level: "bounded", task, batch: { maxIdleRounds: 2 } }).limits.batch, { maxTests: 40, maxIdleRounds: 2 });
    assert.deepEqual(limitsOf({ level: "bounded", task, batch: {} }).limits.batch, { maxTests: 40, maxIdleRounds: 3 });
  });

  it("refuses a batch on the autonomous level, and an unknown limit", () => {
    const autonomous = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "autonomous", batch: { maxTests: 5 } }))));
    assert.deepEqual([autonomous.path, autonomous.rule], ["/autonomy/batch", "unknown-key"]);
    const unknown = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", task, batch: { maxRounds: 5 } }))));
    assert.deepEqual([unknown.path, unknown.rule], ["/autonomy/batch/maxRounds", "unknown-key"]);
  });

  for (const value of [0, -1, 2.5, "10"]) {
    it(`refuses ${JSON.stringify(value)} as a limit of the batch`, () => {
      for (const limit of ["maxTests", "maxIdleRounds"]) {
        const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "bounded", task, batch: { [limit]: value } }))));
        assert.equal(e.path, `/autonomy/batch/${limit}`);
      }
    });
  }
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

  it("tells a custom level that maxDurationMinutes is now maxMinutes and where the limits of its batch go", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "custom", task: { maxDurationMinutes: 15 }, batch: { maxTests: 20 } }))));
    assert.match(e.message, /maxDurationMinutes is now maxMinutes, and those of its batch in \/autonomy\/batch/);
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
