import { confinedImports } from "./confined-imports.ts";
import { folderBoundaries } from "./folder-boundaries.ts";
import { packageBoundaries } from "./package-boundaries.ts";
import { pureDomain } from "./pure-domain.ts";

/** The lint rules of the workspace that no published plugin carries. */
export default {
  meta: { name: "open-qa-stack" },
  rules: {
    "confined-imports": confinedImports,
    "folder-boundaries": folderBoundaries,
    "package-boundaries": packageBoundaries,
    "pure-domain": pureDomain,
  },
};
