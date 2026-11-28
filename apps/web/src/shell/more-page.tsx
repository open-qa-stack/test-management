import type { ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { MoreFacts } from "./more-facts.ts";
import { MoreScreen } from "./more-screen.tsx";

/** The value an answer gave, none when the instance could not give it. */
function valueOf<T>(answer: PromiseSettledResult<T>): T | undefined {
  return answer.status === "fulfilled" ? answer.value : undefined;
}

/**
 * The screen of the other entries in a browser: it reads where each stands, each from its own answer, so that what
 * the instance cannot tell leaves only its entry without a sentence.
 *
 * @param props - The name of the project.
 * @returns The screen.
 */
export function MorePage({ project }: { readonly project: string }): ReactNode {
  const facts = usePolled(async (): Promise<MoreFacts> => {
    const answers = await Promise.allSettled([api.domains(), api.campaigns(), api.defects(), api.configuration()]);
    const [domains, campaigns, defects, view] = [valueOf(answers[0]), valueOf(answers[1]), valueOf(answers[2]), valueOf(answers[3])];
    const document = view?.revision?.document;
    return {
      ...(domains === undefined ? {} : { domains: domains.length }),
      ...(campaigns === undefined ? {} : { plannedCampaigns: campaigns.items.filter(({ status }) => status === "planned").length }),
      ...(defects === undefined ? {} : { openDefects: defects.counts.open }),
      ...(document === undefined ? {} : { applications: document.applications.length, sources: document.knowledge.length }),
    };
  }, "more");
  return <MoreScreen project={project} facts={facts.value ?? {}} />;
}
