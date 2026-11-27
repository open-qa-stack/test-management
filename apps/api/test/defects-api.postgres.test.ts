import { POSTGRES } from "@open-qa-stack/store/testing";
import { defectsApiSuite } from "./suites/defects-api.ts";

defectsApiSuite(POSTGRES);
