import assert from "node:assert/strict";
import type { ConfigurationControls } from "../../src/configuration/configuration-screen.tsx";

/** What the person does to the draft of the configuration, which a static rendering never calls. */
export const UNCALLED_CONTROLS: ConfigurationControls = {
  change: () => assert.fail("nothing is changed"),
  click: () => assert.fail("nothing is pressed"),
  save: () => assert.fail("nothing is saved"),
  discard: () => assert.fail("nothing is dropped"),
  takeFile: () => assert.fail("no file is taken"),
  writeFile: () => assert.fail("no file is written"),
  testModel: () => assert.fail("no connection is tested"),
  checkSource: () => assert.fail("no source is tested"),
  setUp: () => assert.fail("nothing is set up"),
};
