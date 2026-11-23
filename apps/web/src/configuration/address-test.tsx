import { useContext, type ReactNode } from "react";
import type { AddressCheck } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { EditContext } from "./configuration-edit.ts";
import type { AddressTest as Test } from "./configuration-state.ts";

/** What the test of an address found, in words that say what to correct. */
function checkText(check: AddressCheck): string {
  if (check.state === "answers") return t("configuration.address.answers", { status: check.status });
  if (check.state === "unreachable")
    return check.code === undefined ? t("configuration.address.unreachable") : t("configuration.address.unreachableCode", { code: check.code });
  return t(`configuration.address.${check.state}`);
}

/** What a test of an address tells, under way or done: the wait, what it found, or why it could not be made. */
function TestResult({ test }: { readonly test: Test }): ReactNode {
  if (test.failure !== undefined)
    return (
      <p className="config-note ko" role="status">
        {t("configuration.address.failed", { reason: test.failure })}
      </p>
    );
  if (test.check === undefined)
    return (
      <p className="small muted" role="status">
        {t("configuration.address.checking")}
      </p>
    );
  return (
    <p className={test.check.state === "answers" ? "config-note ok" : "config-note ko"} role="status">
      {checkText(test.check)}
    </p>
  );
}

/**
 * The button that tests that an address of an environment answers, beside its field, and what the latest test of the
 * address the field holds found: changing the address clears it.
 *
 * @param props - The pointer of the field, and the address it holds.
 * @returns The button and the result.
 */
export function AddressTest({ pointer, address }: { readonly pointer: string; readonly address: string | undefined }): ReactNode {
  const { checkAddress, addressChecks } = useContext(EditContext);
  const test = addressChecks?.[pointer];
  const shown = test !== undefined && test.address === address ? test : undefined;
  const running = shown !== undefined && shown.check === undefined && shown.failure === undefined;
  return (
    <div className="address-test">
      <button
        type="button"
        className="btn sm"
        data-pointer={pointer}
        onClick={checkAddress}
        disabled={address === undefined || address === "" || running}
        aria-label={t("configuration.address.testName", { address: address ?? "" })}
      >
        {t("configuration.address.test")}
      </button>
      {shown !== undefined && <TestResult test={shown} />}
    </div>
  );
}
