import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { failingTests } from "../tests/failing-tests.ts";
import { AgentHomeScreen, type AgentHomeScreenProps, type Existing } from "./agent-home-screen.tsx";
import { scopeChoicesOf, type ScopeChoices } from "./scope-choices.ts";

/** The entry of the agent, with what a session may be kept to, read from the configuration and the knowledge once. */
export function AgentHomePage(props: Omit<AgentHomeScreenProps, "choices" | "existing">): ReactNode {
  const [choices, setChoices] = useState<ScopeChoices>();
  const [existing, setExisting] = useState<Existing>();
  useEffect(() => {
    // Without the domains of the knowledge, a session is still kept to its applications and levels.
    const domains = api.domains().catch(() => []);
    void Promise.all([api.configuration(), domains]).then(
      ([view, known]) => setChoices(scopeChoicesOf(view, known)),
      () => setChoices(undefined),
    );
    // What the project holds to start from is read once; what the instance cannot tell counts as nothing.
    void Promise.all([api.testVerdicts().catch(() => []), api.reviews().catch(() => undefined), domains]).then(([verdicts, queue, known]) =>
      setExisting({
        failing: failingTests(verdicts),
        toReview: queue?.counts.inReview ?? 0,
        domains: known.length,
      }),
    );
  }, []);
  return <AgentHomeScreen {...props} {...(choices === undefined ? {} : { choices })} {...(existing === undefined ? {} : { existing })} />;
}
