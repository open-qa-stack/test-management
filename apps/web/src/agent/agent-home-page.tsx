import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { AgentHomeScreen, type AgentHomeScreenProps } from "./agent-home-screen.tsx";
import { scopeChoicesOf, type ScopeChoices } from "./scope-choices.ts";

/** The entry of the agent, with what a session may be kept to, read from the configuration and the knowledge once. */
export function AgentHomePage(props: Omit<AgentHomeScreenProps, "choices">): ReactNode {
  const [choices, setChoices] = useState<ScopeChoices>();
  useEffect(() => {
    // Without the domains of the knowledge, a session is still kept to its applications and levels.
    void Promise.all([api.configuration(), api.domains().catch(() => [])]).then(
      ([view, domains]) => setChoices(scopeChoicesOf(view, domains)),
      () => setChoices(undefined),
    );
  }, []);
  return <AgentHomeScreen {...props} {...(choices === undefined ? {} : { choices })} />;
}
