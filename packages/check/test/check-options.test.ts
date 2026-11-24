import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkOptions } from "../src/check-options.ts";

describe("the arguments of the check", () => {
  it("ask by default for every step, and the tests of every package on this machine", () => {
    assert.deepEqual(checkOptions([]), { packages: { kind: "all" }, before: true, tests: { kind: "all" } });
  });

  it("name the packages to test, by a list or by a change since a revision, the last one given winning", () => {
    assert.deepEqual(checkOptions(["--packages", "apps/web"])?.packages, { kind: "named", names: "apps/web" });
    assert.deepEqual(checkOptions(["--packages", "apps/web", "--affected", "origin/main"])?.packages, { kind: "affected", since: "origin/main" });
  });

  it("keep the steps before the tests alone, or the tests alone", () => {
    assert.deepEqual(checkOptions(["--only", "static"]), { packages: { kind: "all" }, before: true, tests: undefined });
    assert.deepEqual(checkOptions(["--only", "tests"]), { packages: { kind: "all" }, before: false, tests: { kind: "all" } });
  });

  it("ask for a part of the tests, those of the packages with a test script of their own, or the merge of the parts, which are tests alone", () => {
    assert.deepEqual(checkOptions(["--part", "2/3", "--affected", "origin/main"]), {
      packages: { kind: "affected", since: "origin/main" },
      before: false,
      tests: { kind: "part", index: 2, count: 3 },
    });
    assert.deepEqual(checkOptions(["--part", "own"])?.tests, { kind: "own" });
    assert.deepEqual(checkOptions(["--part", "own:apps/api"])?.tests, { kind: "own", only: "apps/api" });
    assert.deepEqual(checkOptions(["--merge", "--only", "tests"]), { packages: { kind: "all" }, before: false, tests: { kind: "merge" } });
  });

  it("are refused when an option lacks its value, is unknown, or asks for a part that is none, or for steps without tests and a part of the tests", () => {
    for (const args of [
      ["--packages"],
      ["--everything", "x"],
      ["--only", "everything"],
      ["--part", "0/3"],
      ["--part", "4/3"],
      ["--part", "half"],
      ["--part", "own:"],
      ["--merge", "--only", "static"],
    ])
      assert.equal(checkOptions(args), undefined, args.join(" "));
  });
});
