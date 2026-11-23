import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ConfiguredApplication } from "@open-qa-stack/domain/sessions";
import { applicationName, nameApplications, nameIn } from "../../src/applications/application-names.ts";

/** An application of the configuration of a name. */
const configured = (id: string, name: string): ConfiguredApplication => ({ id, name, type: "web", authentication: { method: "none" }, environments: [] });

describe("the names of the applications", () => {
  it("names an application as the project names it, and by its identifier when the project does not name it", () => {
    nameApplications([
      { id: "policies", name: "Policies" },
      { id: "draft", name: "" },
    ]);
    assert.deepEqual(["policies", "draft", "gone"].map(applicationName), ["Policies", "draft", "gone"]);
    nameApplications([]);
    assert.equal(applicationName("policies"), "policies");
  });

  it("names an application of a configuration, by its identifier while it has no name or is not declared", () => {
    const applications = [configured("shop", "Shop"), configured("draft", "")];
    assert.deepEqual(
      ["shop", "draft", "gone"].map((id) => nameIn(applications, id)),
      ["Shop", "draft", "gone"],
    );
  });
});
