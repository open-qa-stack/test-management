import { POSTGRES } from "@open-qa-stack/store/testing";
import { sessionsApiSuite } from "./suites/sessions-api.ts";

sessionsApiSuite(POSTGRES);
