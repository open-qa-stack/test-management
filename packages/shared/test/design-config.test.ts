import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsOf, validateVariant } from "./helpers.ts";

/** How the tests are built, when the configuration does not say. */
const BUILT = { architecture: "page-objects", fixturesFile: "apps/shared/fixtures.ts", visualTests: true, visualTolerance: 0.01 };

describe("the review of a plan for duplicates is read from the configuration", () => {
  it("is asked when absent, and as given otherwise", () => {
    const absent = validateVariant(() => undefined);
    assert.ok(absent.ok);
    assert.deepEqual(absent.config.design, { reviewPlan: true, reviewTests: true, reviewCode: true, levels: ["smoke", "functional", "business"], ...BUILT });
    const given = validateVariant((config) => (config["design"] = { reviewPlan: false }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.design, { reviewPlan: false, reviewTests: true, reviewCode: true, levels: ["smoke", "functional", "business"], ...BUILT });
  });

  it("refuses a value that is no boolean, and a key it does not know, with their JSON paths", () => {
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewPlan: "yes" }))).some((error) => error.path === "/design/reviewPlan"));
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewEverything: true }))).some((error) => error.path.startsWith("/design")));
  });
});

describe("the levels of the pyramid of tests asked are read from the configuration", () => {
  it("are those given, and refuses a level it does not know, none at all, and one given twice", () => {
    const given = validateVariant((config) => (config["design"] = { levels: ["functional", "end-to-end"] }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.design.levels, ["functional", "end-to-end"]);
    for (const levels of [["unit"], [], ["smoke", "smoke"]])
      assert.ok(
        errorsOf(validateVariant((config) => (config["design"] = { levels }))).some((error) => error.path.startsWith("/design/levels")),
        JSON.stringify(levels),
      );
  });
});

describe("how the tests are built is read from the configuration", () => {
  it("is as given, with the fixtures in the folder of the applications unless their file is named", () => {
    const moved = validateVariant((config) => {
      config["repository"] = { appsDir: "tests" };
      config["design"] = { architecture: "fixtures" };
    });
    assert.ok(moved.ok);
    assert.deepEqual([moved.config.design.architecture, moved.config.design.fixturesFile], ["fixtures", "tests/shared/fixtures.ts"]);
    const named = validateVariant((config) => (config["design"] = { architecture: "standalone", fixturesFile: "support/test.ts" }));
    assert.ok(named.ok);
    assert.deepEqual([named.config.design.architecture, named.config.design.fixturesFile], ["standalone", "support/test.ts"]);
  });

  it("refuses an architecture it does not know, and a path that is none", () => {
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { architecture: "pom" }))).some((error) => error.path === "/design/architecture"));
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { fixturesFile: "" }))).some((error) => error.path === "/design/fixturesFile"));
  });
});

describe("the visual tests are read from the configuration", () => {
  it("are as given, and refuses a tolerance that is no share", () => {
    const given = validateVariant((config) => (config["design"] = { visualTests: false, visualTolerance: 0.05 }));
    assert.ok(given.ok);
    assert.deepEqual([given.config.design.visualTests, given.config.design.visualTolerance], [false, 0.05]);
    for (const visualTolerance of [-0.1, 2, "low"])
      assert.ok(
        errorsOf(validateVariant((config) => (config["design"] = { visualTolerance }))).some((error) => error.path === "/design/visualTolerance"),
        String(visualTolerance),
      );
  });
});
