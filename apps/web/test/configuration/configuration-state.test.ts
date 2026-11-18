import assert from "node:assert/strict";
import type { ConfigError, ConfigurationView } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import {
  configurationAfter,
  INITIAL_CONFIGURATION,
  isChanged,
  type ConfigurationAction,
  type ConfigurationState,
} from "../../src/configuration/configuration-state.ts";
import { DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";

const ERROR: ConfigError = { kind: "structure", path: "/model/model", rule: "empty-value", message: "Expected a non-empty value." };

/** The state after the actions, from the state given. */
const after = (actions: readonly ConfigurationAction[], from: ConfigurationState = INITIAL_CONFIGURATION): ConfigurationState =>
  actions.reduce(configurationAfter, from);

/** The state once the instance told the configuration of the fixtures. */
const READ = after([{ type: "read", view: VIEW, revisions: REVISIONS }]);

describe("the state of the screen of the configuration", () => {
  it("starts with nothing told, and takes the revision in force as its draft once the instance tells it", () => {
    assert.deepEqual(INITIAL_CONFIGURATION, { errors: [], saving: false, basedOn: 0 });
    assert.deepEqual(READ, { errors: [], saving: false, basedOn: 2, view: VIEW, revisions: REVISIONS, draft: DOCUMENT });
    assert.equal(isChanged(READ), false);
    const none: ConfigurationView = { file: "changed" };
    assert.deepEqual(after([{ type: "read", view: none, revisions: [] }]), { errors: [], saving: false, basedOn: 0, view: none, revisions: [] });
  });

  it("says when the instance could not tell it, until it tells it again", () => {
    const unread = after([{ type: "unread", message: "L’instance ne répond pas." }]);
    assert.equal(unread.unread, "L’instance ne répond pas.");
    assert.equal(after([{ type: "read", view: VIEW, revisions: REVISIONS }], unread).unread, undefined);
  });

  it("applies the changes of the person to the draft, which is then changed, and keeps it when the instance tells a newer revision", () => {
    const edited = after([{ type: "edit", pointer: "/model/model", value: "other" }], READ);
    assert.equal(edited.draft!.model.model, "other");
    assert.equal(isChanged(edited), true);
    const moved: ConfigurationView = { revision: { ...VIEW.revision!, number: 3 }, file: "in_step" };
    const told = after([{ type: "read", view: moved, revisions: REVISIONS }], edited);
    assert.deepEqual([told.draft, told.basedOn, told.view], [edited.draft, 2, moved]);
    assert.equal(after([{ type: "edit", pointer: "/model/model", value: "x" }]), INITIAL_CONFIGURATION, "nothing is changed before there is a draft");
  });

  it("checks and unchecks a member of a set, from its defaults when the draft leaves the set out", () => {
    const on = after([{ type: "toggle", pointer: "/design/levels", member: "functional", on: true, defaults: [] }], READ);
    assert.deepEqual(on.draft!.design!.levels, ["smoke", "business", "functional"]);
    const off = after([{ type: "toggle", pointer: "/model/capabilities", member: "vision", on: false, defaults: [] }], READ);
    assert.deepEqual(off.draft!.model.capabilities, []);
    const fromDefaults = after([{ type: "toggle", pointer: "/cartography/levels", member: "a", on: false, defaults: ["a", "b"] }], READ);
    assert.deepEqual((fromDefaults.draft as unknown as { cartography: { levels: string[] } }).cartography.levels, ["b"]);
  });

  it("chooses a level of autonomy with the guardrail it had, a bounded one bounded by thirty minutes a task", () => {
    assert.deepEqual(after([{ type: "level", level: "autonomous" }], READ).draft!.autonomy, { level: "autonomous", guardrailMinutes: 60 });
    const unguarded = after(
      [
        { type: "edit", pointer: "/autonomy", value: undefined },
        { type: "level", level: "bounded" },
      ],
      READ,
    );
    assert.deepEqual(unguarded.draft!.autonomy, { level: "bounded", task: { maxMinutes: 30 } });
  });

  it("adds and removes the items of a list", () => {
    const added = after([{ type: "add", pointer: "/applications/0/environments", item: { name: "qa" } }], READ);
    assert.deepEqual(added.draft!.applications[0]!.environments.at(-1), { name: "qa" });
    assert.deepEqual(after([{ type: "remove", pointer: "/applications/0/environments/0" }], added).draft!.applications[0]!.environments, [{ name: "qa" }]);
  });

  it("drops the draft for the revision in force, with what the instance found in it, and has none to drop to before it told one", () => {
    const dropped = after(
      [{ type: "edit", pointer: "/model/model", value: "other" }, { type: "checked", draft: READ.draft!, errors: [ERROR] }, { type: "discard" }],
      READ,
    );
    assert.deepEqual([dropped.draft, dropped.errors, dropped.basedOn, isChanged(dropped)], [DOCUMENT, [], 2, false]);
    assert.deepEqual(after([{ type: "discard" }]), INITIAL_CONFIGURATION);
  });

  it("keeps what the instance found in the draft it checked, and not in one changed since", () => {
    const edited = after([{ type: "edit", pointer: "/model/model", value: "" }], READ);
    assert.deepEqual(after([{ type: "checked", draft: edited.draft!, errors: [ERROR] }], edited).errors, [ERROR]);
    assert.deepEqual(after([{ type: "checked", draft: DOCUMENT, errors: [ERROR] }], edited).errors, []);
  });

  it("saves: the revision the instance took becomes the draft, said saved, and the revisions are listed again", () => {
    const edited = after([{ type: "edit", pointer: "/model/model", value: "other" }, { type: "saving" }], READ);
    assert.equal(edited.saving, true);
    const document = edited.draft!;
    const view: ConfigurationView = {
      revision: { number: 3, recordedAt: "2026-11-18T10:00:00.000Z", origin: "console", fileDigest: "c3", document },
      file: "in_step",
    };
    const saved = after([{ type: "saved", view }], edited);
    assert.deepEqual([saved.saving, saved.saved, saved.basedOn, saved.draft, isChanged(saved)], [false, 3, 3, document, false]);
    const listed = after([{ type: "listed", revisions: [] }], saved);
    assert.deepEqual(listed.revisions, []);
    assert.equal(after([{ type: "edit", pointer: "/model/model", value: "again" }], saved).saved, undefined, "a new change is not said saved");
    const none = after([{ type: "saved", view: { file: "missing" } }], edited);
    assert.deepEqual([none.saving, none.saved, none.draft], [false, undefined, document]);
  });

  it("says why the instance refused, with the errors it found, keeping those it had when it gives none, and forgets it at the next request", () => {
    const checked = after([{ type: "edit", pointer: "/model/model", value: "" }], READ);
    const withErrors = after([{ type: "checked", draft: checked.draft!, errors: [ERROR] }, { type: "saving" }], checked);
    const refused = after([{ type: "refused", code: "invalid_configuration", text: "Non valide.", errors: [] }], withErrors);
    assert.deepEqual([refused.saving, refused.refusal, refused.errors], [false, { code: "invalid_configuration", text: "Non valide." }, [ERROR]]);
    const other: ConfigError = { ...ERROR, path: "/model/baseUrl" };
    assert.deepEqual(after([{ type: "refused", code: "invalid_configuration", text: "Non valide.", errors: [other] }], withErrors).errors, [other]);
    assert.equal(after([{ type: "saving" }], refused).refusal, undefined);
  });
});
