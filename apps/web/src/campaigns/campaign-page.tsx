import { useState, type ReactNode } from "react";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { ComposerProps } from "./campaign-composer.tsx";
import { EVERY_TEST, sameChoice, testKey, testsOfChoice, type CompositionFilter } from "./campaign-composition.ts";
import { CampaignScreen, launchScopeOf, type CampaignGesture, type GestureState } from "./campaign-screen.tsx";

/** How often the launch that runs is read again, in milliseconds: its tests finish one after the other. */
const LAUNCH_PAUSE_MS = 1500;

/**
 * A campaign, read again at the pace of the console with the launch that runs, and the gestures its state allows; while it
 * is planned, the choice of its tests among those of the repository, which the person keeps when they are done.
 */
export function CampaignPage({ project, id }: { readonly project: string; readonly id: string }): ReactNode {
  const [asked, setAsked] = useState(0);
  const launches = usePolled(() => api.launches(), `launches:${asked}`, LAUNCH_PAUSE_MS);
  const running = launches.value?.running;
  const launch = running?.campaign === id ? running : undefined;
  // The campaign is read again as each launch ends, which brings the verdicts of its tests.
  const state = usePolled(() => api.campaign(id), `${id}:${asked}:${launches.value?.last?.endedAt}`);
  const [gestures, setGestures] = useState<GestureState>({});
  const onGesture = (gesture: CampaignGesture): void => {
    if (gesture === "close") return setGestures({ confirming: true });
    if (gesture === "cancel_close") return setGestures({});
    setGestures({ pending: gesture });
    const done =
      gesture === "ready" ? api.readyCampaign(id) : gesture === "confirm_close" ? api.closeCampaign(id) : api.launchCampaign(id, launchScopeOf(gesture));
    done.then(
      () => {
        setGestures({});
        setAsked((count) => count + 1);
      },
      (error: ApiError) => setGestures({ refusal: error.message }),
    );
  };
  // The choice the person ticks, until it is kept; the one the instance keeps otherwise.
  const tests = usePolled(() => api.tests(), "tests");
  const [ticked, setTicked] = useState<ReadonlySet<string>>();
  const [filter, setFilter] = useState<CompositionFilter>(EVERY_TEST);
  const [saving, setSaving] = useState(false);
  const saved: ReadonlySet<string> = new Set(state.value?.campaign.tests.map(testKey));
  const chosen = ticked ?? saved;
  const composer: ComposerProps = {
    tests,
    filter,
    chosen,
    changed: !sameChoice(chosen, saved),
    saving,
    onFilter: setFilter,
    onTick: (keys, tick) => {
      const next = new Set(chosen);
      for (const key of keys) next[tick ? "add" : "delete"](key);
      setTicked(next);
    },
    onSave: () => {
      setSaving(true);
      api.chooseCampaignTests(id, testsOfChoice(chosen)).then(
        () => {
          // The choice ticked stays shown: the campaign read again holds the same.
          setSaving(false);
          setGestures({});
          setAsked((count) => count + 1);
        },
        (error: ApiError) => {
          setSaving(false);
          setGestures({ refusal: error.message });
        },
      );
    },
  };
  return (
    <CampaignScreen
      project={project}
      id={id}
      state={state}
      {...(launch === undefined ? {} : { launch })}
      gestures={gestures}
      onGesture={onGesture}
      {...(state.value?.campaign.status === "planned" ? { composer } : {})}
    />
  );
}
