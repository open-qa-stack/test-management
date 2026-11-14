import type { RuleTester } from "oxlint/plugins-dev";

/** A lint rule, as oxlint loads it from a plugin. */
export type Rule = Parameters<RuleTester["run"]>[1];

/** What oxlint gives a rule for the file it lints. */
export type Context = Parameters<NonNullable<Rule["create"]>>[0];

/** The handlers a rule returns, by the type of the node they visit. */
export type Visitor = ReturnType<NonNullable<Rule["create"]>>;

/** A node a rule can report on. */
export type ReportedNode = NonNullable<Parameters<Context["report"]>[0]["node"]>;
