import { execFileSync } from "node:child_process";

const ENGINES = ["podman", "docker"];

/**
 * @returns The command that runs containers: `OQAS_CONTAINER_ENGINE` when set, otherwise the first of
 * `podman` and `docker` found on the path.
 * @throws When no container engine is found.
 */
export function containerEngine(): string {
  const chosen = process.env["OQAS_CONTAINER_ENGINE"];
  if (chosen !== undefined && chosen !== "") return chosen;
  const found = ENGINES.find((engine) => {
    try {
      execFileSync(engine, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (found === undefined) throw new Error("The tests of the API need a container engine: install Podman or Docker, or set OQAS_CONTAINER_ENGINE.");
  return found;
}
