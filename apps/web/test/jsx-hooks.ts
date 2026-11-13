import { readFile } from "node:fs/promises";
import type { LoadHook } from "node:module";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";
import { spanWholeSource } from "./source-map-span.ts";

/**
 * Compiles `.tsx` modules with the transform Vite applies. The source map spans the whole source so that
 * coverage counts comments and types as Node does for the `.ts` modules it strips itself.
 */
export const load: LoadHook = async (url, context, nextLoad) => {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const source = await readFile(filename, "utf8");
  const { code, map } = await transformWithOxc(source, filename, { jsx: { runtime: "automatic" }, sourcemap: true });
  if (map === undefined) throw new Error(`no source map for ${filename}`);
  const body = code.endsWith("\n") ? code : `${code}\n`;
  const mappings = spanWholeSource(map.mappings, body.split("\n").length - 1, source.trimEnd().split("\n").length - 1);
  const sourceMap = Buffer.from(JSON.stringify({ ...map, mappings })).toString("base64");
  return { format: "module", source: `${body}//# sourceMappingURL=data:application/json;base64,${sourceMap}`, shortCircuit: true };
};
