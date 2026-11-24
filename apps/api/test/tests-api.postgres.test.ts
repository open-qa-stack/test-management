import { POSTGRES } from "@open-qa-stack/store/testing";
import { testsApiSuite } from "./suites/tests-api.ts";

testsApiSuite(POSTGRES);
