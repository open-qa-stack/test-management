import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defectMovesFrom, defectRefusalOf, type DefectStatus } from "../src/index.ts";

const STATUSES: readonly DefectStatus[] = ["open", "fixed", "closed"];

describe("the life of a defect", () => {
  it("fixes or closes a defect open, closes or opens again one fixed, and only opens again one closed", () => {
    assert.deepEqual(Object.fromEntries(STATUSES.map((status) => [status, defectMovesFrom(status)])), {
      open: ["fixed", "closed"],
      fixed: ["closed", "open"],
      closed: ["open"],
    });
  });

  it("takes every move the life allows, and a defect left where it stands; refuses the others with where it can go", () => {
    const refused = STATUSES.flatMap((from) =>
      STATUSES.flatMap((to) => {
        const why = defectRefusalOf("D-1", from, to);
        return why === undefined ? [] : [[from, to, why]];
      }),
    );
    assert.deepEqual(refused, [["closed", "fixed", "The defect D-1 is closed: from there it can be open."]]);
  });
});
