import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CAMPAIGN_DETAILS } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { campaignHref, declaredEnvironments } from "./campaigns-paths.ts";
import { CampaignsScreen, type PlanningState } from "./campaigns-screen.tsx";

/** The campaigns of the instance, read again at the pace of the console, with the form that plans another. */
export function CampaignsPage({ project }: { readonly project: string }): ReactNode {
  const state = usePolled(() => api.campaigns(), "campaigns");
  const [environments, setEnvironments] = useState<readonly string[]>([]);
  const [tests, setTests] = useState<number>();
  const [planning, setPlanning] = useState<PlanningState>({ pending: false });
  useEffect(() => {
    void api.configuration().then(
      (view) => setEnvironments(declaredEnvironments(view)),
      () => setEnvironments([]),
    );
    void api.tests().then(
      (repository) => setTests(repository.length),
      () => setTests(undefined),
    );
  }, []);
  const onPlan = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const field = (name: string): string => (event.currentTarget.elements.namedItem(name) as HTMLInputElement).value;
    // A detail left empty is not said.
    const details = CAMPAIGN_DETAILS.map((name) => [name, field(name).trim()] as const).filter(([, value]) => value !== "");
    const plan = { name: field("name"), environment: field("environment"), ...Object.fromEntries(details) };
    setPlanning({ pending: true });
    api.planCampaign(plan).then(
      (campaign) => (window.location.hash = campaignHref(campaign.id)),
      (error: ApiError) => setPlanning({ pending: false, refusal: error.message }),
    );
  };
  return <CampaignsScreen project={project} state={state} environments={environments} tests={tests} planning={planning} onPlan={onPlan} />;
}
