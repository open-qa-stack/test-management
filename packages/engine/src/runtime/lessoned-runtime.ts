import type { AgentRuntime, AgentSession, SessionOptions } from "@open-qa-stack/domain";

/**
 * A runtime of the agents whose sessions are all given the lessons the people of the project gave for their work: the
 * instructions of each session it opens end with them, as `lessonsRule` says them.
 */
export class LessonedRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly rule: string;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param rule - What the instructions say of the lessons, as `lessonsRule` gives it.
   */
  public constructor(inner: AgentRuntime, rule: string) {
    this.inner = inner;
    this.rule = rule;
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession} */
  public openSession(options: SessionOptions): Promise<AgentSession> {
    return this.inner.openSession({ ...options, instructions: `${options.instructions}\n\n${this.rule}` });
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }
}
