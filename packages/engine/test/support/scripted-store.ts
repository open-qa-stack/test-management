import type { SessionStorePort } from "@open-qa-stack/domain";

/** A command the store was sent, as its name then its arguments. */
export type Sent = readonly [command: string, ...parameters: unknown[]];

/**
 * A store of the sessions that keeps nothing: it records the commands it is sent, and answers each as a test
 * scripts it, to put what writes a session before what a database does at times and a test cannot make one do
 * on demand.
 */
export class ScriptedStore implements SessionStorePort {
  /** The commands that were taken, in order. */
  readonly sent: Sent[] = [];
  /** Called before a command is taken, with its name: what it throws refuses the command, what it awaits holds it. */
  before: (command: string) => Promise<void> | void = () => undefined;

  async #take<T>(answer: T, command: string, ...parameters: unknown[]): Promise<T> {
    await this.before(command);
    this.sent.push([command, ...parameters]);
    return answer;
  }

  /** The commands of one name that were taken, as their arguments. */
  taken(command: string): unknown[][] {
    return this.sent.filter(([name]) => name === command).map(([, ...parameters]) => parameters);
  }

  saveProject = (saved: unknown) => this.#take(undefined, "saveProject", saved);
  ask = () => Promise.reject(new Error("No session is asked of this store."));
  start = () => Promise.reject(new Error("No session is started on this store."));
  append = (id: string, events: readonly unknown[]) => this.#take(undefined, "append", id, [...events]);
  complete = (id: string, result: unknown) => this.#take(undefined, "complete", id, result);
  interrupt = (id: string) => this.#take(undefined, "interrupt", id);
  say = () => Promise.reject(new Error("Nothing is said to a session of this store."));
  deliver = (id: string, number: number, agent: string) => this.#take(undefined, "deliver", id, number, agent);
  abandonRunning = async () => [];
  project = async () => ({ applications: [] });
  sessions = async () => [];
  session = async () => undefined;
  lastRank = async () => 0;
  eventsAfter = async () => [];
  pendingMessages = async () => [];
}
