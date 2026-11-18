import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DesignPasses, PYRAMID } from "../src/designer/design-passes.ts";
import type { DesignerOptions, DesignOutcome } from "../src/designer/designer.ts";
import { PersonInbox } from "../src/index.ts";

/** What a design needs, of which the passes read the levels and whether it is resumed. */
const options = (changes: Partial<DesignerOptions>): DesignerOptions => changes as DesignerOptions;
const test = (path: string) => ({ path }) as DesignOutcome["tests"][number];
const said = (message: string) => ({ level: "info" as const, message });

describe("the passes of a design", () => {
  it("go from the base of the pyramid of tests to its top", () => {
    assert.deepEqual(PYRAMID, ["smoke", "functional", "business", "cross-application", "end-to-end"]);
  });

  it("design each level asked alone, one after the other in the order of the pyramid, and give their tests together", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const given: Record<string, DesignOutcome> = {
      smoke: { ok: true, branch: "oqas/a", statePath: "a.json", planPath: "a.plan.md", tests: [test("smoke.spec.ts")], journal: [said("smoke done")] },
      // A level that wrote nothing leaves the branch and the state of the level below as they are.
      functional: {
        ok: true,
        statePath: "b.json",
        planPath: "b.plan.md",
        tests: [],
        journal: [],
        uncovered: [{ asked: "A rule", reason: "No screen shows it." }],
      },
      business: {
        ok: false,
        branch: "oqas/c",
        statePath: "c.json",
        planPath: "c.plan.md",
        tests: [test("one.spec.ts"), test("two.spec.ts")],
        journal: [],
        uncovered: [{ asked: "A journey", reason: "It needs an account." }],
      },
    };
    // The passes are those of one run: each is given its inbox, so that what a person said during one holds in the next.
    const inbox = new PersonInbox("inbox.jsonl");
    const passes = new DesignPasses(options({ levels: ["business", "smoke", "functional"], inbox }), "by-level", false, async (pass) => {
      assert.equal(pass.inbox, inbox);
      asked.push(pass.levels);
      return given[pass.levels![0]!]!;
    });
    const outcome = await passes.run();
    assert.deepEqual(asked, [["smoke"], ["functional"], ["business"]]);
    assert.deepEqual(outcome, {
      ok: false,
      branch: "oqas/c",
      statePath: "c.json",
      planPath: "c.plan.md",
      uncovered: [
        { asked: "A rule", reason: "No screen shows it." },
        { asked: "A journey", reason: "It needs an account." },
      ],
      tests: [test("smoke.spec.ts"), test("one.spec.ts"), test("two.spec.ts")],
      journal: [said("smoke done"), said("Pass smoke: 1 test."), said("Pass functional: 0 tests."), said("Pass business: 2 tests.")],
    });
  });

  it("keep the branch and the state of the last level that wrote a test, and stop at the level a limit cut short", async () => {
    const asked: string[] = [];
    const passes = new DesignPasses(options({ levels: ["smoke", "functional", "business"] }), "by-level", false, async (pass) => {
      const level = pass.levels![0]!;
      asked.push(level);
      if (level === "smoke") return { ok: true, branch: "oqas/a", statePath: "a.json", planPath: "a.plan.md", tests: [test("smoke.spec.ts")], journal: [] };
      return { ok: false, tests: [], journal: [], stoppedBy: "duration" };
    });
    const outcome = await passes.run();
    assert.deepEqual(asked, ["smoke", "functional"]);
    assert.deepEqual([outcome.ok, outcome.branch, outcome.statePath, outcome.stoppedBy, outcome.uncovered], [false, "oqas/a", "a.json", "duration", undefined]);
  });

  it("end with a pass of visual tests alone, planned by an agent, when the design makes visual tests", async () => {
    const asked: [readonly string[] | undefined, boolean | undefined][] = [];
    const design = async (pass: DesignerOptions): Promise<DesignOutcome> => {
      asked.push([pass.levels, pass.visual]);
      return { ok: true, tests: pass.visual === true ? [test("visual.spec.ts")] : [], journal: [] };
    };
    const outcome = await new DesignPasses(options({ levels: ["functional", "smoke"] }), "by-level", true, design).run();
    assert.deepEqual(asked, [
      [["smoke"], undefined],
      [["functional"], undefined],
      [["functional"], true],
    ]);
    assert.deepEqual(outcome.journal.at(-1), said("Pass visual: 1 test."));
    // One level and the visual tests are two passes; so are a single plan of every level and the visual tests.
    asked.length = 0;
    await new DesignPasses(options({ levels: ["business"] }), "by-level", true, design).run();
    await new DesignPasses(options({ levels: ["smoke", "business"] }), "single", true, design).run();
    assert.deepEqual(asked, [
      [["business"], undefined],
      [["functional"], true],
      [["smoke", "business"], undefined],
      [["functional"], true],
    ]);
  });

  it("are one design when one level is asked, when a design is resumed, and when the configuration asks for a single plan", async () => {
    const whole: DesignOutcome = { ok: true, tests: [], journal: [] };
    const run = async (changes: Partial<DesignerOptions>, passes: "by-level" | "single" = "by-level") => {
      const asked: (readonly string[] | undefined)[] = [];
      const design = async (pass: DesignerOptions) => {
        asked.push(pass.levels);
        return whole;
      };
      assert.equal(await new DesignPasses(options(changes), passes, false, design).run(), whole);
      return asked;
    };
    assert.deepEqual(await run({ levels: ["functional"] }), [["functional"]]);
    assert.deepEqual(await run({}), [undefined]);
    assert.deepEqual(await run({ levels: ["smoke", "functional"], resume: { state: "a.json" } }), [["smoke", "functional"]]);
    assert.deepEqual(await run({ levels: ["smoke", "functional"] }, "single"), [["smoke", "functional"]]);
  });
});
