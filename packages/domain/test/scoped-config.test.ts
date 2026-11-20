import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { scopedConfig, type ResolvedConfig } from "../src/index.ts";

/** A configuration of two applications whose design asks for three levels; what else it holds does not matter here. */
const CONFIG = {
  applications: [{ id: "policies" }, { id: "customers" }],
  design: { levels: ["smoke", "functional", "business"] },
} as unknown as ResolvedConfig;

describe("a configuration kept to the scope of a session", () => {
  it("is the whole configuration without a scope, or with empty lists", () => {
    for (const scope of [undefined, {}, { applications: [], domains: [], levels: [] }])
      assert.deepEqual(scopedConfig(CONFIG, scope), { ok: true, config: CONFIG });
  });

  it("keeps the applications and the levels the scope names, and leaves the domains to the design", () => {
    const scoped = scopedConfig(CONFIG, { applications: ["customers"], domains: ["quotes"], levels: ["business", "functional"] });
    assert.ok(scoped.ok);
    assert.deepEqual([scoped.config.applications.map(({ id }) => id), scoped.config.design.levels], [["customers"], ["functional", "business"]]);
  });

  it("says why for each application the configuration does not declare and each level it does not ask for", () => {
    assert.deepEqual(scopedConfig(CONFIG, { applications: ["billing", "policies"], levels: ["end-to-end"] }), {
      ok: false,
      errors: [
        "The application billing is not declared: the configuration declares policies, customers.",
        "The level end-to-end is not asked for: the configuration asks for smoke, functional, business.",
      ],
    });
  });
});
