import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SourceManifest } from "@open-qa-stack/domain";
import type { SourceExport } from "@open-qa-stack/tools";
import { resumedGrouping } from "../src/source-workflow/resumed-grouping.ts";

describe("the grouping a run resumes from", () => {
  const element = (name: string, fingerprint: string, rest: object = {}) => ({ name, kind: "table", fingerprint, file: `export/${name}.sql`, ...rest });
  const previous = {
    domains: [{ id: "orders", label: "Orders", description: "What is ordered." }],
    elements: [
      element("orders", "1", { domain: "orders", role: "The orders." }),
      element("audit", "1", { dismissed: "Technical." }),
      element("customers", "1", { domain: "orders", role: "Who orders." }),
      element("unplaced", "1"),
    ],
  } as unknown as SourceManifest;
  const exported = {
    elements: [element("orders", "1"), element("audit", "1"), element("customers", "2"), element("unplaced", "1"), element("new", "1")],
  } as unknown as SourceExport;

  it("keeps an unchanged element where it was, and leaves a changed, new or unplaced one to be placed", () => {
    const { grouping, former } = resumedGrouping(previous, exported);
    assert.deepEqual(
      ["orders", "audit", "customers", "unplaced", "new"].map((name) => grouping.state(name)),
      [{ domain: "orders", role: "The orders." }, { dismissed: "Technical." }, undefined, undefined, undefined],
    );
    assert.deepEqual([...former], [["customers", "orders"]]);
  });

  it("starts empty without an earlier run", () => {
    const { grouping, former } = resumedGrouping(undefined, exported);
    assert.deepEqual([grouping.state("orders"), former.size], [undefined, 0]);
  });
});
