import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { WrittenFiles } from "../src/designer/written-files.ts";

const root = mkdtempSync(join(tmpdir(), "written-files-"));
after(() => rmSync(root, { recursive: true, force: true }));

describe("the files a design writes beside its tests", () => {
  it("are written when their text differs, and put back as they were: gone, or with the text they held", async () => {
    writeFileSync(join(root, "kept.ts"), "same\n");
    writeFileSync(join(root, "changed.ts"), "before\n");
    const written = new WrittenFiles(root);
    await written.write("kept.ts", "same\n");
    await written.write("changed.ts", "after\n");
    await written.write("changed.ts", "after all\n");
    await written.write("pages/new.ts", "new\n");
    assert.deepEqual(written.paths, ["changed.ts", "pages/new.ts"]);
    assert.deepEqual([readFileSync(join(root, "changed.ts"), "utf8"), readFileSync(join(root, "pages", "new.ts"), "utf8")], ["after all\n", "new\n"]);
    await written.revert();
    assert.deepEqual([readFileSync(join(root, "changed.ts"), "utf8"), existsSync(join(root, "pages", "new.ts")), written.paths], ["before\n", false, []]);
  });
});
