import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ConfigurationView } from "@open-qa-stack/domain/sessions";
import { openingOf, scopeChoicesOf } from "../../src/agent/scope-choices.ts";

/** A configuration of two applications, one of them in two environments. */
const VIEW = {
  revision: {
    document: {
      applications: [
        { id: "policies", name: "Policy Management", environments: [{ name: "local" }, { name: "staging" }] },
        { id: "customers", name: "Customer Self-Service", environments: [{ name: "local" }] },
      ],
      design: { levels: ["functional", "business"] },
    },
  },
} as unknown as ConfigurationView;

const DOMAINS = [{ id: "quotes", label: "Devis", description: "Les demandes de devis." }];

/** The fields of a form, as a browser gives them. */
function form(fields: readonly [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

describe("what a session may be kept to", () => {
  it("is the environments, the applications and the levels the configuration declares, and the domains of the knowledge", () => {
    assert.deepEqual(scopeChoicesOf(VIEW, DOMAINS), {
      environments: ["local", "staging"],
      applications: [
        { id: "policies", name: "Policy Management" },
        { id: "customers", name: "Customer Self-Service" },
      ],
      domains: DOMAINS,
      levels: ["functional", "business"],
    });
  });

  it("takes the levels a design is asked for by default when the configuration names none, and nothing without a revision", () => {
    const undesigned = { revision: { document: { applications: [] } } } as unknown as ConfigurationView;
    assert.deepEqual(scopeChoicesOf(undesigned, []).levels, ["smoke", "functional", "business"]);
    assert.deepEqual(scopeChoicesOf({}, DOMAINS), { environments: [], applications: [], domains: DOMAINS, levels: [] });
  });
});

describe("the opening the form of the entry asks for", () => {
  it("is what to test, where, and what of the project the person ticked", () => {
    assert.deepEqual(
      openingOf(
        form([
          ["request", "  couvrir les devis "],
          ["environment", "staging"],
          ["application", "policies"],
          ["domain", "quotes"],
          ["domain", "policies"],
          ["level", "business"],
        ]),
      ),
      { request: "couvrir les devis", environment: "staging", scope: { applications: ["policies"], domains: ["quotes", "policies"], levels: ["business"] } },
    );
  });

  it("is the whole project when nothing is ticked, in the environment of the project when none is chosen", () => {
    assert.deepEqual(openingOf(form([["request", "couvrir"]])), { request: "couvrir" });
    assert.deepEqual(
      openingOf(
        form([
          ["request", "couvrir"],
          ["environment", ""],
          ["level", "smoke"],
        ]),
      ),
      { request: "couvrir", scope: { levels: ["smoke"] } },
    );
  });

  it("is none for a request of spaces, or none at all, and reads a file as nothing", () => {
    assert.equal(openingOf(form([["request", "  "]])), undefined);
    assert.equal(openingOf(form([])), undefined);
    const data = form([["request", "couvrir"]]);
    data.append("domain", new Blob(["quotes"]));
    assert.deepEqual(openingOf(data), { request: "couvrir" });
  });
});
