import { SQLITE } from "@open-qa-stack/store/testing";
import { executionsApiSuite } from "./suites/executions-api.ts";

executionsApiSuite(SQLITE);
