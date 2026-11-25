import { useState, type ReactNode } from "react";
import type { CartographyState, DomainChange, KnowledgeDomain } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import type { ApiError } from "../api/api-error.ts";
import { usePolled } from "../api/use-polled.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { DiscoveryScreen, type DiscoveryOpening, type DomainChanging } from "./discovery-screen.tsx";

/**
 * The discovery in a browser: it reads where the cartography stands and the domains it found, again and again, keeps
 * the domains the person picks, and opens a session kept to them, which the console then shows.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function DiscoveryPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [changes, setChanges] = useState(0);
  const [changing, setChanging] = useState<DomainChanging>({ pending: false });
  const found = usePolled<{ readonly mapping: CartographyState; readonly domains: readonly KnowledgeDomain[] }>(async () => {
    // Before a cartography, the instance may tell no domain: there is none yet.
    const [mapping, domains] = await Promise.all([api.mapping(), api.domains().catch(() => [])]);
    return { mapping, domains };
  }, `discovery:${changes}`);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [opening, setOpening] = useState<DiscoveryOpening>({ state: "idle" });
  const domains = found.value?.domains;
  // A change made is read again at once, and closes the panel; a domain that is no longer to pick is no longer picked.
  const change = (id: string, changed: DomainChange): void => {
    setChanging({ pending: true });
    api.changeDomain(id, changed).then(
      () => {
        setChanging({ pending: false });
        setChanges((count) => count + 1);
        if (changed.excluded === true) setChosen((picked) => new Set([...picked].filter((other) => other !== id)));
        window.location.hash = withPanel(route);
      },
      (error: ApiError) => setChanging({ pending: false, refusal: error.message }),
    );
  };
  return (
    <DiscoveryScreen
      project={project}
      {...(found.value === undefined ? {} : { mapping: found.value.mapping, domains: found.value.domains })}
      {...(found.unread === undefined ? {} : { unread: found.unread })}
      chosen={chosen}
      opening={opening}
      route={route}
      changing={changing}
      controls={{
        toggle: ({ currentTarget }) => {
          const next = new Set(chosen);
          if (currentTarget.checked) next.add(currentTarget.value);
          else next.delete(currentTarget.value);
          setChosen(next);
        },
        exclude: ({ currentTarget }) => change(currentTarget.value, { excluded: true }),
        restore: ({ currentTarget }) => change(currentTarget.value, { excluded: false }),
        rename: (event) => {
          event.preventDefault();
          const { value } = event.currentTarget.elements.namedItem("label") as HTMLInputElement;
          // The form is drawn for the domain the panel names.
          change(route.query["panel"]!.slice("rename:".length), { label: value });
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
