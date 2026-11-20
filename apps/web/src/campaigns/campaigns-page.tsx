import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { campaignHref, declaredEnvironments, typedTags } from "./campaigns-paths.ts";
import { CampaignsScreen, type PlanningState } from "./campaigns-screen.tsx";

/** The campaigns of the instance, read again at the pace of the console, with the form that plans another. */
export function CampaignsPage({ project }: { readonly project: string }): ReactNode {
  const state = usePolled(() => api.campaigns(), "campaigns");
  const [environments, setEnvironments] = useState<readonly string[]>([]);
  const [planning, setPlanning] = useState<PlanningState>({ pending: false });
  useEffect(() => {
    void api.configuration().then(
      (view) => setEnvironments(declaredEnvironments(view)),
      () => setEnvironments([]),
    );
  }, []);
  const onPlan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const field = (name: string): string => (event.currentTarget.elements.namedItem(name) as HTMLInputElement).value;
    const plan = { name: field("name"), environment: field("environment"), tags: typedTags(field("tags")) };
    setPlanning({ pending: true });
    api.planCampaign(plan).then(
      (campaign) => (window.location.hash = campaignHref(campaign.id)),
      (error: ApiError) => setPlanning({ pending: false, refusal: error.message }),
    );
  };
  return <CampaignsScreen project={project} state={state} environments={environments} planning={planning} onPlan={onPlan} />;
}
