import assert from "node:assert/strict";
import type { Session, SessionResult } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { scopeText, stateOf, waitText } from "../../src/agent/session-facts.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { COMPLETED, QUEUED, RUNNING } from "./session-fixture.ts";

/**
 * The session of the fixtures, completed with a result of its own.
 *
 * @param changes - What differs from the result of the fixtures.
 * @returns The session.
 */
const endedWith = (changes: Partial<SessionResult>): Session => ({ ...COMPLETED, result: { ...COMPLETED.result!, ...changes } });

/** A session completed whose result the API has not told. */
const UNTOLD: Session = { ...RUNNING, state: "completed" };

describe("the state of a session", () => {
  it("reads as queued while it waits its turn, in a tone that is neither the one of success nor the one of live", () => {
    assert.deepEqual(stateOf(QUEUED), { tone: "outline", label: "En file" });
  });

  it("reads as live while its agents work, as interrupted when it stopped", () => {
    assert.deepEqual(stateOf(RUNNING), { tone: "info", label: "En direct" });
    assert.deepEqual(stateOf({ ...COMPLETED, state: "interrupted" }), { tone: "warn", label: "Interrompue" });
  });

  it("reads as how the session ended once it is completed", () => {
    assert.deepEqual(stateOf(COMPLETED), { tone: "ok", label: "Réussi" });
    assert.deepEqual(stateOf(endedWith({ outcome: "failed" })), { tone: "ko", label: "Échoué" });
    assert.deepEqual(stateOf(endedWith({ outcome: "inconclusive" })), { tone: "warn", label: "Indéterminé" });
    assert.deepEqual(stateOf(endedWith({ outcome: "stopped" })), { tone: "neutral", label: "Arrêté" });
  });

  it("reads as ended, no more, when a completed session has no result", () => {
    assert.deepEqual(stateOf(UNTOLD), { tone: "neutral", label: "Terminée" });
  });

  it("reads as ended, no more, when the API tells a state or a way of ending this console does not know", () => {
    assert.deepEqual(stateOf({ ...RUNNING, state: "archived" as Session["state"] }), { tone: "neutral", label: "Terminée" });
    assert.deepEqual(stateOf(endedWith({ outcome: "abandoned" as SessionResult["outcome"] })), { tone: "neutral", label: "Terminée" });
    assert.deepEqual(stateOf({ ...COMPLETED, state: "archived" as Session["state"] }), { tone: "ok", label: "Réussi" });
  });
});

describe("what a session waits for", () => {
  it("is an agent while it is queued, and nothing in any other state", () => {
    assert.equal(waitText(QUEUED), "en attente d’un agent");
    assert.deepEqual([RUNNING, COMPLETED, { ...RUNNING, state: "archived" as Session["state"] }].map(waitText), [undefined, undefined, undefined]);
  });
});

describe("the scope of a session, in a few words", () => {
  it("names its applications by their names, its domains and its levels, and nothing for a session of the whole project", () => {
    nameApplications([{ id: "policies", name: "Policies" }]);
    assert.equal(
      scopeText({ ...COMPLETED, scope: { applications: ["policies"], domains: ["quotes"], levels: ["business", "smoke"] } }),
      "limitée à Policies, quotes, Parcours métier, Vérification rapide",
    );
    assert.equal(scopeText({ ...COMPLETED, scope: {} }), undefined);
    assert.equal(scopeText(COMPLETED), undefined);
    nameApplications([]);
  });
});
