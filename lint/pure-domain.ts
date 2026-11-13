import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

/** Modules the domain never imports: the API framework, its HTTP engine and its runtime reflection. */
const FRAMEWORK = /^(?:@nestjs\/.+|fastify(?:\/.*)?|reflect-metadata)$/;

/**
 * Keeps the domain free of the API framework: no import of `@nestjs/*`, `fastify` or `reflect-metadata`,
 * whether static, re-exported, dynamic or in a type query, and no decorator.
 */
export const pureDomain: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Keeps the domain free of the API framework." },
    messages: {
      framework: "The domain does not import {{source}}: the API plugs the domain in through its providers.",
      decorator: "The domain holds no decorator: the API plugs the domain in through its providers.",
    },
  },
  create(context) {
    const check = (node: NonNullable<Parameters<typeof context.report>[0]["node"]>, source: unknown): void => {
      if (typeof source === "string" && FRAMEWORK.test(source)) context.report({ node, messageId: "framework", data: { source } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => check(node, node.source.type === "Literal" ? node.source.value : undefined),
      TSImportType: (node) => check(node, node.source.value),
      Decorator: (node) => context.report({ node, messageId: "decorator" }),
    };
  },
};
