import { fileURLToPath } from "node:url";

/** The versioned migrations of the package, applied in the order of their journal. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../migrations", import.meta.url));
