/** The system prompt of an agent as it is written once: its text, where `{{name}}` stands for what is only known when a session opens. */
export interface PromptTemplate<Variable extends string = string> {
  /** The text, with a `{{name}}` wherever a variable goes. */
  readonly template: string;
  /** The names the text holds between braces, each once at least. */
  readonly variables: readonly Variable[];
}

/**
 * Writes the system instructions of a session from the prompt of its agent.
 *
 * @param prompt - The prompt.
 * @param values - What each of its variables stands for in this session.
 * @returns Its text, each variable replaced by its value; a name between braces the prompt does not declare stays as it is written.
 */
export function promptOf<Variable extends string>(prompt: PromptTemplate<Variable>, values: Readonly<Record<Variable, string>>): string {
  const known: Readonly<Record<string, string | undefined>> = values;
  return prompt.template.replaceAll(/\{\{(\w+)\}\}/g, (whole, name: string) => known[name] ?? whole);
}

/** What each variable of a prompt stands for in a session. */
export type PromptValues<Prompt extends PromptTemplate> = Readonly<Record<Prompt["variables"][number], string>>;
