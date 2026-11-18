import { languageRule } from "@open-qa-stack/agents";
import type { AgentRuntime, AgentSession, Language, SessionOptions } from "@open-qa-stack/domain";

/**
 * A runtime of the agents whose sessions all speak to the person in their language: the instructions of each
 * session it opens end with the rule of that language. The instructions themselves stay in English.
 */
export class SpokenRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly rule: string;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param language - The language of the person, as the configuration names it.
   */
  public constructor(inner: AgentRuntime, language: Language) {
    this.inner = inner;
    this.rule = languageRule(language);
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
