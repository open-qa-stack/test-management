import { ExitCode, type Campaign, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { UsageError } from "../errors/usage-error.ts";
import { campaignLine, overviewLine, progressLines } from "../output/campaign-lines.ts";
import type { Asked } from "./asked.ts";
import { followed } from "./launch-command.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/**
 * `oqas campaigns`: lists the campaigns; plans one, chooses its tests, makes it ready, launches its tests and follows
 * them to their end, prints it with what came of each test, or closes it.
 */
export async function campaigned(
  operations: Pick<Operations, "campaigns" | "tests" | "sessions" | "executions">,
  command: Extract<Command, { name: "campaigns" }>,
  printing: Pick<Asked<"campaigns">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { campaigns } = operations;
  const told = (campaign: Campaign): ExitCodeValue => {
    print(printing, campaignLine(campaign), campaign);
    return ExitCode.passed;
  };
  switch (command.action) {
    case "list": {
      const items = await campaigns.list();
      print(printing, linesOr(items.map(overviewLine), "The instance keeps no campaign."), { items });
      return ExitCode.passed;
    }
    case "plan":
      return told(await campaigns.plan({ name: command.campaign, environment: command.environment, ...command.details }));
    case "choose": {
      // A file named stands for every test it holds.
      const named = new Set(command.paths);
      const tests = (await operations.tests.list()).filter(({ path }) => named.has(path)).map(({ path, title }) => ({ path, title }));
      const missing = command.paths.filter((path) => !tests.some((test) => test.path === path));
      if (missing.length > 0) throw new UsageError(`The test repository holds no test in ${missing.join(", ")}; oqas tests lists them.`);
      return told(await campaigns.choose(command.campaign, tests));
    }
    case "ready":
      return told(await campaigns.ready(command.campaign));
    case "close":
      return told(await campaigns.close(command.campaign));
    case "show": {
      const progress = await campaigns.progress(command.campaign);
      print(printing, progressLines(progress).join("\n"), progress);
      return ExitCode.passed;
    }
    case "launch":
      return followed(operations, await campaigns.launch(command.campaign, command.only), printing);
  }
}
