import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { lessonDraftOf, memoryChangeOf, type MemoryItem } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { t } from "../i18n/i18n.ts";
import type { Route } from "../routing/route.ts";
import { closedOf, MEMORY_TYPES, memoryHref, memoryPlaceOf } from "./memory-paths.ts";
import { MemoryScreen } from "./memory-screen.tsx";

/**
 * The screen of the memory of the agents in a browser: it keeps the memory in step with the instance, adds the
 * instruction or adjusts the line its panel is open on, and reads the memory again once the instance took it.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function MemoryPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const place = memoryPlaceOf(route);
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState<{ readonly pending: boolean; readonly refusal?: string }>({ pending: false });
  const memory = usePolled(() => api.memory(), `memory:${saved}`);
  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const active = form.get("active") === "on";
    const application = form.get("application");
    const adjusted = memory.value?.items.find(({ id }) => id === place.panel);
    // What an agent noted changes only in what it says and whether it applies.
    const asked =
      adjusted === undefined
        ? lessonDraftOf({ text: form.get("text"), application, target: form.get("target"), active })
        : memoryChangeOf(
            adjusted.type === "inferred"
              ? { text: form.get("text"), active }
              : { text: form.get("text"), application: application === "" ? null : application, target: form.get("target"), active },
          );
    if (typeof asked === "string") {
      setSaving({ pending: false, refusal: t("memory.panel.incomplete") });
      return;
    }
    setSaving({ pending: true });
    const kept: Promise<MemoryItem> =
      adjusted === undefined ? api.addLesson(asked as Parameters<typeof api.addLesson>[0]) : api.changeMemory(adjusted.id, asked);
    kept.then(
      () => {
        setSaving({ pending: false });
        setSaved((count) => count + 1);
        window.location.hash = memoryHref(closedOf(place));
      },
      (error: ApiError) => setSaving({ pending: false, refusal: error.message }),
    );
  };
  const narrow = (event: ChangeEvent<HTMLSelectElement>): void => {
    const type = MEMORY_TYPES.find((known) => known === event.currentTarget.value);
    window.location.hash = memoryHref({ view: place.view, ...(type === undefined ? {} : { type }) });
  };
  return <MemoryScreen project={project} place={place} memory={memory} controls={{ save, narrow, ...saving }} />;
}
