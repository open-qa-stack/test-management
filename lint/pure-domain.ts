import type { Rule } from "./rule.ts";

/**
 * Keeps decorators out of the domain, whatever their kind: those of the TypeScript experimental proposal, on a
 * parameter for instance, and the standard ones.
 */
export const pureDomain: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Keeps decorators out of the domain." },
    messages: {
      decorator: "The domain holds no decorator: the API plugs the domain in through its providers.",
    },
  },
  create(context) {
    return {
      Decorator: (node) => context.report({ node, messageId: "decorator" }),
    };
  },
};
