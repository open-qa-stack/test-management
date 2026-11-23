import assert from "node:assert/strict";
import type { ConfigError, ConfigurationView, Knowledge } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import {
  configurationAfter,
  INITIAL_CONFIGURATION,
  isChanged,
  isPending,
  shownErrors,
  typedConnection,
  typedKey,
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
    assert.deepEqual(INITIAL_CONFIGURATION, { errors: [], saving: false, basedOn: 0, values: {} });
    assert.deepEqual(READ, { errors: [], saving: false, basedOn: 2, view: VIEW, revisions: REVISIONS, draft: DOCUMENT, values: {} });
    assert.equal(isChanged(READ), false);
    const none: ConfigurationView = { file: "changed" };
    assert.deepEqual(after([{ type: "read", view: none, revisions: [] }]), { errors: [], saving: false, basedOn: 0, view: none, revisions: [], values: {} });
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

  it("shows the errors of what the person changed alone, every error once they asked to save, and none of those again once saved or dropped", () => {
    const errors: ConfigError[] = [
      { kind: "structure", path: "/knowledge/8/id", rule: "slug", message: "…" },
      { kind: "structure", path: "/model/model", rule: "empty-value", message: "…" },
      { kind: "structure", path: "/applications/0/environments", rule: "too-few-items", message: "…" },
      { kind: "structure", path: "/autonomy/level", rule: "unknown-variant", message: "…" },
    ];
    const checked = (state: ConfigurationState): ConfigurationState => configurationAfter(state, { type: "checked", draft: state.draft!, errors });
    const added = checked(after([{ type: "add", pointer: "/knowledge", item: { id: "", type: "openapi", url: "" } }], READ));
    assert.deepEqual(shownErrors(added), [], "an item added is not shown wrong before it is filled");
    const changed = checked(
      after(
        [
          { type: "edit", pointer: "/model", value: { ...DOCUMENT.model, model: undefined } },
          { type: "remove", pointer: "/applications/0/environments/0" },
          { type: "level", level: "bounded" },
        ],
        added,
      ),
    );
    assert.deepEqual(shownErrors(changed), errors.slice(1));
    const tried = configurationAfter(changed, { type: "saving" });
    assert.deepEqual(shownErrors(tried), errors);
    for (const settled of [configurationAfter(tried, { type: "saved", view: VIEW }), configurationAfter(tried, { type: "discard" })])
      assert.deepEqual([settled.touched, settled.tried], [undefined, undefined]);
  });

  it("checks and unchecks a member of a set, from its defaults when the draft leaves the set out", () => {
    const on = after([{ type: "toggle", pointer: "/design/levels", member: "functional", on: true, defaults: [] }], READ);
    assert.deepEqual(on.draft!.design!.levels, ["smoke", "business", "functional"]);
    const off = after([{ type: "toggle", pointer: "/model/capabilities", member: "vision", on: false, defaults: [] }], READ);
    assert.deepEqual(off.draft!.model.capabilities, []);
    const fromDefaults = after([{ type: "toggle", pointer: "/cartography/levels", member: "a", on: false, defaults: ["a", "b"] }], READ);
    assert.deepEqual((fromDefaults.draft as unknown as { cartography: { levels: string[] } }).cartography.levels, ["b"]);
  });

  it("chooses a level of autonomy with the guardrail it had, a bounded one bounded by ten minutes a task", () => {
    assert.deepEqual(after([{ type: "level", level: "autonomous" }], READ).draft!.autonomy, { level: "autonomous", guardrailMinutes: 60 });
    const unguarded = after(
      [
        { type: "edit", pointer: "/autonomy", value: undefined },
        { type: "level", level: "bounded" },
      ],
      READ,
    );
    assert.deepEqual(unguarded.draft!.autonomy, { level: "bounded", task: { maxMinutes: 10 } });
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

  it("starts the model again when the person chooses another connection, and forgets the test of the one before", () => {
    const tested = after([{ type: "testing", model: DOCUMENT.model }], READ);
    const chosen = after([{ type: "connection", choice: "github" }], tested);
    assert.deepEqual(chosen.draft!.model, { mode: "github", model: "" });
    assert.equal(chosen.connection, undefined);
    assert.deepEqual(after([{ type: "connection", choice: "github" }], INITIAL_CONFIGURATION), INITIAL_CONFIGURATION);
  });

  it("keeps the test of the connection asked last: what it found, or why it could not be made", () => {
    const model = DOCUMENT.model;
    const testing = after([{ type: "testing", model }], READ);
    assert.deepEqual(testing.connection, { model });
    const found = after([{ type: "tested", model, check: { state: "connected" } }], testing);
    assert.deepEqual(found.connection, { model, check: { state: "connected" } });
    const failed = after([{ type: "tested", model, failure: "Down." }], testing);
    assert.deepEqual(failed.connection, { model, failure: "Down." });
    const other = { ...model, model: "other" };
    assert.equal(after([{ type: "tested", model: other, check: { state: "connected" } }], testing), testing);
  });

  it("keeps the values typed apart from the draft, saves them with it, and drops them with it", () => {
    const secret = { name: "MODEL_KEY", kind: "model_key", paths: ["/model/apiKeyEnv"], source: "missing" } as const;
    const told = after([{ type: "secrets", secrets: [secret] }], READ);
    assert.deepEqual(told.secrets, [secret]);
    const typed = after(
      [
        { type: "value", name: "MODEL_KEY", value: "k" },
        { type: "value", name: "DB_URL", value: "postgres://" },
      ],
      told,
    );
    assert.deepEqual(typed.values, { MODEL_KEY: "k", DB_URL: "postgres://" });
    assert.equal(isChanged(typed), false);
    assert.equal(isPending(typed), true);
    assert.equal(isPending(READ), false);
    assert.deepEqual(after([{ type: "value", name: "DB_URL", value: "" }], typed).values, { MODEL_KEY: "k" });
    const valued = after([{ type: "saving" }, { type: "valued", secrets: [{ ...secret, source: "saved" }] }], typed);
    assert.deepEqual(
      { values: valued.values, saving: valued.saving, valued: valued.valued, secrets: valued.secrets },
      {
        values: {},
        saving: false,
        valued: true,
        secrets: [{ ...secret, source: "saved" }],
      },
    );
    assert.equal(after([{ type: "saving" }], valued).valued, undefined);
    assert.equal(after([{ type: "value", name: "MODEL_KEY", value: "other" }], valued).valued, undefined);
    assert.deepEqual(after([{ type: "discard" }], typed).values, {});
  });

  it("finds the key typed for the variable of the model, and none for a connection without one", () => {
    const provider = { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "m", apiKeyEnv: "MODEL_KEY" } as const;
    assert.equal(typedKey(provider, { MODEL_KEY: "k" }), "k");
    assert.equal(typedKey(provider, {}), undefined);
    const { apiKeyEnv: _, ...keyless } = provider;
    assert.equal(typedKey(keyless, { MODEL_KEY: "k" }), undefined);
    assert.equal(typedKey({ mode: "github", model: "m" }, { MODEL_KEY: "k" }), undefined);
  });

  it("keeps the latest test of each source, and drops an answer to a test of a source since changed", () => {
    const source = READ.draft!.knowledge[0]!;
    const checking = after([{ type: "sourceChecking", rank: 0, source }], READ);
    assert.deepEqual(checking.sourceChecks, { 0: { source } });
    const answered = after([{ type: "sourceChecked", rank: 0, source, check: { state: "ok", items: 3 } }], checking);
    assert.deepEqual(answered.sourceChecks, { 0: { source, check: { state: "ok", items: 3 } } });
    assert.deepEqual(after([{ type: "sourceChecked", rank: 0, source, failure: "Down." }], checking).sourceChecks, { 0: { source, failure: "Down." } });
    const other = { ...source, id: "other" };
    assert.equal(after([{ type: "sourceChecked", rank: 0, source: other, check: { state: "unchecked" } }], checking), checking);
    assert.equal(after([{ type: "sourceChecked", rank: 1, source, check: { state: "unchecked" } }], checking), checking);
  });

  it("keeps the latest test of each address by its field, and drops an answer to a test of an address since changed", () => {
    const pointer = "/applications/0/environments/0/uiUrl";
    const checking = after([{ type: "addressChecking", pointer, address: "http://a.test/" }], READ);
    assert.deepEqual(checking.addressChecks, { [pointer]: { address: "http://a.test/" } });
    const check = { state: "answers", url: "http://a.test/", status: 200 } as const;
    assert.deepEqual(after([{ type: "addressChecked", pointer, address: "http://a.test/", check }], checking).addressChecks, {
      [pointer]: { address: "http://a.test/", check },
    });
    assert.deepEqual(after([{ type: "addressChecked", pointer, address: "http://a.test/", failure: "Down." }], checking).addressChecks, {
      [pointer]: { address: "http://a.test/", failure: "Down." },
    });
    assert.equal(after([{ type: "addressChecked", pointer, address: "http://b.test/", check }], checking), checking);
    assert.equal(after([{ type: "addressChecked", pointer: "/other", address: "http://a.test/", check }], checking), checking);
  });

  it("finds the connection string typed for a database, and none for another source", () => {
    const database: Knowledge = { id: "orders", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [] };
    assert.equal(typedConnection(database, { SHOP_DB_URL: "postgres://typed" }), "postgres://typed");
    assert.equal(typedConnection(database, {}), undefined);
    assert.equal(typedConnection({ id: "docs", type: "document", path: "docs", attachments: [] }, { SHOP_DB_URL: "postgres://typed" }), undefined);
  });
});
