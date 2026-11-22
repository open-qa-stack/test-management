import { useState, type ReactNode } from "react";
import type { CartographyState, KnowledgeDomain } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import type { ApiError } from "../api/api-error.ts";
import { usePolled } from "../api/use-polled.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { DiscoveryScreen, type DiscoveryOpening } from "./discovery-screen.tsx";

/**
 * The discovery in a browser: it reads where the cartography stands and the domains it found, again and again, keeps
 * the domains the person picks, and opens a session kept to them, which the console then shows.
 *
 * @param props - The name of the project.
 * @returns The screen.
 */
export function DiscoveryPage({ project }: { readonly project: string }): ReactNode {
  const found = usePolled<{ readonly mapping: CartographyState; readonly domains: readonly KnowledgeDomain[] }>(async () => {
    // Before a cartography, the instance may tell no domain: there is none yet.
    const [mapping, domains] = await Promise.all([api.mapping(), api.domains().catch(() => [])]);
    return { mapping, domains };
  }, "discovery");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [opening, setOpening] = useState<DiscoveryOpening>({ state: "idle" });
  const domains = found.value?.domains;
  return (
    <DiscoveryScreen
      project={project}
      {...(found.value === undefined ? {} : { mapping: found.value.mapping, domains: found.value.domains })}
      {...(found.unread === undefined ? {} : { unread: found.unread })}
      chosen={chosen}
      opening={opening}
      controls={{
        toggle: ({ currentTarget }) => {
          const next = new Set(chosen);
          if (currentTarget.checked) next.add(currentTarget.value);
          else next.delete(currentTarget.value);
          setChosen(next);
        },
        generate: (event) => {
          event.preventDefault();
          // The button is drawn once the domains are told, and pressed once one is picked.
          const labels = domains!.filter(({ id }) => chosen.has(id)).map(({ label }) => label);
          setOpening({ state: "opening" });
          api.open({ request: t("discovery.request", { domains: labels.join(", ") }), scope: { domains: [...chosen] } }).then(
            (session) => window.location.assign(hrefTo(`/agent/sessions/${session.id}`)),
            (error: ApiError) => setOpening({ state: "refused", text: error.message }),
          );
        },
      }}
    />
  );
}
