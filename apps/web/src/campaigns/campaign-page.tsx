import { useState, type ReactNode } from "react";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { CampaignScreen, type CampaignGesture, type GestureState } from "./campaign-screen.tsx";

/** A campaign, read again at the pace of the console with the launch that runs, and the gestures its state allows. */
export function CampaignPage({ project, id }: { readonly project: string; readonly id: string }): ReactNode {
  const [asked, setAsked] = useState(0);
  const state = usePolled(() => api.campaign(id), `${id}:${asked}`);
  const launches = usePolled(() => api.launches(), `launches:${asked}`);
  const [gestures, setGestures] = useState<GestureState>({});
  const onGesture = (gesture: CampaignGesture): void => {
    setGestures({ pending: gesture });
    const done = gesture === "ready" ? api.readyCampaign(id) : gesture === "launch" ? api.launchCampaign(id) : api.closeCampaign(id);
    done.then(
      () => {
        setGestures({});
        setAsked((count) => count + 1);
      },
      (error: ApiError) => setGestures({ refusal: error.message }),
    );
  };
  const launching = launches.value?.running?.campaign === id;
  return <CampaignScreen project={project} id={id} state={state} launching={launching} gestures={gestures} onGesture={onGesture} />;
}
