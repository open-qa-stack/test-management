import { useState, type ReactNode } from "react";
import type { DefectStatus } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { Route } from "../routing/route.ts";
import { defectViewOf } from "./defects-paths.ts";
import { DefectsScreen } from "./defects-screen.tsx";

/**
 * The screen of the defects in a browser: it keeps them in step with the instance, and moves one as the person asks,
 * reading them again once it is moved.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function DefectsPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [changed, setChanged] = useState(0);
  const [moving, setMoving] = useState<{ readonly pending?: string; readonly refusal?: string }>({});
  const defects = usePolled(() => api.defects(), `defects:${changed}`);
  const change = (id: string, status: DefectStatus): void => {
    setMoving({ pending: id });
    api.changeDefect(id, status).then(
      () => {
        setMoving({});
        setChanged((count) => count + 1);
      },
      (error: ApiError) => setMoving({ refusal: error.message }),
    );
  };
  return <DefectsScreen project={project} view={defectViewOf(route)} defects={defects} controls={{ change, ...moving }} />;
}
