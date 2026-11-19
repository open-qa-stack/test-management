import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { testFacets } from "../src/index.ts";

describe("what the tags of a test tell of it", () => {
  it("is its level, domain, functionality, kind, case and data, and each application it acts on", () => {
    assert.deepEqual(
      testFacets([
        "@level-cross-application",
        "@domain-insurance-quotes",
        "@feature-quote-response",
        "@app-policy-management",
        "@app-customer-self-service",
        "@kind-functional",
        "@case-nominal",
        "@data-write",
      ]),
      {
        applications: ["policy-management", "customer-self-service"],
        level: "cross-application",
        domain: "insurance-quotes",
        feature: "quote-response",
        kind: "functional",
        case: "nominal",
        data: "write",
      },
    );
  });

  it("counts each application once and the first tag of a prefix, and leaves out a tag of another prefix or of another form", () => {
    assert.deepEqual(testFacets(["@app-shop", "@app-shop", "@level-smoke", "@level-functional", "@slow", "@priority-high", "level-business"]), {
      applications: ["shop"],
      level: "smoke",
    });
    assert.deepEqual(testFacets([]), { applications: [] });
  });
});
