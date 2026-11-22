import assert from "node:assert/strict";
import type { OqasConfig } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationAction, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { NEW_ITEMS } from "../../src/configuration/configuration-edit.ts";
import { slugOf, variableOf } from "../../src/configuration/derived-names.ts";
import { DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";

/** The draft after the actions, from the configuration of the fixtures in force. */
const draftAfter = (actions: readonly ConfigurationAction[]): OqasConfig =>
  [{ type: "read", view: VIEW, revisions: REVISIONS } as const, ...actions].reduce<ConfigurationState>(configurationAfter, INITIAL_CONFIGURATION).draft!;

describe("the names made of others", () => {
  it("make an identifier of a name, and the name of a variable of parts", () => {
    assert.equal(slugOf("  Policy Management — Back-office ! "), "policy-management-back-office");
    assert.equal(slugOf("Été"), "ete");
    assert.equal(variableOf("policy-management", "db", "url"), "POLICY_MANAGEMENT_DB_URL");
    assert.equal(variableOf("", "Clerk 2", "password"), "CLERK_2_PASSWORD");
  });

  it("give an application added the identifier of its name while the person did not set it", () => {
    const added = { type: "add", pointer: "/applications", item: NEW_ITEMS.application } as const;
    const named = draftAfter([added, { type: "edit", pointer: "/applications/1/name", value: "Back Office" }]);
    assert.equal(named.applications[1]!.id, "back-office");
    const renamed = draftAfter([
      added,
      { type: "edit", pointer: "/applications/1/name", value: "Back Office" },
      { type: "edit", pointer: "/applications/1/name", value: "Office" },
    ]);
    assert.equal(renamed.applications[1]!.id, "office", "it follows the name while it is the one made of it");
    const set = draftAfter([
      added,
      { type: "edit", pointer: "/applications/1/id", value: "bo" },
      { type: "edit", pointer: "/applications/1/name", value: "Back Office" },
    ]);
    assert.equal(set.applications[1]!.id, "bo", "an identifier the person set stays");
    assert.equal(draftAfter([{ type: "edit", pointer: "/applications/0/name", value: "Shop" }]).applications[0]!.id, DOCUMENT.applications[0]!.id);
    assert.equal(
      draftAfter([{ type: "edit", pointer: "/applications/0/name", value: "The shop" }]).applications[0]!.id,
      "shop",
      "an application in force keeps its identifier",
    );
  });

  it("give a base added the variable of its connection string of its identifier, and the other sources nothing", () => {
    const base = draftAfter([
      { type: "add", pointer: "/knowledge", item: NEW_ITEMS.postgresql },
      { type: "edit", pointer: "/knowledge/8/id", value: "billing" },
    ]);
    assert.deepEqual(base.knowledge[8], { id: "billing", type: "postgresql", connectionStringEnv: "BILLING_DB_URL" });
    const contract = draftAfter([
      { type: "add", pointer: "/knowledge", item: NEW_ITEMS.openapi },
      { type: "edit", pointer: "/knowledge/8/id", value: "billing" },
    ]);
    assert.deepEqual(contract.knowledge[8], { id: "billing", type: "openapi", url: "" });
    const inForce = draftAfter([{ type: "edit", pointer: "/knowledge/2/id", value: "orders" }]);
    assert.equal(inForce.knowledge[2]!.type === "postgresql" && inForce.knowledge[2]!.connectionStringEnv, "SHOP_DB_URL", "a base in force keeps its variable");
  });

  it("follow the names on an instance that has no configuration yet, as it is set up", () => {
    const actions: readonly ConfigurationAction[] = [
      { type: "read", view: { file: "missing" }, revisions: [] },
      {
        type: "begin",
        document: {
          ...DOCUMENT,
          applications: [{ ...NEW_ITEMS.application, environments: [{ name: "local", uiUrl: "" }] }],
          knowledge: [{ ...NEW_ITEMS.postgresql }],
        },
      },
      { type: "edit", pointer: "/applications/0/name", value: "Shop" },
      { type: "edit", pointer: "/knowledge/0/id", value: "orders" },
    ];
    const begun = actions.reduce<ConfigurationState>(configurationAfter, INITIAL_CONFIGURATION).draft!;
    assert.equal(begun.applications[0]!.id, "shop");
    assert.deepEqual(begun.knowledge[0], { id: "orders", type: "postgresql", connectionStringEnv: "ORDERS_DB_URL" });
  });

  it("give an account the variables of its application and its name while the person did not set them", () => {
    const account = draftAfter([
      { type: "add", pointer: "/applications/0/authentication/accounts", item: NEW_ITEMS.account },
      { type: "edit", pointer: "/applications/0/authentication/accounts/1/name", value: "manager" },
    ]).applications[0]!.authentication.accounts![1];
    assert.deepEqual(account, { name: "manager", usernameEnv: "SHOP_MANAGER_USERNAME", passwordEnv: "SHOP_MANAGER_PASSWORD" });
    const kept = draftAfter([{ type: "edit", pointer: "/applications/0/authentication/accounts/0/name", value: "boss" }]).applications[0]!.authentication
      .accounts![0];
    assert.deepEqual(kept, { name: "boss", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }, "variables the person set stay");
  });
});
