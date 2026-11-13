import { pureDomain } from "./pure-domain.ts";

/** The lint rules of the workspace that no published plugin carries. */
export default {
  meta: { name: "open-qa-stack" },
  rules: { "pure-domain": pureDomain },
};
