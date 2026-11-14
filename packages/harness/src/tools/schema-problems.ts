import type { ErrorObject } from "ajv";

/** Most problems told of one call; the others are counted. */
const MAX_PROBLEMS = 6;

/**
 * Says what is wrong with the arguments of a call, from what the validator of its schema found, in
 * sentences a model can act on.
 *
 * @remarks
 * A validator answers a value that matches none of several shapes with every failure of every shape: a
 * dozen fragments for one mistake. Those are told once, with what the shape the value is nearest to lacks
 * or does not allow. A list that is too long or too short is told with its bound, a missing property and one
 * that is not allowed by their name, and anything else as the validator says it. Each problem is told once,
 * `MAX_PROBLEMS` at most.
 *
 * @param errors - What the validator found.
 * @returns The problems, each as a clause without its full stop, in the order of the arguments.
 */
export function schemaProblems(errors: readonly ErrorObject[]): string[] {
  const where = (error: ErrorObject) => `arguments${error.instancePath}`;
  const alternatives = new Set(errors.filter((error) => error.keyword === "oneOf" || error.keyword === "anyOf").map(where));
  // A failure inside one shape of several is told with its value, not on its own.
  const within = (error: ErrorObject) => /\/(?:oneOf|anyOf)\/\d+\//.test(error.schemaPath) && alternatives.has(where(error));
  const told = errors.flatMap((error): string[] => {
    if (within(error)) return [];
    const { keyword, params } = error;
    if (keyword === "oneOf" || keyword === "anyOf") {
      // The shape the value is nearest to is the one it fails the least: what it lacks or has too much of is told.
      const shapes = new Map<string, ErrorObject[]>();
      for (const other of errors.filter((candidate) => within(candidate) && where(candidate) === where(error))) {
        const shape = /\/(?:oneOf|anyOf)\/(\d+)\//.exec(other.schemaPath)![1]!;
        shapes.set(shape, [...(shapes.get(shape) ?? []), other]);
      }
      // A value that has several of the shapes fails none of them: the validator says it as it is.
      if (shapes.size === 0) return [`${where(error)} ${error.message}`];
      const nearest = [...shapes.values()].sort((one, other) => one.length - other.length)[0]!;
      const hints = nearest.flatMap((other) => {
        if (other.keyword === "additionalProperties") return [`leave out ${String(other.params["additionalProperty"])}`];
        return other.keyword === "required" ? [`give ${String(other.params["missingProperty"])}`] : [];
      });
      return [`${where(error)} has none of the shapes its tool takes${hints.length === 0 ? "" : `: ${hints.join(", ")}`}`];
    }
    if (keyword === "maxItems") return [`${where(error)} holds more than ${String(params["limit"])} items: give ${String(params["limit"])} at most`];
    if (keyword === "minItems") return [`${where(error)} holds fewer than ${String(params["limit"])} items: give ${String(params["limit"])} at least`];
    if (keyword === "required") return [`${where(error)} needs the property ${String(params["missingProperty"])}`];
    if (keyword === "additionalProperties")
      return [`${where(error)} holds ${String(params["additionalProperty"])}, which its tool does not take: leave it out`];
    return [`${where(error)} ${error.message}`];
  });
  const once = [...new Set(told)];
  return once.length <= MAX_PROBLEMS ? once : [...once.slice(0, MAX_PROBLEMS), `and ${once.length - MAX_PROBLEMS} more of the same kind`];
}
