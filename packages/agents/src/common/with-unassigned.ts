/**
 * A submission that leaves `unassigned` out, as small models often do, with an empty one.
 *
 * @param args - The arguments of the call, an object since the tool's schema checked it.
 * @returns The same arguments, with `unassigned` when they lack it.
 */
export function withUnassigned(args: unknown): object {
  const given = args as object;
  return "unassigned" in given ? given : { ...given, unassigned: [] };
}
