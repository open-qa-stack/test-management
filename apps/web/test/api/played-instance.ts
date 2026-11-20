import { ApiClient } from "../../src/api/api-client.ts";

/** An instance a test plays: what it answers, what the console asked it, and what the screen was told. */
export class PlayedInstance<Action> {
  /** What the instance answers to the next call. */
  public answer!: () => Response;
  /** Each call the console made, as `METHOD url`. */
  public readonly calls: string[] = [];
  /** Each action the screen was told. */
  public readonly told: Action[] = [];
  /** A client that calls this instance. */
  public readonly client = new ApiClient(async (input, init) => {
    this.calls.push(`${init?.method ?? "GET"} ${input}`);
    return this.answer();
  });

  /** Tells the screen an action. */
  public readonly tell = (action: Action): void => {
    this.told.push(action);
  };

  /** Forgets the calls and the actions of the last test. */
  public reset(): void {
    this.calls.length = 0;
    this.told.length = 0;
  }
}
