import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DesignRounds, type BatchLimits } from "../src/designer/design-rounds.ts";
import type { DesignerOptions, DesignOutcome } from "../src/designer/designer.ts";

/** What a design needs, of which the rounds read what they change. */
const options = (changes: Partial<DesignerOptions> = {}): DesignerOptions => changes as DesignerOptions;
const test = (path: string, name = "passed") => ({ path, classes: [{ class: name }] }) as unknown as DesignOutcome["tests"][number];
const planned = (id: string) => ({ id }) as NonNullable<DesignOutcome["planned"]>[number];
const said = (message: string) => ({ level: "info" as const, message });
/** A round that gave tests, each planned under the name of its file. */
const gave = (...paths: string[]): DesignOutcome => ({ ok: true, tests: paths.map((path) => test(path)), planned: paths.map(planned), journal: [] });
const limits = (changes: Partial<BatchLimits> = {}): BatchLimits => ({ maxTests: 40, maxIdleRounds: 3, deadline: 1000, now: () => 0, ...changes });

/** Runs a batch whose rounds give what is scripted, then nothing, and tells what each round was asked. */
async function batch(script: readonly DesignOutcome[], changes: Partial<BatchLimits> = {}, start: Partial<DesignerOptions> = {}, visual?: DesignOutcome) {
  const asked: [number | undefined, number | undefined, string[], boolean | undefined][] = [];
  const left = [...script];
  const note = (pass: DesignerOptions) => asked.push([pass.round, pass.maxScenarios, pass.planned!.map((scenario) => scenario.id), pass.visual]);
  const rounds = new DesignRounds(
    options(start),
    limits(changes),
    async (pass) => {
      note(pass);
      return left.shift() ?? gave();
    },
    visual === undefined
      ? undefined
      : async (pass) => {
          note(pass);
          return visual;
        },
  );
  return { outcome: await rounds.run(), asked };
}

describe("the rounds of a design", () => {
  it("go on until three rounds in a row bring no new test, each told its number, what the batch may still write and what was planned", async () => {
    const { outcome, asked } = await batch([gave("a.spec.ts", "b.spec.ts"), gave(), gave("c.spec.ts")], {}, { planned: [planned("old")] });
    assert.deepEqual(asked, [
      [1, 40, ["old"], undefined],
      [2, 38, ["old", "a.spec.ts", "b.spec.ts"], undefined],
      // A round that brings a test starts the count of idle rounds again.
      [3, 38, ["old", "a.spec.ts", "b.spec.ts"], undefined],
      [4, 37, ["old", "a.spec.ts", "b.spec.ts", "c.spec.ts"], undefined],
      [5, 37, ["old", "a.spec.ts", "b.spec.ts", "c.spec.ts"], undefined],
      [6, 37, ["old", "a.spec.ts", "b.spec.ts", "c.spec.ts"], undefined],
    ]);
    assert.deepEqual(outcome.batch, { rounds: [2, 0, 1, 0, 0, 0], tests: 3, endedBy: "idle-rounds" });
    assert.equal(outcome.ok, true);
    assert.deepEqual(
      outcome.tests.map((kept) => kept.path),
      ["a.spec.ts", "b.spec.ts", "c.spec.ts"],
    );
    assert.deepEqual(outcome.journal.slice(0, 2), [said("Round 1: 2 new, 2 of 40 in the batch."), said("Round 2: 0 new, 2 of 40 in the batch.")]);
  });

  it("count as new a test that passed or fails because of the application, at a path no round before gave", async () => {
    const mixed: DesignOutcome = {
      ok: false,
      tests: [test("a.spec.ts"), test("b.spec.ts", "failing-application"), test("c.spec.ts", "unfinished"), test("d.spec.ts", "failing-test")],
      journal: [],
    };
    const { outcome } = await batch([mixed, gave("a.spec.ts")], { maxIdleRounds: 1 });
    assert.deepEqual(outcome.batch, { rounds: [2, 0], tests: 2, endedBy: "idle-rounds" });
    // A round that left a scenario without its test leaves the batch incomplete, whatever the rounds after it give.
    assert.equal(outcome.ok, false);
  });

  it("stop once the batch wrote the tests it may", async () => {
    const { outcome, asked } = await batch([gave("a.spec.ts"), gave("b.spec.ts", "c.spec.ts")], { maxTests: 3 });
    assert.deepEqual(
      asked.map(([round, room]) => [round, room]),
      [
        [1, 3],
        [2, 2],
      ],
    );
    assert.deepEqual(outcome.batch, { rounds: [1, 2], tests: 3, endedBy: "tests" });
  });

  it("bound no plan when the batch may write any number of tests, and end on its idle rounds alone", async () => {
    const { outcome, asked } = await batch([gave("a.spec.ts")], { maxTests: null, maxIdleRounds: 2 });
    assert.deepEqual(
      asked.map(([round, room]) => [round, room]),
      [
        [1, undefined],
        [2, undefined],
        [3, undefined],
      ],
    );
    assert.deepEqual(outcome.batch, { rounds: [1, 0, 0], tests: 1, endedBy: "idle-rounds" });
    assert.deepEqual(outcome.journal[0], said("Round 1: 1 new, 1 in the batch."));
  });

  it("start no round once the deadline passed, and keep what the rounds before gave", async () => {
    let clock = 0;
    const now = () => (clock += 400);
    const { outcome } = await batch([gave("a.spec.ts"), gave("b.spec.ts"), gave("c.spec.ts")], { now }, {}, gave("v.spec.ts"));
    // The first round is always made; the clock is read after each round that ends nothing.
    assert.deepEqual(outcome.batch, { rounds: [1, 1, 1], tests: 3, endedBy: "guardrail" });
    assert.equal(outcome.stoppedBy, undefined);
  });

  for (const [name, cut] of [
    ["a limit cut short", { stoppedBy: "duration" }],
    ["could not start", { unstarted: true }],
    ["repaired tests", { repaired: true }],
  ] as const) {
    it(`stop at a round ${name}, and make no visual test`, async () => {
      const { outcome, asked } = await batch([gave("a.spec.ts"), { ...gave(), ...cut }], {}, {}, gave("v.spec.ts"));
      assert.equal(asked.length, 2);
      assert.deepEqual(outcome.batch, { rounds: [1, 0], tests: 1, endedBy: "stopped" });
      const { stoppedBy, unstarted, repaired } = outcome;
      assert.deepEqual({ stoppedBy, unstarted, repaired }, { stoppedBy: undefined, unstarted: undefined, repaired: undefined, ...cut });
    });
  }

  it("end with one design of the visual tests, after the last round, within what the batch may still write", async () => {
    const { outcome, asked } = await batch([gave("a.spec.ts")], { maxIdleRounds: 1 }, {}, gave("v.spec.ts"));
    assert.deepEqual(asked, [
      [1, 40, [], undefined],
      [2, 39, ["a.spec.ts"], undefined],
      [3, 39, ["a.spec.ts"], true],
    ]);
    assert.deepEqual(outcome.batch, { rounds: [1, 0, 1], tests: 2, endedBy: "idle-rounds" });
    assert.deepEqual(outcome.journal.at(-1), said("Visual tests: 1 new, 2 of 40 in the batch."));
    // A batch that wrote the tests it may has no room for them, and one whose deadline passed no time.
    const full = await batch([gave("a.spec.ts")], { maxTests: 1 }, {}, gave("v.spec.ts"));
    assert.equal(full.asked.length, 1);
    let clock = 0;
    const late = await batch([], { maxIdleRounds: 1, now: () => (clock += 1200) }, {}, gave("v.spec.ts"));
    assert.deepEqual([late.asked.length, late.outcome.batch.endedBy], [1, "idle-rounds"]);
  });
});
