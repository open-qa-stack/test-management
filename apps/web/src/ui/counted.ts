/**
 * Writes a count with what it counts, in the singular or the plural as French has it: the singular below two,
 * zero included.
 *
 * @param count - How many.
 * @param one - What is counted, in the singular, such as `scénario`.
 * @param many - What is counted, in the plural, such as `scénarios`.
 * @returns The count and its word, such as `1 scénario` or `3 scénarios`.
 */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${count < 2 ? one : many}`;
}
