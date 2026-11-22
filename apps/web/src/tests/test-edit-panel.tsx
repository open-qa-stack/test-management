import type { ReactNode } from "react";
import { stepWording, type RepositoryTest, type TestEdit } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { TestTextPanel, type TextSaving } from "./test-text-panel.tsx";

/** The panel the route opens: the title of the test, or one of its steps by its number; none otherwise. */
function panelOf(route: Route): { readonly kind: "title" } | { readonly kind: "step"; readonly number: number } | undefined {
  const [kind, number] = (route.query["panel"] ?? "").split(":");
  if (kind === "title") return { kind };
  return kind === "step" && /^[1-9]\d*$/.test(number ?? "") ? { kind, number: Number(number) } : undefined;
}

/** The own title of a test, after the titles of the groups that hold it. */
function ownTitle(test: RepositoryTest): string {
  return test.title.split(" › ").at(-1)!;
}

/** What the panel that changes a test is drawn from. */
export interface TestEditPanelProps {
  /** The test. */
  readonly test: RepositoryTest;
  /** Where the console is, which tells the panel open. */
  readonly route: Route;
  /** The tests of the repository, among which those of its file, whose titles it may not take. */
  readonly tests: readonly RepositoryTest[];
  /** Where the saving of a change stands. */
  readonly saving: TextSaving;
  /** Changes the test. */
  readonly onChange: (test: RepositoryTest, edit: TestEdit) => void;
}

/**
 * The panel the route opens on a test, if any: that of its own title — which another test of its file may not have —, or
 * that of one of its steps, by its number, whose text is changed without the number the harness wrote before it.
 *
 * @param props - The test, the route, the tests of the repository, and what saves a change.
 * @returns The panel; nothing when the route opens none, or names a step the test does not have.
 */
export function TestEditPanel({ test, route, tests, saving, onChange }: TestEditPanelProps): ReactNode {
  const panel = panelOf(route);
  const close = withPanel(route);
  if (panel?.kind === "title") {
    const groups = test.title.slice(0, test.title.length - ownTitle(test).length);
    const taken = (text: string) =>
      tests.some((other) => other !== test && other.path === test.path && other.title === `${groups}${text}`) ? t("test.titleTaken") : undefined;
    return (
      <TestTextPanel
        title={t("test.titlePanel")}
        label={t("test.titleLabel")}
        hint={t("test.titleHint")}
        value={ownTitle(test)}
        close={close}
        saving={saving}
        refuse={taken}
        onSave={(title) => onChange(test, { title })}
      />
    );
  }
  const number = panel?.kind === "step" ? panel.number : undefined;
  const step = number === undefined ? undefined : test.steps[number - 1];
  if (number === undefined || step === undefined) return null;
  return (
    <TestTextPanel
      key={number}
      title={t("test.stepPanel", { number })}
      label={t("test.stepLabel")}
      hint={t("test.stepHint")}
      value={stepWording(step).text}
      close={close}
      saving={saving}
      onSave={(text) => onChange(test, { step: number, text })}
    />
  );
}
