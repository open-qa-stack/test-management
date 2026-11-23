import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { activityRefusal, type Application } from "../src/index.ts";
import { errorsOf, validateVariant } from "./helpers.ts";

/** An application whose environment `local` allows what it is given. */
const application = (id: string, allow?: Application["environments"][number]["allow"]): Application => ({
  id,
  name: id.toUpperCase(),
  type: "web",
  authentication: { method: "none" },
  environments: [{ name: "local", uiUrl: "http://127.0.0.1:3000", ...(allow === undefined ? {} : { allow }) }],
});

describe("what an environment allows", () => {
  it("allows writing and running tests when it says nothing, and when it says true", () => {
    assert.equal(activityRefusal([application("shop"), application("back", { design: true, run: true })], "local", "design"), undefined);
    assert.equal(activityRefusal([application("shop")], "local", "run"), undefined);
  });

  it("refuses an activity an application forbids there, naming them and what to do; another environment is not concerned", () => {
    const applications = [application("shop", { design: false }), application("back", { design: false, run: false }), application("front")];
    assert.equal(
      activityRefusal(applications, "local", "design"),
      "Writing tests is not allowed on the environment local of SHOP, BACK: allow it in the settings of that environment, or choose another one.",
    );
    assert.equal(
      activityRefusal(applications, "local", "run"),
      "Running tests is not allowed on the environment local of BACK: allow it in the settings of that environment, or choose another one.",
    );
    assert.equal(activityRefusal(applications, "staging", "run"), undefined);
  });

  it("is a set of booleans the configuration accepts, and nothing else", () => {
    const allowed = validateVariant((c) => ((c["applications"] as { environments: { allow?: unknown }[] }[])[0]!.environments[0]!.allow = { design: false }));
    assert.ok(allowed.ok, JSON.stringify(allowed));
    const wrong = errorsOf(
      validateVariant((c) => ((c["applications"] as { environments: { allow?: unknown }[] }[])[0]!.environments[0]!.allow = { design: "no", deploy: true })),
    );
    assert.deepEqual(wrong.map(({ rule }) => rule).toSorted(), ["unknown-key", "wrong-type"]);
  });
});
