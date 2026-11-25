import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { anomalyLine, readingLines, testExecutionLine, testLine, verdictLine, versionLine } from "../output/test-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/**
 * `oqas tests`: lists the tests of the test repository, or what came of each the last time it ran; with a test, reads it in steps, lists what came of its file in
 * the latest executions or the versions of its tests, or writes its trace or the capture of one of its steps to a file.
 */
export async function tested(
  { tests, readings, executions, code }: Pick<Operations, "tests" | "readings" | "executions" | "code">,
  command: Extract<Command, { name: "tests" }>,
  printing: Pick<Asked<"tests">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { io } = printing;
  switch (command.action) {
    case "list": {
      const listed = await tests.listed();
      const lines = listed.items.length === 0 ? ["The test repository holds no test yet."] : listed.items.map(testLine);
      print(printing, [...lines, ...listed.anomalies.map(anomalyLine)].join("\n"), listed);
      return ExitCode.passed;
    }
    case "verdicts": {
      const items = await executions.verdicts();
      print(printing, linesOr(items.map(verdictLine), "No test ran yet."), { items });
      return ExitCode.passed;
    }
    case "read": {
      const reading = await readings.read(command.path);
      print(printing, readingLines(reading).join("\n"), reading);
      return ExitCode.passed;
    }
    case "executions": {
      const items = await executions.ofFile(command.path);
      print(printing, linesOr(items.map(testExecutionLine), `No execution the instance keeps ran ${command.path}.`), { items });
      return ExitCode.passed;
    }
    case "versions": {
      const items = await executions.versions(command.path);
      print(printing, linesOr(items.map(versionLine), `The instance keeps no version of ${command.path}.`), { items });
      return ExitCode.passed;
    }
    case "source": {
      const source = await code.read(command.path);
      print(printing, source.content.trimEnd(), source);
      return ExitCode.passed;
    }
    case "change": {
      const changed = await code.change(command);
      print(printing, `${testLine(changed)}\nCommitted ${changed.path}; the test bears @oqas-id-${changed.id}.`, changed);
      return ExitCode.passed;
    }
    case "trace": {
      const file = resolve(io.cwd, command.file);
      await writeFile(file, await readings.trace(command.path));
      print(printing, `The trace of ${command.path} is written to ${file}: npx playwright show-trace opens it.`, { path: command.path, file });
      return ExitCode.passed;
    }
    case "capture": {
      const file = resolve(io.cwd, command.file);
      const { contentType, bytes } = await readings.capture(command.path, command.step);
      await writeFile(file, bytes);
      print(printing, `The capture of step ${command.step} of ${command.path} is written to ${file} (${contentType}).`, {
        path: command.path,
        step: command.step,
        file,
        contentType,
      });
      return ExitCode.passed;
    }
  }
}
